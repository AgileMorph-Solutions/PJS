/**
 * An uploaded production workbook, row by row, through the SAME rule code the production screens call
 * (createBatchIn, createRcnReceiptIn, submitMoistureCheckIn, addPalletIn / updatePalletIn, saveFinalWeightIn,
 * addCalibrationRunIn, submitSizingCheckIn, addManualCalibrationIn).
 * Nothing here re-states a rule: a bin already in a batch, a load that isn't due a check, a pallet on a load
 * that isn't weighable — each is refused by the function that refuses it on screen, with the same words.
 *
 * Unlike Reception's workbook, whose sheets are planned without writing, this runs inside one transaction
 * that the caller rolls back for a preview and commits for an Apply. That is what lets a row lean on the rows
 * above it, as the screens lean on what was saved before: a batch created on the Batches tab is there for its
 * loads on RCN Receipts, a load is there for its checks, an OK check makes its pallets weighable.
 *
 * Saved records are never rewritten from the file except where the app itself edits them (a pallet, until
 * the load's final weight is saved). Anything else that differs is reported, so an edit is never silently lost.
 * A new Calibration row identical to a saved one is the same record uploaded twice, not a second record: nothing
 * else stops it (a half-sized load still has room), and the doc says an upload is "never duplicated".
 */
import type { Prisma } from "@prisma/client";
import type { WarehouseBinStock } from "@anagroci/contract/domain/productionBatch";
import { SILO_SIZES, SIZING_GRADES, samplingPointFromWord, siloFromWord, siloLabel, type SizingGrams } from "@anagroci/contract/domain/calibration";
import { CUT_TEST_GRAMS, sameBtmAndBin } from "@anagroci/contract/domain/rcnReceipt";
import type { MoistureCheckInput } from "@anagroci/contract/types/rcnReceipt";
import { ValidationError } from "../validation.js";
import { parseCell } from "../workbook/cells.js";
import { normalizeHeader } from "../workbook/fields.js";
import type { Change, ParsedSheet, ParsedWorkbook, RowError, RowWarning, Sample } from "../workbook/types.js";
import { SAMPLE_LIMIT } from "../workbook/types.js";
import { createBatchIn } from "../../services/production/batches.js";
import { addCalibrationRunIn, addManualCalibrationIn, submitSizingCheckIn } from "../../services/production/calibration.js";
import { createRcnReceiptIn, runSizes, submitMoistureCheckIn, type Actor } from "../../services/production/rcnReceipts.js";
import { addPalletIn, saveFinalWeightIn, updatePalletIn } from "../../services/production/rcnWeighing.js";
import { gramKey, runKgKey, splitList, tabHeader, TABS, type Tab } from "./tabs.js";

type Tx = Prisma.TransactionClient;

export interface ProductionCtx {
  tx: Tx;
  site: string;
  actor: Actor;
  /** The site's bin stock, as the New batch screen reads it. */
  stock: Map<string, WarehouseBinStock>;
}

export interface TabResult {
  name: string;
  rows: number;
  created: number;
  changed: number;
  unchanged: number;
  errors: RowError[];
  warnings: RowWarning[];
  samples: Sample[];
}

/** One uploaded row, re-keyed from the file's headers to the tab's keys; only the columns the file has. */
type Cells = Map<string, string | null>;
type Outcome = "created" | "changed" | "unchanged";

/** A row the file got wrong in a way the rules never see (a cell, a missing link): reported like a rule's refusal. */
const refuse = (message: string): never => { throw new ValidationError(message); };

const upper = (v: string | null) => (v ?? "").trim().toUpperCase();
const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim() === (b ?? "").trim();
const label = (tab: Tab, key: string) => tab.fields.find((f) => f.key === key)?.label ?? key;

