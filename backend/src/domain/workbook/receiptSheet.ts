/**
 * The Receipt sheet — the one multi-table sheet. A receipt is stored as a `Receipt` row plus up to
 * 16 stage tables, so each header is `Table.column` (e.g. `StageGateEntry.vehicleNo`), plus one
 * `ReceiptBranch.<stage>` column per decision and a read-only derived status.
 *
 * Reading goes through the same record the API serves; writing goes through the same code every
 * other edit uses (applyStageFields / applyBranch), so the lot-clash, lot-before-bin and
 * rejection-needs-a-reason rules all still apply — and only cells that CHANGED are written, so a
 * record that already breaks a rule (a rejected truck with no reason) isn't re-judged by an upload
 * that doesn't touch it.
 */
import { STAGE_FIELD_MAP } from "@anagroci/contract/generated/stageFieldMap";
import { DECISION_BRANCHES } from "@anagroci/contract/domain/decisions";
import { deriveStatus } from "@anagroci/contract/domain/receiptStatus";
import type { ReceiptRecord } from "@anagroci/contract/types/receipt";
import {
  applyBranch, applyStageFields, assertLotAvailable, listReceipts, loadReceiptRow, nextReceiptId,
} from "../../services/receipts.js";
import { toReceiptRecord } from "../../serialize.js";
import { assertLotBeforeBin, assertRejectionHasReason, ValidationError } from "../validation.js";
import { canonical, parseCell } from "./cells.js";
import type { FileKeys } from "./tableSheet.js";
import { SAMPLE_LIMIT, type Change, type Ctx, type ParsedSheet, type ReceiptOp, type RowError, type SheetResult } from "./types.js";

export const RECEIPT_KEY = "Receipt.id";
/** Receipt's own columns that ReceiptRecord carries (lotNo / binNo are projections of the n-lot /
 * n-bin stage rows, so they appear under those tables instead of twice). */
const TOP = ["id", "source", "arrivalDate", "supplierName", "lbaCode", "vehicleNo", "warehouse", "origin"] as const;
const DECISION_STAGES = Object.keys(DECISION_BRANCHES);
const DERIVED_STATUS = "status (derived)";
const STAGES = Object.values(STAGE_FIELD_MAP);

export const RECEIPT_COLUMNS: string[] = [
  ...TOP.map((c) => `Receipt.${c}`),
  ...STAGES.flatMap((s) => s.fields.map((f) => `${s.model}.${f.col}`)),
  ...DECISION_STAGES.map((id) => `ReceiptBranch.${id}`),
  DERIVED_STATUS,
];

/** header -> where it lives */
const STAGE_HEADER = new Map<string, { stageId: string; label: string }>(STAGES.flatMap((s) => s.fields.map((f) => [`${s.model}.${f.col}`, { stageId: s.stageId, label: f.label }] as [string, { stageId: string; label: string }])));
const BRANCH_HEADER = new Map<string, string>(DECISION_STAGES.map((id) => [`ReceiptBranch.${id}`, id] as [string, string]));
const REASON_HEADER = "StageRejection.reason";

type Flat = Record<string, unknown>;

function flatten(r: ReceiptRecord & { status: string }): Flat {
  const row: Flat = {};
  for (const c of TOP) row[`Receipt.${c}`] = r[c];
  for (const s of STAGES) {
    const values = r.stageData[s.stageId];
    for (const f of s.fields) row[`${s.model}.${f.col}`] = values?.[f.label];
  }
  for (const id of DECISION_STAGES) row[`ReceiptBranch.${id}`] = r.branches[id];
  row[DERIVED_STATUS] = r.status;
  return row;
}

export async function receiptRows(site?: string[]): Promise<Flat[]> {
  return (await listReceipts(site)).map(flatten);
}

const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/** The receipt's own columns each have a twin on a stage (the list shows the receipt's, the stage is
 * the record of the step). The file shows the receipt's; a change is written to both so they can't drift. */
const MIRROR: Record<string, [stageId: string, label: string]> = {
  arrivalDate: ["n-gate", "DATE OF ARRIVAL"],
  supplierName: ["n-verify", "SUPPLIERS NAME"],
  lbaCode: ["n-verify", "LBA CODE"],
  vehicleNo: ["n-gate", "VEHICLE NO."],
};

