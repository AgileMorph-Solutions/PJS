/**
 * An uploaded production workbook, row by row, through the SAME rule code the production screens call
 * (createRcnReceiptIn, submitMoistureCheckIn, addPalletsIn, saveFinalWeightIn,
 * submitSizingCheckIn, addManualCalibrationIn). A load's acceptance by production is also its calibration: there is no
 * tab for either. Only Admin and the Production Incharge upload (tabs.ts mayUploadTab), and nothing they upload waits for
 * an approval: checks are saved approved and finished loads accepted.
 * Nothing here re-states a rule: a bin already in a batch, a load that isn't due a check, a pallet on a load
 * that isn't weighable — each is refused by the function that refuses it on screen, with the same words.
 *
 * Unlike Reception's workbook, whose sheets are planned without writing, this runs inside one transaction
 * that the caller rolls back for a preview and commits for an Apply. That is what lets a row lean on the rows
 * above it, as the screens lean on what was saved before: a load made from the tally sheet is there for its checks.
 *
 * Saved records are never rewritten from the file except where the app itself edits them (a load's final weight). Anything else that differs is reported, so an edit is never silently lost.
 * A new row identical to a saved one (a silo check, a move, a cooking row) is the same record uploaded twice, not a
 * second record: the doc says an upload is "never duplicated".
 */
import type { Prisma } from "@prisma/client";
import { canRunProduction } from "@anagroci/contract/data/roles";
import type { WarehouseBinStock } from "@anagroci/contract/domain/productionBatch";
import { isIsoDate } from "@anagroci/contract/domain/dateFormat";
import { WASTE_CATEGORIES, streamFromCategory, truckCategory, type Stream } from "@anagroci/contract/domain/byProducts";
import { SILO_SIZES, SIZING_GRADES, samplingPointFromWord, siloFromWord, siloLabel, type SizingGrams } from "@anagroci/contract/domain/calibration";
import { ENTRY_DEFS, normalizeEntryValues, type EntryKind } from "@anagroci/contract/domain/lotEntries";
import { SHELLING_KG_FIELDS } from "@anagroci/contract/domain/shelling";
import { CUT_TEST_GRAMS, acceptanceProblem, sameBtmAndBin } from "@anagroci/contract/domain/rcnReceipt";
import { palletError, weighingTotals } from "@anagroci/contract/domain/rcnWeighing";
import type { MoistureCheckInput } from "@anagroci/contract/types/rcnReceipt";
import { ValidationError } from "../validation.js";
import { parseCell } from "../workbook/cells.js";
import { normalizeHeader } from "../workbook/fields.js";
import type { Change, ParsedSheet, ParsedWorkbook, RowError, RowWarning, Sample } from "../workbook/types.js";
import { SAMPLE_LIMIT } from "../workbook/types.js";
import { createBatchIn, runWhere } from "../../services/production/batches.js";
import { addBoilerReadingIn, addTruckIn, updateTruckIn } from "../../services/production/byProducts.js";
import { addManualCalibrationIn, submitSizingCheckIn } from "../../services/production/calibration.js";
import { addLotEntryIn, addShellingDayIn, cookLotIn, moveToCoolingIn } from "../../services/production/factoryLots.js";
import { acceptRcnReceiptIn, createRcnReceiptIn, receiptAt, runSizes, setRcnCropYearIn, submitMoistureCheckIn, toView, type Actor } from "../../services/production/rcnReceipts.js";
import { addPalletsIn, saveFinalWeightIn } from "../../services/production/rcnWeighing.js";
import { INTAKE_TABS, README_TITLE, RUN_ORDER, SORTER_POINTS, gramKey, mayUploadTab, runKgKey, splitList, tabHeader, TABS, type Tab } from "./tabs.js";

type Tx = Prisma.TransactionClient;