/** The labels of the given columns whose file value differs from the saved one (only columns the file has). */
function differs(tab: Tab, cells: Cells, saved: Record<string, string | null | undefined>, eq = same): string[] {
  return Object.keys(saved).filter((k) => cells.has(k) && !eq(cells.get(k), saved[k])).map((k) => label(tab, k));
}
const savedNote = (what: string, cols: string[], how: string) =>
  `${what} is already saved, and the file can't change it (it differs in ${cols.join(", ")}). ${how}`;

/** RCN Receipt ID or BTM No → the one load it names at this site. */
async function loadOf(ctx: ProductionCtx, cells: Cells) {
  const id = upper(cells.get("receiptId") ?? null);
  const btm = (cells.get("btmNo") ?? "").trim();
  if (id) {
    const load = await ctx.tx.rcnReceipt.findFirst({ where: { id, batch: { warehouse: ctx.site } }, select: { id: true, btmNo: true, finalisedAt: true } });
    if (!load) return refuse(`RCN Receipt ${id} doesn't exist at ${ctx.site}.`);
    if (btm && upper(btm) !== upper(load.btmNo)) refuse(`${id} is BTM ${load.btmNo}, not BTM ${btm}.`);
    return load;
  }
  if (!btm) return refuse("Give the RCN Receipt ID or the BTM No of the load.");
  const loads = await ctx.tx.rcnReceipt.findMany({
    where: { btmNo: { equals: btm, mode: "insensitive" }, batch: { warehouse: ctx.site } }, select: { id: true, btmNo: true, finalisedAt: true }, orderBy: { id: "asc" },
  });
  if (loads.length === 0) return refuse(`No load with BTM ${btm} at ${ctx.site}. Add it on the RCN Receipts tab first.`);
  // The client's own file has real repeats (BTM 120 twice from BIN-03B), so a BTM alone may not be enough.
  if (loads.length > 1) refuse(`BTM ${btm} is on ${loads.length} loads (${loads.map((l) => l.id).join(", ")}). Give the RCN Receipt ID instead.`);
  return loads[0]!;
}

// ── One processor per tab: what a new row does, and what an existing one may and may not do ─────────

async function batchRow(ctx: ProductionCtx, tab: Tab, cells: Cells): Promise<Outcome> {
  const code = upper(cells.get("code") ?? null);
  if (!code) refuse("Give the batch a name.");
  const saved = await ctx.tx.productionBatch.findUnique({ where: { code }, include: { bins: { select: { binCode: true } } } });
  if (!saved) {
    await createBatchIn(ctx.tx, ctx.site, ctx.actor.id, {
      code, startDate: cells.get("startDate") ?? undefined, proposedBy: cells.get("proposedBy") ?? undefined, bins: splitList(cells.get("bins") ?? null),
    }, ctx.stock);
    return "created";
  }
  if (saved.warehouse !== ctx.site) refuse(`Batch ${code} belongs to ${saved.warehouse}.`);
  const binSet = (v: string | null | undefined) => splitList(v ?? null).map((b) => b.toUpperCase()).sort().join("/");
  const off = [
    ...differs(tab, cells, { startDate: saved.startDate, proposedBy: saved.proposedBy }),
    ...differs(tab, cells, { bins: saved.bins.map((b) => b.binCode).join("/") }, (a, b) => binSet(a) === binSet(b)),
  ];
  if (off.length) refuse(savedNote(`Batch ${code}`, off, "Leave the row as it was exported, or give a new batch a new name."));
  return "unchanged";
}