export async function planReceipts(ctx: Ctx, sheet: ParsedSheet, _fileKeys: FileKeys): Promise<SheetResult> {
  const result: SheetResult = { name: sheet.name, rows: sheet.rows.length, created: 0, changed: 0, unchanged: 0, errors: [], samples: [], ops: [] };
  const ops: ReceiptOp[] = [];
  const present = sheet.headers.filter((h) => h !== RECEIPT_KEY && RECEIPT_COLUMNS.includes(h) && h !== DERIVED_STATUS && h !== "Receipt.source");

  // Every receipt, indexed — an id that exists but belongs to another warehouse must be found to be
  // refused, not mistaken for a new one.
  const all = await listReceipts();
  const byId = new Map(all.map((r) => [r.id, { record: r, flat: flatten(r) }]));
  const seenIds = new Set<string>();
  const newLots = new Set<string>();

  for (const { rowNumber, cells } of sheet.rows) {
    const errs: RowError[] = [];
    const err = (message: string, column?: string) => errs.push({ row: rowNumber, column, message });

    const idCell = parseCell(cells[RECEIPT_KEY], "String");
    const id = idCell.ok ? str(idCell.value) : null;
    if (!idCell.ok) err(idCell.error, RECEIPT_KEY);
    if (id && seenIds.has(id)) err(`${id} appears more than once in this sheet`, RECEIPT_KEY);
    if (id) seenIds.add(id);

    const existing = id ? byId.get(id) : undefined;
    if (id && !existing) err(`unknown receipt id "${id}" — leave the id blank to add a new receipt`, RECEIPT_KEY);
    if (existing && !ctx.site.includes(existing.record.warehouse)) err(`${id} belongs to another warehouse`, RECEIPT_KEY);

    // Parse every writable cell the sheet carries (as strings — that is how stage values are stored).
    const given = new Map<string, string | null>();
    for (const h of present) {
      const p = parseCell(cells[h], "String");
      // A decision is typed as words ("Pass", "FAIL "); stored as pass / fail.
      if (p.ok) given.set(h, BRANCH_HEADER.has(h) ? str(p.value)?.trim().toLowerCase() ?? null : str(p.value));
      else err(p.error, h);
    }

    // What changes, by where it lives. A new receipt writes only what was filled in; an existing one
    // writes any cell that differs from what's stored (including one cleared to blank).
    const changes: Change[] = [];
    const top: Record<string, unknown> = {};
    const stages: Record<string, Record<string, string>> = {};
    const branches: Record<string, string> = {};
    for (const h of present) {
      const next = given.get(h) ?? null;
      const prev = existing ? str(existing.flat[h]) : null;
      if (canonical(prev) === canonical(next)) continue;
      changes.push({ column: h, from: canonical(prev), to: canonical(next) });

      if (h.startsWith("Receipt.")) {
        const col = h.slice("Receipt.".length);
        if ((col === "warehouse" || col === "arrivalDate") && next === null) err(`can't be blank`, h);
        else top[col] = col === "origin" ? next : next ?? "";
      } else if (STAGE_HEADER.has(h)) {
        const { stageId, label } = STAGE_HEADER.get(h)!;
        (stages[stageId] ??= {})[label] = next ?? "";
      } else if (BRANCH_HEADER.has(h)) {
        const stageId = BRANCH_HEADER.get(h)!;
        if (next === null) err(`a recorded decision can't be cleared`, h);
        else if (!DECISION_BRANCHES[stageId].some((b) => b.id === next)) {
          err(`"${next}" isn't a valid decision (use ${DECISION_BRANCHES[stageId].map((b) => b.id).join(" or ")})`, h);
        } else branches[stageId] = next;
      }
    }

    // Keep the stage twin of a changed receipt column in step — for a new receipt always, for an
    // existing one only where that stage already exists (so editing a truck number doesn't, by
    // itself, move a receipt that was never at the gate to "arrived").
    for (const [col, [stageId, stageLabel]] of Object.entries(MIRROR)) {
      if (!(col in top)) continue;
      if (existing && !existing.record.stageData[stageId]) continue;
      (stages[stageId] ??= {})[stageLabel] ??= String(top[col] ?? "");
    }

    if (!existing) {
      // New receipt: the section's warehouse and today's date are the obvious defaults.
      top.warehouse = (top.warehouse as string | undefined) ?? ctx.warehouse;
      top.arrivalDate = (top.arrivalDate as string | undefined) ?? ctx.today;
      for (const c of ["supplierName", "lbaCode", "vehicleNo"]) top[c] ??= "";
      // Only non-blank stage values create anything.
      for (const [stageId, fields] of Object.entries(stages)) {
        for (const label of Object.keys(fields)) if (fields[label] === "") delete fields[label];
        if (!Object.keys(fields).length) delete stages[stageId];
      }
    }

    const warehouse = (top.warehouse as string | undefined) ?? existing?.record.warehouse;
    if (warehouse && !ctx.site.includes(warehouse)) err(`warehouse "${warehouse}" isn't this section's warehouse`, "Receipt.warehouse");

    // The same hard rules the app applies, checked now so the preview shows them.
    const finalOf = (h: string) => (given.has(h) ? given.get(h) ?? null : existing ? str(existing.flat[h]) : null);
    try {
      const lot = finalOf("StageLotAssignment.lotNumber");
      if (stages["n-lot"]?.["Lot Number"] && warehouse) {
        const key = `${warehouse}|${lot}`;
        if (newLots.has(key)) throw new ValidationError(`Lot ${lot} is used by more than one receipt in this sheet`);
        newLots.add(key);
        await assertLotAvailable(ctx.db, id ?? "", warehouse, lot!);
      }
      if (stages["n-bin"]?.["Bin Number"]) assertLotBeforeBin(lot, stages["n-bin"]["Bin Number"]);
      if (branches["n-qfs"]) assertRejectionHasReason(branches["n-qfs"], finalOf(REASON_HEADER) ?? undefined);
    } catch (e) {
      if (e instanceof ValidationError) err(e.message);
      else throw e;
    }

    const nothing = !changes.length && existing;
    if (errs.length) result.errors.push(...errs);
    else if (nothing) result.unchanged++;
    else if (!existing && !changes.length) result.unchanged++; // a fully blank row — nothing to add
    else {
      ops.push({ kind: existing ? "update" : "create", row: rowNumber, id: id ?? undefined, top, stages, branches, reason: finalOf(REASON_HEADER) ?? undefined });
      if (existing) result.changed++; else result.created++;
      if (result.samples.length < SAMPLE_LIMIT) result.samples.push({ row: rowNumber, key: id ?? "(new)", changes: changes.slice(0, 6) });
    }
  }

  result.ops = ops;
  return result;
}