export interface ProductionCtx {
  tx: Tx;
  site: string;
  actor: Actor;
  /** The site's bin stock, as the New run screen reads it: an upload starts a run with the same rules. */
  stock: Map<string, WarehouseBinStock>;
  /** Source bins new to production that the file couldn't start a run with, and why: their loads say so. */
  binProblems?: Map<string, string>;
  /** The loads the file's intake tabs made or added to: the ones an upload covering both sides may accept. */
  loads?: Set<string>;
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

/** RCN Receipt ID, or BTM No (and Source Bin, when given) → the one load it names at this site. */
async function loadOf(ctx: ProductionCtx, cells: Cells) {
  const id = upper(cells.get("receiptId") ?? null);
  const btm = (cells.get("btmNo") ?? "").trim();
  const bin = upper(cells.get("binCode") ?? null);
  if (id) {
    const load = await ctx.tx.rcnReceipt.findFirst({ where: { id, batch: { warehouse: ctx.site } }, select: { id: true, btmNo: true, finalisedAt: true } });
    if (!load) return refuse(`RCN Receipt ${id} doesn't exist at ${ctx.site}.`);
    if (btm && upper(btm) !== upper(load.btmNo)) refuse(`${id} is BTM ${load.btmNo}, not BTM ${btm}.`);
    return load;
  }
  if (!btm) return refuse("Give the RCN Receipt ID or the BTM No of the load.");
  const from = bin ? ` from ${bin}` : "";
  const loads = await ctx.tx.rcnReceipt.findMany({
    where: { btmNo: { equals: btm, mode: "insensitive" }, ...(bin ? { binCode: bin } : {}), batch: { warehouse: ctx.site } },
    select: { id: true, btmNo: true, finalisedAt: true }, orderBy: { id: "asc" },
  });
  if (loads.length === 0) return refuse(`No load with BTM ${btm}${from} at ${ctx.site}. Add it on the RCN Receipts or RCN Receipts summary tab first.`);
  // One BTM can come from several bins (BTM 122 from three), and the client's file has real repeats (BTM 120 twice
  // from BIN-03B), so a BTM alone may not be enough.
  if (loads.length > 1) refuse(`BTM ${btm}${from} is on ${loads.length} loads (${loads.map((l) => l.id).join(", ")}). Give the RCN Receipt ID${bin ? "" : " or the Source Bin"} instead.`);
  return loads[0]!;
}

// ── One processor per tab: what a new row does, and what an existing one may and may not do ─────────

/** The production run a row names (by its ID or its name), as its ID; the text itself when no run has it. */
async function runCodeOf(ctx: ProductionCtx, written: string | null | undefined): Promise<string | null> {
  const ref = upper(written ?? null);
  if (!ref) return null;
  const run = await ctx.tx.productionBatch.findFirst({ where: runWhere(ctx.site, ref), select: { code: true } });
  return run?.code ?? ref;
}

/**
 * The register's row: a load by its BTM No and Source Bin, with no ID (the IDs live in the app, team decision Nov 2026).
 * A load already saved with them is that load — the tally sheet (the first tab) makes its loads, a person may well fill
 * both tabs in, and an export comes back with every load on it. A genuine second load of the same BTM and bin (the
 * register's BTM 120) is recorded on screen, where the doc makes it a warning rather than a refusal.
 */
async function receiptRow(ctx: ProductionCtx, cells: Cells, warn: (m: string) => void): Promise<Outcome> {
  const input = { date: cells.get("date") ?? undefined, cropYear: cells.get("cropYear") ?? undefined, btmNo: cells.get("btmNo") ?? undefined, binCode: cells.get("binCode") ?? undefined };
  const others = await ctx.tx.rcnReceipt.findMany({ where: { batch: { warehouse: ctx.site } }, select: { id: true, btmNo: true, binCode: true, date: true, cropYear: true } });
  const saved = sameBtmAndBin(others, (input.btmNo ?? "").trim(), upper(input.binCode ?? null));
  if (saved.length) {
    // A saved load's date isn't changed from the file; a different one is said, not silently dropped.
    const off = saved.filter((r) => input.date && r.date !== input.date.trim());
    if (off.length === saved.length) warn(`BTM ${input.btmNo} from ${upper(input.binCode ?? null)} is already ${saved.map((r) => `${r.id}, dated ${r.date}`).join("; ")}: the file's date ${input.date} isn't used.`);
    // The register is where a crop year comes from for a load the tally sheet made: it fills the gap, as the screen does.
    const year = (input.cropYear ?? "").trim();
    if (year && saved.length === 1 && saved[0]!.cropYear !== year) {
      if (saved[0]!.cropYear) warn(`${saved[0]!.id} has crop year ${saved[0]!.cropYear}; the file's ${year} isn't used. Change it on the load's page.`);
      else { await setRcnCropYearIn(ctx.tx, ctx.site, saved[0]!.id, year); return "changed"; }
    }
    return "unchanged";
  }
  binReady(ctx, upper(input.binCode ?? null));
  ctx.loads?.add((await createRcnReceiptIn(ctx.tx, ctx.site, ctx.actor.id, input)).id);
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
  // The same check of the same load again is the file uploaded twice, as the other tabs read their twins; a real
  // re-check after drying has its own readings.
  const twins = await ctx.tx.rcnMoistureCheck.findMany({ where: { rcnReceiptId: load.id, status: { not: "rejected" } } });
  const keys = ["moisture", "nutCount", "sampleG", ...GRAM_KEYS] as const;
  if (twins.some((c) => c.decision === input.decision && keys.every((k) => sameNumber(cells.get(k), c[k])))) return "unchanged";
  // An upload needs no approval (team, 18 Nov 2026): only Admin and the Production Incharge upload, so the check counts as saved.
  await submitMoistureCheckIn(ctx.tx, ctx.site, ctx.actor, load.id, input, { approved: true });
  ctx.loads?.add(load.id);
  return "created";
}

// ── The tally sheet: one row per pallet, one load per BTM and Source BIN ─────────────────────────────

/**
 * The client's tally sheet holds a whole load's weighing on its pallet rows: each row's gross and bags, the empty
 * pallets' weighings scattered over some rows, dust and voids on one. So its rows are read a load at a time: every row of
 * one BTM from one Source BIN is one load, made when the app doesn't have it yet. The register's one-row-per-load view is
 * then the RCN Receipts tab of the export, worked out, never typed.
 *
 * The tab carries none of the app's IDs (no Pallet ID, no RCN Receipt ID): it is the client's sheet as they know it, and
 * the IDs live in the app (team decision, Nov 2026). So a pallet is never corrected from the file — that is done on the
 * load's screen — and a file's rows for a load already weighed must be that same weighing.
 */
type TallyRow = { rowNumber: number; cells: Cells };
type Tally = { rows: TallyRow[]; btm: string; bin: string };

const filled = (cells: Cells, key: string) => (cells.get(key) ?? "").trim() !== "";
const palletOf = (cells: Cells) => ({ grossKg: cells.get("grossKg") ?? undefined, bags: cells.get("bags") ?? undefined, factoryBin: cells.get("factoryBin") ?? undefined });
const isPalletRow = (cells: Cells) => ["grossKg", "bags"].some((k) => filled(cells, k));
const kgWord = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** The load the rows are for; made from their first row when the app doesn't have it yet. */
async function tallyLoad(ctx: ProductionCtx, t: Tally, warn: (row: number, m: string) => void): Promise<{ id: string; isNew: boolean }> {
  const loads = await ctx.tx.rcnReceipt.findMany({
    where: { btmNo: { equals: t.btm, mode: "insensitive" }, binCode: t.bin, batch: { warehouse: ctx.site } }, select: { id: true, date: true }, orderBy: { id: "asc" },
  });
  // The client's own register has a real repeat (BTM 120 twice from BIN-03B). With no ID in the sheet, the file can't say
  // which of the two loads its rows are for: they are entered on that load's screen instead.
  if (loads.length > 1) refuse(`BTM ${t.btm} from ${t.bin} is on ${loads.length} loads (${loads.map((l) => l.id).join(", ")}), so the file can't tell which one these rows are for. Enter them on that load's screen.`);
  const dates = [...new Set(t.rows.map((r) => (r.cells.get("date") ?? "").trim()).filter(Boolean))];
  const loadDate = loads[0]?.date ?? dates[0];
  const others = dates.filter((d) => d !== loadDate);
  if (others.length) warn(t.rows[0]!.rowNumber, `BTM ${t.btm} from ${t.bin} has rows dated ${others.join(", ")}; the load is dated ${loadDate}.`);
  if (loads[0]) return { id: loads[0].id, isNew: false };
  binReady(ctx, t.bin);
  const row = await createRcnReceiptIn(ctx.tx, ctx.site, ctx.actor.id, { date: dates[0], btmNo: (t.rows[0]!.cells.get("btmNo") ?? "").trim(), binCode: t.bin });
  return { id: row.id, isNew: true };
}

/** A row's Dust (or Voids): as typed when one row has it, their sum when several do (the sheet's own SUMIF). */
function combined(rows: TallyRow[], key: string): string | undefined {
  const xs = rows.map((r) => (r.cells.get(key) ?? "").trim()).filter(Boolean);
  if (xs.length <= 1) return xs[0];
  const ns = xs.map(Number);
  // Not all numbers: handed to the rule as written, whose own check then names the problem.
  if (ns.some((n) => !Number.isFinite(n))) return xs.join(" + ");
  return String(Math.round(ns.reduce((a, b) => a + b, 0) * 100) / 100);
}

/** One load's rows: the load, its pallets, then its final weight. Problems are the rows' own; a load-wide one is its first row's. */
async function tallyOne(ctx: ProductionCtx, tab: Tab, t: Tally, result: TabResult, notices: string[], sample: (row: number, key: string, changes: Change[]) => void) {
  const first = t.rows[0]!.rowNumber;
  const warn = (row: number, message: string) => result.warnings.push({ row, message, severity: "warning" });
  const fail = (row: number, e: unknown) => {
    if (e instanceof ValidationError) result.errors.push({ row, message: e.message });
    else throw e;
  };
  let load: { id: string; isNew: boolean };
  try { load = await tallyLoad(ctx, t, warn); } catch (e) { return fail(first, e); }
  ctx.loads?.add(load.id);
  const name = `BTM ${t.btm} from ${t.bin}`;

  const adds = t.rows.filter((r) => isPalletRow(r.cells));
  const saved = (await receiptAt(ctx.tx, ctx.site, load.id)).pallets;
  let wrote = load.isNew;
  if (adds.length && saved.length) {
    // A tally sheet uploaded again (or the export uploaded back): the same pallets are the same weighing, never a second.
    const same = saved.length === adds.length && adds.every((r, i) => {
      const p = saved[i]!;
      return sameNumber(r.cells.get("grossKg"), p.grossKg) && sameNumber(r.cells.get("bags"), p.bags) && upper(r.cells.get("factoryBin") ?? null) === upper(p.factoryBin);
    });
    if (!same) return fail(first, new ValidationError(`${name} already has ${saved.length} pallet${saved.length === 1 ? "" : "s"} weighed (${load.id}), and these ${adds.length} rows don't match them. To correct a pallet, change it on ${load.id}'s screen.`));
    result.unchanged += adds.length;
  } else if (adds.length) {
    // Each pallet through the screen's own check first, so a problem names its row; then the load's pallets in one write.
    let ok = true;
    for (const r of adds) {
      const problem = palletError(palletOf(r.cells));
      if (problem) { ok = false; result.errors.push({ row: r.rowNumber, message: problem }); }
    }
    if (!ok) return;
    try { await addPalletsIn(ctx.tx, ctx.site, ctx.actor, load.id, adds.map((r) => palletOf(r.cells))); } catch (e) { return fail(adds[0]!.rowNumber, e); }
    result.created += adds.length;
    wrote = true;
  }

  // The final weight: the empty pallets' weighings wherever they sit, dust and voids from whichever row has them.
  const stacks = t.rows.flatMap((r) => splitList(r.cells.get("palletKg") ?? null));
  const dustKg = combined(t.rows, "dustKg");
  const voidsKg = combined(t.rows, "voidsKg");
  if (stacks.length || dustKg || voidsKg) {
    try {
      const now = await receiptAt(ctx.tx, ctx.site, load.id);
      const sameFinal = now.finalisedAt !== null && stacks.length === now.emptyPallets.length
        && stacks.every((w, i) => sameNumber(w, now.emptyPallets[i]!.weightKg)) && sameNumber(dustKg, now.dustKg) && sameNumber(voidsKg, now.voidsKg);
      if (!sameFinal) {
        // Saved again, a final weight replaces the one before, as on screen ("both stay correctable").
        if (now.finalisedAt) sample(first, `${load.id} final weight`, [{ column: "Pallet Weight / Dust / Voids", from: [now.emptyPallets.map((s) => s.weightKg).join(" / "), now.dustKg ?? "", now.voidsKg ?? ""].join(" · "), to: [stacks.join(" / "), dustKg ?? "", voidsKg ?? ""].join(" · ") }]);
        await saveFinalWeightIn(ctx.tx, ctx.site, ctx.actor, load.id, { emptyPallets: stacks.map((weightKg) => ({ weightKg })), dustKg, voidsKg });
        if (!wrote) result.changed++;
        wrote = true;
      }
    } catch (e) { return fail(first, e); }
  }

  // What the load comes to, as the tally's own totals box says it, so the preview can be read against the paper.
  if (wrote) {
    const view = toView(await receiptAt(ctx.tx, ctx.site, load.id));
    const w = weighingTotals(view.pallets, view.finalWeight ?? undefined);
    const net = view.finalWeight ? ` · net ${kgWord(w.netKg)} kg · to silos ${kgWord(w.toSilosKg)} kg` : " · no pallet weight yet";
    notices.push(`${tab.title}: ${name}${load.isNew ? " (new load)" : ` (${load.id})`} · ${w.pallets} pallets · ${kgWord(w.bags)} bags · gross ${kgWord(w.grossKg)} kg${net}.`);
  }
}

async function tallyTab(ctx: ProductionCtx, tab: Tab, rows: { rowNumber: number; cells: Cells; bad: RowError[] }[], result: TabResult, notices: string[]) {
  const sample = (row: number, key: string, changes: Change[]) => { if (result.samples.length < SAMPLE_LIMIT) result.samples.push({ row, key, changes }); };
  const loads = new Map<string, Tally>();
  let skipped = 0;
  for (const { rowNumber, cells, bad } of rows) {
    if (bad.length) { result.errors.push(...bad); continue; }
    // The client's sheet runs its formulas down thousands of empty rows and ends on a totals row (=SUBTOTAL): none has
    // a BTM, bin or date of its own.
    if (!["btmNo", "binCode", "date"].some((k) => filled(cells, k))) { skipped++; continue; }
    const [btm, bin] = [upper(cells.get("btmNo") ?? null), upper(cells.get("binCode") ?? null)];
    if (!btm || !bin) { result.errors.push({ row: rowNumber, message: btm ? "Give the Source BIN the pallet came from." : "Give the BTM No of the pallet's load." }); continue; }
    const key = `${btm}|${bin}`;
    const t = loads.get(key) ?? { rows: [], btm, bin };
    t.rows.push({ rowNumber, cells });
    loads.set(key, t);
  }
  if (skipped) notices.push(`${tab.title}: ${skipped} row${skipped === 1 ? "" : "s"} with no BTM, bin or date (the sheet's empty formula rows, or its totals row) — skipped.`);
  for (const t of loads.values()) await tallyOne(ctx, tab, t, result, notices, sample);
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
    // A row naming no run matches no saved check; submitting it then says the run is missing.
    const runCode = (await runCodeOf(ctx, batchCode)) ?? "";
    const twins = await ctx.tx.sizingCheck.findMany({ where: { batchCode: runCode, date, point, decision, batch: { warehouse: ctx.site } } });
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

// ── Phases 3–4: Lots, by-products and the boiler ─────────────────────────────────────────────────

async function cookingRow(ctx: ProductionCtx, cells: Cells): Promise<Outcome> {
  const raw = (cells.get("id") ?? "").trim();
  const sizes = sizesOfFile(cells);
  const date = (cells.get("date") ?? "").trim();
  if (raw) {
    const id = Number(raw);
    const saved = Number.isInteger(id) ? await ctx.tx.lotCookRun.findFirst({ where: { id, lot: { batch: { warehouse: ctx.site } } } }) : null;
    if (!saved) return refuse(`Cooking row ${raw} doesn't exist at ${ctx.site}. Leave the Cooking ID blank to add a new row.`);
    if (!same(date, saved.date) || !sameSizes(sizes, runSizes(saved)) || !same(cells.get("damagedKg") ?? null, saved.damagedKg)) refuse(`Cooking row ${raw} is already saved, and the file can't change it. Remove it on the batch page and add it again.`);
    return "unchanged";
  }
  const code = upper(cells.get("lotCode") ?? null);
  const twins = code ? await ctx.tx.lotCookRun.findMany({ where: { lotCode: code, date, lot: { batch: { warehouse: ctx.site } } } }) : [];
  if (twins.some((r) => sameSizes(sizes, runSizes(r)) && same(cells.get("damagedKg") ?? null, r.damagedKg))) return "unchanged";
  await cookLotIn(ctx.tx, ctx.site, ctx.actor.id, { batchCode: cells.get("batchCode") ?? undefined, code, date, sizes, damagedKg: cells.get("damagedKg") ?? undefined });
  return "created";
}

async function coolingRow(ctx: ProductionCtx, cells: Cells): Promise<Outcome> {
  const code = upper(cells.get("lotCode") ?? null);
  if (!code) return refuse("Give the Lot No.");
  const lot = await ctx.tx.factoryLot.findFirst({ where: { code, batch: { warehouse: ctx.site } } });
  if (!lot) return refuse(`Lot ${code} doesn't exist at ${ctx.site}.`);
  const [date, time, silo] = [(cells.get("date") ?? "").trim(), (cells.get("time") ?? "").trim(), (cells.get("silo") ?? "").trim()];
  if (lot.coolingAt === `${date}T${time}` && lot.coolingSilo === silo) return "unchanged";
  await moveToCoolingIn(ctx.tx, ctx.site, code, { silo, date, time });
  return lot.coolingAt ? "changed" : "created";
}

/** OK and the kind's other answer; the screen's words are accepted too. Anything else goes to the rule's own check. */
const entryDecisionOf = (kind: EntryKind, v: string | null) => {
  const d = (v ?? "").trim().toLowerCase();
  const no = ENTRY_DEFS[kind].decision?.noValue;
  return d === "ok" ? "ok" : no && ["no", "wait", "fail"].includes(d) ? no : d;
};

async function entryRow(ctx: ProductionCtx, kind: EntryKind, cells: Cells): Promise<Outcome> {
  const def = ENTRY_DEFS[kind];
  const raw = (cells.get("id") ?? "").trim();
  const date = (cells.get("date") ?? "").trim();
  const values = normalizeEntryValues(kind, Object.fromEntries(def.fields.map((f) => [f.key, cells.get(`v_${f.key}`) ?? undefined])));
  const decision = def.decision ? entryDecisionOf(kind, cells.get("decision") ?? null) : undefined;
  const sameEntry = (e: { date: string; values: unknown; decision: string | null }) =>
    same(date, e.date) && (e.decision ?? undefined) === decision && def.fields.every((f) => sameNumber(values[f.key], (e.values as Record<string, string>)[f.key]));
  if (raw) {
    const id = Number(raw);
    const saved = Number.isInteger(id) ? await ctx.tx.lotEntry.findFirst({ where: { id, kind, lot: { batch: { warehouse: ctx.site } } } }) : null;
    if (!saved) return refuse(`${def.title} ${raw} doesn't exist at ${ctx.site}. Leave the Entry ID blank to add a new one.`);
    if (!sameEntry(saved)) refuse(`${def.title} ${raw} is already saved, and the file can't change it.`);
    return "unchanged";
  }
  const code = upper(cells.get("lotCode") ?? null);
  if (!code) return refuse("Give the Lot No.");
  const twins = await ctx.tx.lotEntry.findMany({ where: { lotCode: code, kind, date, lot: { batch: { warehouse: ctx.site } } } });
  if (twins.some(sameEntry)) return "unchanged";
  await addLotEntryIn(ctx.tx, ctx.site, ctx.actor, code, { kind, date, values, decision });
  return "created";
}

async function shellingDayRow(ctx: ProductionCtx, cells: Cells): Promise<Outcome> {
  const raw = (cells.get("id") ?? "").trim();
  const date = (cells.get("date") ?? "").trim();
  const input = (cells.get("inputKg") ?? "").trim();
  const kg = Object.fromEntries(SHELLING_KG_FIELDS.map(([k]) => [k, cells.get(k) ?? undefined]));
  const sameDay = (d: { date: string; inputKg: string } & Record<string, unknown>) =>
    same(date, d.date) && sameNumber(input, d.inputKg) && SHELLING_KG_FIELDS.every(([k]) => sameNumber(kg[k], d[k] as string | null));
  if (raw) {
    const id = Number(raw);
    const saved = Number.isInteger(id) ? await ctx.tx.shellingDay.findFirst({ where: { id, lot: { batch: { warehouse: ctx.site } } } }) : null;
    if (!saved) return refuse(`Day record ${raw} doesn't exist at ${ctx.site}. Leave the Day ID blank to add a new one.`);
    if (!sameDay(saved)) refuse(`Day record ${raw} is already saved, and the file can't change it. Remove it on the batch page and add it again.`);
    return "unchanged";
  }
  const code = upper(cells.get("lotCode") ?? null);
  if (!code) return refuse("Give the Lot No.");
  const twins = await ctx.tx.shellingDay.findMany({ where: { lotCode: code, date, lot: { batch: { warehouse: ctx.site } } } });
  if (twins.some(sameDay)) return "unchanged";
  await addShellingDayIn(ctx.tx, ctx.site, ctx.actor.id, code, { date, inputKg: input, ...kg });
  return "created";
}

async function boilerRow(ctx: ProductionCtx, cells: Cells): Promise<Outcome> {
  const raw = (cells.get("id") ?? "").trim();
  const [date, shellKg, runningHours] = [(cells.get("date") ?? "").trim(), (cells.get("shellKg") ?? "").trim(), (cells.get("runningHours") ?? "").trim()];
  const sameReading = (b: { date: string; shellKg: string; runningHours: string | null }) => same(date, b.date) && sameNumber(shellKg, b.shellKg) && sameNumber(runningHours, b.runningHours);
  if (raw) {
    const id = Number(raw);
    const saved = Number.isInteger(id) ? await ctx.tx.boilerReading.findFirst({ where: { id, warehouse: ctx.site } }) : null;
    if (!saved) return refuse(`Boiler reading ${raw} doesn't exist at ${ctx.site}. Leave the Reading ID blank to add a new one.`);
    if (!sameReading(saved)) refuse(`Boiler reading ${raw} is already saved, and the file can't change it.`);
    return "unchanged";
  }
  const twins = await ctx.tx.boilerReading.findMany({ where: { warehouse: ctx.site, date } });
  if (twins.some(sameReading)) return "unchanged";
  await addBoilerReadingIn(ctx.tx, ctx.site, ctx.actor.id, { date, shellKg, runningHours });
  return "created";
}

/** File 12's row: its Sampling Point says which side of the colour sorter, and so which check it is. */
async function sorterRow(ctx: ProductionCtx, cells: Cells): Promise<Outcome> {
  const word = (cells.get("point") ?? "").trim().toLowerCase();
  const point = SORTER_POINTS.find((p) => p.word.toLowerCase() === word);
  if (!point) {
    return refuse(word.includes("borma")
      ? `"${cells.get("point")}" is a Borma sample; Borma isn't in the app yet.`
      : `Sampling Point must be ${SORTER_POINTS.map((p) => p.word).join(" or ")}.`);
  }
  return entryRow(ctx, point.kind, cells);
}

/** The file fills a truck in as it moves through the gate, as the screen does, until its gate pass closes it. */
async function truckRow(ctx: ProductionCtx, tab: Tab, cells: Cells, sample: (key: string, changes: Change[]) => void): Promise<Outcome> {
  const raw = (cells.get("id") ?? "").trim();
  const text = (k: string) => (cells.get(k) ?? "").trim();
  // File 16 is all shell; in file 15 the Category says which waste.
  const stream = tab.id === "shellTrucks" ? "shell" : streamFromCategory(cells.get("category"));
  if (!stream) {
    return refuse(text("category")
      ? `"${text("category")}" isn't a waste the app follows. Category must be ${WASTE_CATEGORIES.map((c) => c.word).join(", ")}.`
      : `Give the Category: ${WASTE_CATEGORIES.map((c) => c.word).join(", ")}.`);
  }
  const input = {
    stream, date: text("date"), truckNo: text("truckNo"), driver: text("driver"), documentsChecked: text("documentsChecked").toLowerCase() === "yes",
    tareKg: text("tareKg"), grossKg: text("grossKg"), slipNo: text("slipNo"), buyer: text("buyer"), category: text("category"), price: text("price"), gatePassNo: text("gatePassNo"),
  };
  if (!raw) {
    const twins = await ctx.tx.truckMovement.findMany({ where: { warehouse: ctx.site, date: input.date, truckNo: input.truckNo, stream: input.stream ?? "" } });
    if (twins.some((t) => same(t.slipNo, input.slipNo) && sameNumber(t.tareKg, input.tareKg) && sameNumber(t.grossKg, input.grossKg) && same(t.gatePassNo, input.gatePassNo))) return "unchanged";
    await addTruckIn(ctx.tx, ctx.site, ctx.actor.id, input);
    return "created";
  }
  const id = Number(raw);
  const saved = Number.isInteger(id) ? await ctx.tx.truckMovement.findFirst({ where: { id, warehouse: ctx.site } }) : null;
  if (!saved) return refuse(`Truck ${raw} doesn't exist at ${ctx.site}. Leave the Truck ID blank to add a new truck.`);
  const now: Record<string, string> = { date: saved.date, truckNo: saved.truckNo, driver: saved.driver ?? "", slipNo: saved.slipNo ?? "", tareKg: saved.tareKg ?? "", grossKg: saved.grossKg ?? "", buyer: saved.buyer ?? "", category: tab.id === "wasteTrucks" ? truckCategory(saved.stream as Stream, saved.category) : saved.category ?? "", price: saved.price ?? "", gatePassNo: saved.gatePassNo ?? "", documentsChecked: saved.documentsChecked ? "Yes" : "No" };
  const changes = Object.keys(now).filter((k) => cells.has(k) && !sameNumber(text(k), now[k])).map((k) => ({ column: label(tab, k), from: now[k]!, to: text(k) }));
  if (!changes.length && input.stream === saved.stream) return "unchanged";
  // A column this tab doesn't have (file 16 has no Category) keeps what is saved, never blanked by its absence.
  const kept = { driver: saved.driver ?? "", slipNo: saved.slipNo ?? "", buyer: saved.buyer ?? "", category: saved.category ?? "", price: saved.price ?? "", gatePassNo: saved.gatePassNo ?? "", documentsChecked: saved.documentsChecked };
  await updateTruckIn(ctx.tx, ctx.site, id, { ...input, ...Object.fromEntries(Object.entries(kept).filter(([k]) => !cells.has(k))) });
  sample(`Truck ${raw}`, changes);
  return "changed";
}

// ── A production run started by the file ─────────────────────────────────────────────────────────

/** A load's source bin that couldn't start a run: refused with the reason, not a bare "start a run first". */
const binReady = (ctx: ProductionCtx, bin: string) => {
  const problem = ctx.binProblems?.get(bin);
  if (problem) refuse(problem);
};

/**
 * The upload starts its own production run (team decision, Nov 2026): no one has to open the New run screen first.
 * Every source bin in the file's new loads that is in no run yet goes into ONE new run, started on the earliest of their
 * dates, under exactly the New run screen's rules (createBatchIn). A bin those rules would refuse (not in Masters › Bins,
 * no procurement stock, already in another site's run) is left out of it, and its loads are refused with that reason.
 */
async function startRunForNewBins(ctx: ProductionCtx, sheets: { tab: Tab; rows: { cells: Cells }[] }[], notices: string[]) {
  const dates = new Map<string, string[]>();
  for (const { rows } of sheets) {
    for (const { cells } of rows) {
      // A row naming a saved pallet or load isn't a new load.
      if (filled(cells, "id") || filled(cells, "receiptId")) continue;
      const bin = upper(cells.get("binCode") ?? null);
      if (!bin) continue;
      const list = dates.get(bin) ?? [];
      const date = (cells.get("date") ?? "").trim();
      if (isIsoDate(date)) list.push(date);
      dates.set(bin, list);
    }
  }
  if (!dates.size) return;
  const bins = [...dates.keys()];
  const [taken, master] = await Promise.all([
    ctx.tx.productionBatchBin.findMany({ where: { binCode: { in: bins } }, select: { binCode: true, batchCode: true, batch: { select: { warehouse: true } } } }),
    ctx.tx.bin.findMany({ where: { code: { in: bins } }, select: { code: true } }),
  ]);
  const problems = new Map<string, string>();
  const fresh: string[] = [];
  for (const bin of bins) {
    const run = taken.find((t) => t.binCode === bin);
    if (run && run.batch.warehouse === ctx.site) continue; // already in a run here: its loads join it
    if (run) problems.set(bin, `${bin} is already in production run ${run.batchCode} at ${run.batch.warehouse}.`);
    else if (!master.some((m) => m.code === bin)) problems.set(bin, `${bin} isn't in Masters › Bins, so no production run can start with it. Add the bin there first.`);
    else if (!ctx.stock.get(bin)?.lots.length) problems.set(bin, `${bin} has no procurement stock at ${ctx.site}, so no production run can start with it.`);
    else fresh.push(bin);
  }
  ctx.binProblems = problems;
  const startDate = fresh.flatMap((b) => dates.get(b)!).sort()[0];
  if (!fresh.length || !startDate) return; // no date: the loads themselves then say a date is required
  const code = await createBatchIn(ctx.tx, ctx.site, ctx.actor.id, { startDate, bins: fresh, proposedBy: "Production workbook upload" }, ctx.stock);
  notices.push(`A new production run ${code} starts on ${startDate} with ${fresh.join(", ")}, the file's bins that were in no run.`);
}

// ── The file → tabs → rows ───────────────────────────────────────────────────────────────────────

/**
 * The uploaded sheet's headers → the tab's keys, by the column's word or one of its older ones. Our own derived columns
 * are skipped quietly; strangers are reported.
 */
function cellsOf(tab: Tab, sheet: ParsedSheet, notices: string[]) {
  const byLabel = new Map(tab.fields.flatMap((f) => [f.label, ...(f.aliases ?? [])].map((w) => [tabHeader(w), f] as const)));
  const timeKeys = new Set(tab.fields.filter((f) => f.time).map((f) => f.key));
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
        const cell = r.cells[h];
        // An Excel time cell comes back as a date on 1899-12-30; only its clock is the value.
        if (timeKeys.has(key) && cell instanceof Date) { cells.set(key, cell.toISOString().slice(11, 16)); continue; }
        const p = parseCell(cell, "String");
        if (p.ok) cells.set(key, p.value === null ? null : String(p.value).trim() || null);
        else bad.push({ row: r.rowNumber, column: label(tab, key), message: p.error });
      }
      return { rowNumber: r.rowNumber, cells, bad };
    }),
  };
}