async function receiptRow(ctx: ProductionCtx, tab: Tab, cells: Cells, warn: (m: string) => void): Promise<Outcome> {
  const id = upper(cells.get("id") ?? null);
  if (id) {
    const saved = await ctx.tx.rcnReceipt.findFirst({ where: { id, batch: { warehouse: ctx.site } } });
    if (!saved) refuse(`RCN Receipt ${id} doesn't exist at ${ctx.site}. Leave the ID blank to add a new load.`);
    const off = differs(tab, cells, { batchCode: saved!.batchCode, date: saved!.date, btmNo: saved!.btmNo, binCode: saved!.binCode }, (a, b) => upper(a ?? null) === upper(b ?? null));
    if (off.length) refuse(savedNote(id, off, "Leave the row as it was exported."));
    return "unchanged";
  }
  const input = { batchCode: cells.get("batchCode") ?? undefined, date: cells.get("date") ?? undefined, btmNo: cells.get("btmNo") ?? undefined, binCode: cells.get("binCode") ?? undefined };
  // The doc makes a repeated BTM from the same bin a warning, not a refusal; the screen shows it too.
  const others = await ctx.tx.rcnReceipt.findMany({ where: { batch: { warehouse: ctx.site } }, select: { id: true, btmNo: true, binCode: true } });
  const repeats = sameBtmAndBin(others, (input.btmNo ?? "").trim(), upper(input.binCode ?? null));
  await createRcnReceiptIn(ctx.tx, ctx.site, ctx.actor.id, input);
  if (repeats.length) warn(`BTM ${input.btmNo} from ${upper(input.binCode ?? null)} is already on ${repeats.map((r) => r.id).join(", ")}.`);
  return "created";
}

const GRAM_KEYS = CUT_TEST_GRAMS.map(([key]) => key);
/** The file says OK or Hold (the screen's "Fail" is accepted too); anything else goes to the rule's own check. */
const decisionOf = (v: string | null) => {
  const d = (v ?? "").trim().toLowerCase();
  return d === "ok" ? "ok" : d === "hold" || d === "fail" ? "hold" : d;
};

async function checkRow(ctx: ProductionCtx, tab: Tab, cells: Cells): Promise<Outcome> {
  const raw = (cells.get("id") ?? "").trim();
  if (raw) {
    const id = Number(raw);
    const saved = Number.isInteger(id) ? await ctx.tx.rcnMoistureCheck.findFirst({ where: { id, rcnReceipt: { batch: { warehouse: ctx.site } } } }) : null;
    if (!saved) refuse(`Moisture check ${raw} doesn't exist at ${ctx.site}. Leave the Check ID blank to add a new check.`);
    if (cells.get("receiptId") || cells.get("btmNo")) {
      const load = await loadOf(ctx, cells);
      if (load.id !== saved!.rcnReceiptId) refuse(`Check ${raw} is for ${saved!.rcnReceiptId}, not ${load.id}.`);
    }
    const off = [
      ...differs(tab, cells, { moisture: saved!.moisture, nutCount: saved!.nutCount, sampleG: saved!.sampleG, ...Object.fromEntries(GRAM_KEYS.map((k) => [k, saved![k]])) }),
      ...differs(tab, cells, { decision: saved!.decision }, (a, b) => decisionOf(a ?? null) === b),
    ];
    if (off.length) refuse(savedNote(`Check ${raw}`, off, "A saved check isn't edited: add a re-check as a new row."));
    return "unchanged";
  }
  const load = await loadOf(ctx, cells);
  const input: MoistureCheckInput = {
    moisture: cells.get("moisture") ?? undefined, nutCount: cells.get("nutCount") ?? undefined, sampleG: cells.get("sampleG") ?? undefined,
    decision: decisionOf(cells.get("decision") ?? null) as MoistureCheckInput["decision"],
    ...Object.fromEntries(GRAM_KEYS.map((k) => [k, cells.get(k) ?? undefined])),
  };
  // As on screen: an Incharge's or Admin's check is approved as it is saved (they are the only ones who upload).
  await submitMoistureCheckIn(ctx.tx, ctx.site, ctx.actor, load.id, input);
  return "created";
}