/** Writes one planned receipt. Stages go in the order the process runs (lot before bin), through the
 * same stage-write code as every other edit, and the whole upload is ONE timeline entry per receipt. */
export async function applyReceipt(ctx: Ctx, op: ReceiptOp): Promise<void> {
  const tx = ctx.db;
  const actor = { id: ctx.userId, via: "import" as const };
  let id = op.id;

  if (op.kind === "create") {
    if (typeof op.top.origin === "string" && op.top.origin) {
      await tx.origin.upsert({ where: { name: op.top.origin }, update: {}, create: { name: op.top.origin, source: `workbook: ${ctx.filename}` } });
    }
    id = await nextReceiptId(tx);
    await tx.receipt.create({
      data: {
        id, source: "entered",
        arrivalDate: op.top.arrivalDate as string, supplierName: (op.top.supplierName as string) ?? "",
        lbaCode: (op.top.lbaCode as string) ?? "", vehicleNo: (op.top.vehicleNo as string) ?? "",
        warehouse: op.top.warehouse as string, origin: (op.top.origin as string | null | undefined) ?? null,
        timeline: { create: [{ status: "planned", at: new Date().toISOString(), actorId: ctx.userId }] },
      },
    });
  } else if (Object.keys(op.top).length) {
    // An origin is just a town name and the app has no screen for adding one, so a new name in the
    // file is added (as the earlier importers did), not refused.
    if (typeof op.top.origin === "string" && op.top.origin) {
      await tx.origin.upsert({ where: { name: op.top.origin }, update: {}, create: { name: op.top.origin, source: `workbook: ${ctx.filename}` } });
    }
    await tx.receipt.update({ where: { id: id! }, data: op.top });
  }

  for (const s of STAGES) {
    if (op.stages[s.stageId]) await applyStageFields(tx, id!, s.stageId, op.stages[s.stageId], { actor });
  }
  for (const [stageId, branchId] of Object.entries(op.branches)) {
    await applyBranch(tx, id!, stageId, branchId, op.reason, { actor });
  }

  const fresh = await loadReceiptRow(id!, tx);
  const status = deriveStatus(toReceiptRecord(fresh!) as ReceiptRecord);
  await tx.timelineEntry.create({
    data: { receiptId: id!, status, at: new Date().toISOString(), actorId: ctx.userId, note: `${op.kind === "create" ? "Created" : "Updated"} from workbook (${ctx.filename})` },
  });
}