/** A tab's current title, for a message that points to it. */
const titleOfTab = (id: Tab["id"]) => TABS.find((t) => t.id === id)!.title;

/** Tabs older files carry, and what became of them: read past with a word on why, never silently. */
const RETIRED_TABS: Record<string, string> = {
  // Before Intake & Calibration became one stage (Nov 2026).
  "Calibration Runs": "kg per silo are no longer recorded. A load goes into the silos, as net − dust − voids, when production accepts it.",
  // Before the tabs followed the client's own files (Nov 2026).
  Trucks: `trucks are now on two tabs, as in your files: "${titleOfTab("wasteTrucks")}" and "${titleOfTab("shellTrucks")}".`,
  "Sorter Before": `both sorter samples are now one tab, as in your file: "${titleOfTab("sorter")}", with Sampling Point Before CS or After CS.`,
  // The check after the cooker was dropped (Nov 2026).
  "New · Cooking Checks (QC-3)": `the cooking check (QC-3) is no longer done. The cooker log on "${titleOfTab("entry:cooker_log")}" is the record of each cook.`,
  "Cooking Checks": `the cooking check (QC-3) is no longer done. The cooker log on "${titleOfTab("entry:cooker_log")}" is the record of each cook.`,
  "Sorter After": `both sorter samples are now one tab, as in your file: "${titleOfTab("sorter")}", with Sampling Point Before CS or After CS.`,
};