async function palletRow(ctx: ProductionCtx, tab: Tab, cells: Cells, sample: (key: string, changes: Change[]) => void): Promise<Outcome> {
  const raw = (cells.get("id") ?? "").trim();
  const values = { grossKg: cells.get("grossKg") ?? undefined, bags: cells.get("bags") ?? undefined, factoryBin: cells.get("factoryBin") ?? undefined };
  if (!raw) {
    const load = await loadOf(ctx, cells);
    await addPalletIn(ctx.tx, ctx.site, ctx.actor.id, load.id, values);
    return "created";
  }
  const id = Number(raw);
  const saved = Number.isInteger(id) ? await ctx.tx.rcnPallet.findFirst({ where: { id, rcnReceipt: { batch: { warehouse: ctx.site } } } }) : null;
  if (!saved) refuse(`Pallet ${raw} doesn't exist at ${ctx.site}. Leave the Pallet ID blank to add a new pallet.`);
  if (cells.get("receiptId") || cells.get("btmNo")) {
    const load = await loadOf(ctx, cells);
    if (load.id !== saved!.rcnReceiptId) refuse(`Pallet ${raw} is on ${saved!.rcnReceiptId}, not ${load.id}.`);
  }
  const now = { grossKg: saved!.grossKg, bags: saved!.bags, factoryBin: saved!.factoryBin };
  const changes = (Object.keys(now) as (keyof typeof now)[])
    .filter((k) => cells.has(k) && !(k === "factoryBin" ? upper(cells.get(k)!) === upper(now[k]) : same(cells.get(k), now[k])))
    .map((k) => ({ column: label(tab, k), from: now[k], to: cells.get(k) ?? "" }));
  if (!changes.length) return "unchanged";
  // The screen corrects a pallet in place until the final weight is saved, and so does the file.
  await updatePalletIn(ctx.tx, ctx.site, id, { ...now, ...Object.fromEntries(Object.entries(values).filter(([k]) => cells.has(k))) });
  sample(`Pallet ${raw}`, changes);
  return "changed";
}

async function finalRow(ctx: ProductionCtx, tab: Tab, cells: Cells): Promise<Outcome> {
  const load = await loadOf(ctx, cells);
  const weights = splitList(cells.get("emptyPalletsKg") ?? null);
  const counts = splitList(cells.get("emptyPalletsCount") ?? null);
  if (load.finalisedAt) {
    const saved = await ctx.tx.rcnReceipt.findUniqueOrThrow({ where: { id: load.id }, include: { emptyPallets: { orderBy: { id: "asc" } } } });
    const list = (xs: (string | null)[]) => xs.map((x) => (x ?? "").trim()).join("/");
    const off: string[] = [];
    if (cells.has("emptyPalletsKg") && list(weights) !== list(saved.emptyPallets.map((s) => s.weightKg))) off.push(label(tab, "emptyPalletsKg"));
    // The export leaves counts blank when a stack had none, so only counts that were given are compared.
    if (counts.length && list(counts) !== list(saved.emptyPallets.map((s) => s.count))) off.push(label(tab, "emptyPalletsCount"));
    off.push(...differs(tab, cells, { dustKg: saved.dustKg, voidsKg: saved.voidsKg }));
    if (off.length) refuse(savedNote(`The final weight of ${load.id}`, off, "Once saved, a load's weighing is closed."));
    return "unchanged";
  }
  const given = weights.length || counts.length || ["dustKg", "voidsKg"].some((k) => (cells.get(k) ?? "").trim());
  if (!given) return "unchanged"; // a row naming the load and nothing else records nothing
  if (counts.length && counts.length !== weights.length) refuse(`Give one pallet count per empty-pallet weight (${weights.length}), or none.`);
  await saveFinalWeightIn(ctx.tx, ctx.site, ctx.actor.id, load.id, {
    emptyPallets: weights.map((weightKg, i) => ({ weightKg, count: counts[i] })),
    dustKg: cells.get("dustKg") ?? undefined, voidsKg: cells.get("voidsKg") ?? undefined,
  });
  return "created";
}