/**
 * Each tab's link column(s): without them a row could name no load or Lot. The app's ID column isn't among them on a
 * client file's tab: the client's own file has none, and a row identical to a saved one is still known as that record.
 */
const NEEDS: Partial<Record<Tab["id"], string[][]>> = {
  cooking: [["lotCode"]], cooling: [["lotCode"]], shellingDays: [["lotCode"]], boiler: [["date"]],
  wasteTrucks: [["truckNo"]], shellTrucks: [["truckNo"]],
  receipts: [["btmNo"], ["binCode"]], tally: [["btmNo"], ["binCode"]], checks: [["receiptId", "btmNo"]],
  siloChecks: [["batchCode"]], siloMoves: [["id"], ["fromSize"]],
};

/**
 * Between the warehouse's tabs and the factory's: the loads the file finished — weighed, their moisture OK — are accepted, as
 * the Production Incharge would on screen, so no approval is left waiting (team, 18 Nov 2026) and the file's own cooking rows
 * find them in the silos. A load the file left unfinished says why.
 */
async function acceptFinishedLoads(ctx: ProductionCtx, notices: string[]) {
  if (!canRunProduction(ctx.actor.role)) return;
  for (const id of ctx.loads ?? []) {
    const status = toView(await receiptAt(ctx.tx, ctx.site, id)).status;
    if (status === "calibrated") continue;
    const problem = acceptanceProblem(status);
    if (problem) notices.push(`${id} is not accepted by production yet: ${problem}`);
    else await acceptRcnReceiptIn(ctx.tx, ctx.site, ctx.actor, id, { fromUpload: true });
  }
}