// ── Phase 2: Calibration ─────────────────────────────────────────────────────────────────────────

/** Kg or grams compare as numbers: Excel hands 2335 back for a cell the screen saved as "2335.0". */
const sameNumber = (a: string | null | undefined, b: string | null | undefined) => {
  const [x, y] = [(a ?? "").trim(), (b ?? "").trim()];
  return x === y || (x !== "" && y !== "" && Number(x) === Number(y));
};
const sizesOfFile = (cells: Cells) => Object.fromEntries(SILO_SIZES.flatMap((s) => {
  const v = cells.get(runKgKey(s.key));
  return v ? [[s.key, v]] : [];
})) as Partial<Record<(typeof SILO_SIZES)[number]["key"], string>>;
const sameSizes = (a: Record<string, string | undefined>, b: Record<string, string | undefined>) => SILO_SIZES.every((s) => sameNumber(a[s.key], b[s.key]));

async function runRow(ctx: ProductionCtx, cells: Cells): Promise<Outcome> {
  const raw = (cells.get("id") ?? "").trim();
  if (raw) {
    const id = Number(raw);
    const saved = Number.isInteger(id) ? await ctx.tx.rcnCalibrationRun.findFirst({ where: { id, rcnReceipt: { batch: { warehouse: ctx.site } } } }) : null;
    if (!saved) return refuse(`Calibration run ${raw} doesn't exist at ${ctx.site}. Leave the Run ID blank to add a new run.`);
    if (cells.get("date") !== undefined && !same(cells.get("date"), saved.date)) refuse(savedNote(`Run ${raw}`, ["Date"], "Remove it on the batch page and add it again."));
    if (!sameSizes(sizesOfFile(cells), runSizes(saved))) refuse(savedNote(`Run ${raw}`, ["the kg per size"], "Remove it on the batch page and add it again."));
    return "unchanged";
  }
  const load = await loadOf(ctx, cells);
  const sizes = sizesOfFile(cells);
  const date = (cells.get("date") ?? "").trim();
  const saved = await ctx.tx.rcnCalibrationRun.findMany({ where: { rcnReceiptId: load.id, date } });
  if (saved.some((r) => sameSizes(sizes, runSizes(r)))) return "unchanged";
  await addCalibrationRunIn(ctx.tx, ctx.site, ctx.actor.id, load.id, { date, sizes });
  return "created";
}

const siloDecisionOf = (v: string | null) => {
  const d = (v ?? "").trim().toLowerCase();
  return d === "no" ? "fail" : d;
};
const gramsOfFile = (cells: Cells): SizingGrams => Object.fromEntries(SIZING_GRADES.flatMap((g) => {
  const v = cells.get(gramKey(g));
  return v ? [[g, v]] : [];
}));
const savedGrams = (c: Record<string, unknown>): SizingGrams => Object.fromEntries(SIZING_GRADES.flatMap((g) => {
  const v = c[g === "under" ? "gUnder" : `g${g}`];
  return typeof v === "string" ? [[g, v]] : [];
}));
const sameGrams = (a: SizingGrams, b: SizingGrams) => SIZING_GRADES.every((g) => sameNumber(a[g], b[g]));

async function siloCheckRow(ctx: ProductionCtx, cells: Cells): Promise<Outcome> {
  const raw = (cells.get("id") ?? "").trim();
  const point = samplingPointFromWord(cells.get("point"));
  const grams = gramsOfFile(cells);
  const decision = siloDecisionOf(cells.get("decision") ?? null);
  if (raw) {
    const id = Number(raw);
    const saved = Number.isInteger(id) ? await ctx.tx.sizingCheck.findFirst({ where: { id, batch: { warehouse: ctx.site } } }) : null;
    if (!saved) return refuse(`Silo check ${raw} doesn't exist at ${ctx.site}. Leave the Check ID blank to add a new check.`);
    const unchanged = same(cells.get("date"), saved.date) && point === saved.point && sameGrams(grams, savedGrams(saved)) && decision === saved.decision;
    if (!unchanged) refuse(`Silo check ${raw} is already saved, and the file can't change it. A saved check isn't edited: add a new check as a new row.`);
    return "unchanged";
  }
  const batchCode = upper(cells.get("batchCode") ?? null);
  const date = (cells.get("date") ?? "").trim();
  if (point) {
    const twins = await ctx.tx.sizingCheck.findMany({ where: { batchCode, date, point, decision, batch: { warehouse: ctx.site } } });
    if (twins.some((c) => sameGrams(grams, savedGrams(c)))) return "unchanged";
  }
  // As on screen: an Incharge's or Admin's check is approved as it is saved (they are the only ones who upload).
  await submitSizingCheckIn(ctx.tx, ctx.site, ctx.actor, {
    batchCode, date, point: point ?? undefined, binCode: cells.get("binCode") ?? undefined, nutCount: cells.get("nutCount") ?? undefined,
    sampleG: cells.get("sampleG") ?? undefined, grams, decision,
  });
  return "created";
}

async function siloMoveRow(ctx: ProductionCtx, cells: Cells): Promise<Outcome> {
  const raw = (cells.get("id") ?? "").trim();
  const from = siloFromWord(cells.get("fromSize"));
  const to = siloFromWord(cells.get("toSize"));
  const kg = (cells.get("kg") ?? "").trim();
  const date = (cells.get("date") ?? "").trim();
  if (raw) {
    const id = Number(raw);
    const saved = Number.isInteger(id) ? await ctx.tx.manualCalibration.findFirst({ where: { id, sizingCheck: { batch: { warehouse: ctx.site } } } }) : null;
    if (!saved) return refuse(`Silo move ${raw} doesn't exist at ${ctx.site}. Leave the Move ID blank to add a new move.`);
    if (!(same(date, saved.date) && from === saved.fromSize && to === saved.toSize && sameNumber(kg, saved.kg))) refuse(`Silo move ${raw} is already saved, and the file can't change it.`);
    return "unchanged";
  }
  if (!from) return refuse("From Silo must be one of A++, A+, A, AB, B, BC, C, D or DE.");
  // The check that decides the silo now, as on screen: nuts move only because of it, and a silo that has since passed needs no move.
  const standing = await ctx.tx.sizingCheck.findFirst({ where: { point: from, status: "approved", batch: { warehouse: ctx.site } }, orderBy: { id: "desc" } });
  if (!standing || standing.decision !== "fail") return refuse(`Silo ${siloLabel(from)} has no failed check to act on. Add its failed check on the Silo Checks tab first.`);
  const twin = await ctx.tx.manualCalibration.findMany({ where: { sizingCheckId: standing.id, date, toSize: to ?? "" } });
  if (twin.some((m) => sameNumber(m.kg, kg))) return "unchanged";
  await addManualCalibrationIn(ctx.tx, ctx.site, ctx.actor.id, standing.id, { date, fromSize: from, toSize: to ?? undefined, kg });
  return "created";
}

// ── The file → tabs → rows ───────────────────────────────────────────────────────────────────────

/** The uploaded sheet's headers → the tab's keys. Our own derived columns are skipped quietly; strangers are reported. */
function cellsOf(tab: Tab, sheet: ParsedSheet, notices: string[]) {
  const byLabel = new Map(tab.fields.map((f) => [tabHeader(f.label), f]));
  const unknown = sheet.headers.filter((h) => !byLabel.has(tabHeader(h)));
  if (unknown.length) notices.push(`${tab.title}: ${unknown.map((u) => `"${u}"`).join(", ")} ${unknown.length > 1 ? "aren't columns we use" : "isn't a column we use"} — ignored.`);
  const columns = sheet.headers.flatMap((h) => {
    const f = byLabel.get(tabHeader(h));
    return f && !f.derived ? [[h, f.key] as const] : [];
  });
  return {
    keys: new Set(columns.map(([, k]) => k)),
    rows: sheet.rows.map((r) => {
      const cells: Cells = new Map();
      const bad: RowError[] = [];
      for (const [h, key] of columns) {
        const p = parseCell(r.cells[h], "String");
        if (p.ok) cells.set(key, p.value === null ? null : String(p.value).trim() || null);
        else bad.push({ row: r.rowNumber, column: label(tab, key), message: p.error });
      }
      return { rowNumber: r.rowNumber, cells, bad };
    }),
  };
}