export async function runProductionWorkbook(ctx: ProductionCtx, wb: ParsedWorkbook): Promise<{ tabs: TabResult[]; notices: string[] }> {
  const notices = [...wb.notices];
  const byTitle = new Map([...wb.sheets.values()].map((s) => [normalizeHeader(s.name), s]));
  const namesOf = (t: Tab) => [t.title, ...(t.aliases ?? [])].map(normalizeHeader);
  for (const s of wb.sheets.values()) {
    const name = normalizeHeader(s.name);
    const retired = Object.entries(RETIRED_TABS).find(([t]) => normalizeHeader(t) === name)?.[1];
    if (name === normalizeHeader(README_TITLE) || TABS.some((t) => namesOf(t).includes(name))) continue;
    notices.push(retired ? `Sheet "${s.name}" — ignored: ${retired}` : `Sheet "${s.name}" isn't one of the production workbook's tabs — ignored.`);
  }
  if (!wb.sheets.size) notices.push("The file has no data sheets.");

  // Before any load is made: the run its new bins need, if the file brings bins no run has yet. Only an uploader who may
  // make loads starts a run for them.
  const loadTabs = TABS.filter((t) => (t.id === "tally" || t.id === "receipts") && mayUploadTab(ctx.actor.role, t.id)).flatMap((tab) => {
    const sheet = namesOf(tab).map((n) => byTitle.get(n)).find(Boolean);
    return sheet ? [{ tab, rows: cellsOf(tab, sheet, []).rows }] : [];
  });
  await startRunForNewBins(ctx, loadTabs, notices);
  ctx.loads = new Set();

  const tabs: TabResult[] = [];
  let accepted = false;
  // In the order things happen, so each row finds what the rows before it created; reported in the file's tab order.
  for (const tab of RUN_ORDER.map((id) => TABS.find((t) => t.id === id)!)) {
    const sheet = namesOf(tab).map((n) => byTitle.get(n)).find(Boolean);
    if (!sheet) continue;
    // The other side's tab is theirs to upload: its rows are left as they are, never refused, so one file can go round.
    if (!mayUploadTab(ctx.actor.role, tab.id)) {
      notices.push(`${tab.title}: skipped — only Admin and the Production Incharge upload this workbook.`);
      continue;
    }
    if (!accepted && !INTAKE_TABS.includes(tab.id)) {
      accepted = true;
      await acceptFinishedLoads(ctx, notices);
    }
    const result: TabResult = { name: tab.title, rows: sheet.rows.length, created: 0, changed: 0, unchanged: 0, errors: [], warnings: [], samples: [] };
    tabs.push(result);
    const { keys, rows } = cellsOf(tab, sheet, notices);
    // A Lot's small records name their Lot, or their own row.
    const needs = NEEDS[tab.id] ?? (tab.isNew ? [["id"], ["lotCode"]] : [["lotCode"]]);
    const missing = needs.find((any) => !any.some((k) => keys.has(k)));
    if (missing) {
      result.errors.push({ row: 1, column: missing.map((k) => label(tab, k)).join(" or "), message: `the "${missing.map((k) => label(tab, k)).join('" or "')}" column is missing` });
      continue;
    }
    if (tab.id === "tally") { await tallyTab(ctx, tab, rows, result, notices); continue; }

    for (const { rowNumber, cells, bad } of rows) {
      if (bad.length) { result.errors.push(...bad); continue; }
      const warn = (message: string) => result.warnings.push({ row: rowNumber, message, severity: "warning" });
      const sample = (key: string, changes: Change[]) => { if (result.samples.length < SAMPLE_LIMIT) result.samples.push({ row: rowNumber, key, changes }); };
      try {
        const outcome =
          tab.id === "receipts" ? await receiptRow(ctx, cells, warn)
          : tab.id === "checks" ? await checkRow(ctx, tab, cells)
          : tab.id === "siloChecks" ? await siloCheckRow(ctx, cells)
          : tab.id === "siloMoves" ? await siloMoveRow(ctx, cells)
          : tab.id === "cooking" ? await cookingRow(ctx, cells)
          : tab.id === "cooling" ? await coolingRow(ctx, cells)
          : tab.id === "shellingDays" ? await shellingDayRow(ctx, cells)
          : tab.id === "boiler" ? await boilerRow(ctx, cells)
          : tab.id === "wasteTrucks" || tab.id === "shellTrucks" ? await truckRow(ctx, tab, cells, sample)
          : tab.id === "sorter" ? await sorterRow(ctx, cells)
          : await entryRow(ctx, tab.id.slice("entry:".length) as EntryKind, cells);
        result[outcome]++;
      } catch (e) {
        // A rule's refusal is the row's problem; anything else (the database) stops the whole upload.
        if (e instanceof ValidationError) result.errors.push({ row: rowNumber, message: e.message });
        else throw e;
      }
    }
  }
  if (!accepted) await acceptFinishedLoads(ctx, notices);
  const shown = (name: string) => TABS.findIndex((t) => t.title === name);
  return { tabs: tabs.sort((a, b) => shown(a.name) - shown(b.name)), notices };
}