/** Each tab's link column(s): without them every row would look new, or could name no load. */
const NEEDS: Record<Tab["id"], string[][]> = {
  batches: [["code"]], receipts: [["id"]], checks: [["id"], ["receiptId", "btmNo"]], pallets: [["id"], ["receiptId", "btmNo"]], final: [["receiptId", "btmNo"]],
  runs: [["id"], ["receiptId", "btmNo"]], siloChecks: [["id"], ["batchCode"]], siloMoves: [["id"], ["fromSize"]],
};

export async function runProductionWorkbook(ctx: ProductionCtx, wb: ParsedWorkbook): Promise<{ tabs: TabResult[]; notices: string[] }> {
  const notices = [...wb.notices];
  const byTitle = new Map([...wb.sheets.values()].map((s) => [normalizeHeader(s.name), s]));
  for (const s of wb.sheets.values()) {
    if (!TABS.some((t) => normalizeHeader(t.title) === normalizeHeader(s.name))) notices.push(`Sheet "${s.name}" isn't one of the production workbook's tabs — ignored.`);
  }
  if (!wb.sheets.size) notices.push("The file has no data sheets.");

  const tabs: TabResult[] = [];
  // In the order things happen, so each row finds what the rows before it created.
  for (const tab of TABS) {
    const sheet = byTitle.get(normalizeHeader(tab.title));
    if (!sheet) continue;
    const result: TabResult = { name: tab.title, rows: sheet.rows.length, created: 0, changed: 0, unchanged: 0, errors: [], warnings: [], samples: [] };
    tabs.push(result);
    const { keys, rows } = cellsOf(tab, sheet, notices);
    const missing = NEEDS[tab.id].find((any) => !any.some((k) => keys.has(k)));
    if (missing) {
      result.errors.push({ row: 1, column: missing.map((k) => label(tab, k)).join(" or "), message: `the "${missing.map((k) => label(tab, k)).join('" or "')}" column is missing` });
      continue;
    }

    for (const { rowNumber, cells, bad } of rows) {
      if (bad.length) { result.errors.push(...bad); continue; }
      const warn = (message: string) => result.warnings.push({ row: rowNumber, message, severity: "warning" });
      const sample = (key: string, changes: Change[]) => { if (result.samples.length < SAMPLE_LIMIT) result.samples.push({ row: rowNumber, key, changes }); };
      try {
        const outcome =
          tab.id === "batches" ? await batchRow(ctx, tab, cells)
          : tab.id === "receipts" ? await receiptRow(ctx, tab, cells, warn)
          : tab.id === "checks" ? await checkRow(ctx, tab, cells)
          : tab.id === "pallets" ? await palletRow(ctx, tab, cells, sample)
          : tab.id === "final" ? await finalRow(ctx, tab, cells)
          : tab.id === "runs" ? await runRow(ctx, cells)
          : tab.id === "siloChecks" ? await siloCheckRow(ctx, cells)
          : await siloMoveRow(ctx, cells);
        result[outcome]++;
      } catch (e) {
        // A rule's refusal is the row's problem; anything else (the database) stops the whole upload.
        if (e instanceof ValidationError) result.errors.push({ row: rowNumber, message: e.message });
        else throw e;
      }
    }
  }
  return { tabs, notices };
}
