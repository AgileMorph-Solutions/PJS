/**
 * The bridge between the normalized per-stage tables and ReceiptRecord.stageData.
 *
 * Everything here is driven by STAGE_FIELD_MAP (generated from stages.ts), so there is no
 * hand-written label list to drift. Two rules this file exists to protect:
 *
 *  1. Round-trip fidelity. Every value in stageData is a string on the wire; "" and "0" are
 *     different values and both must survive a write/read cycle unchanged.
 *  2. Presence semantics. deriveStatus() tests whether stageData[stageId] EXISTS, not whether it
 *     holds anything. A stage written with nothing but empty strings still exists. That is
 *     load-bearing today (the frontend writes per keystroke), so the assembler keys presence off
 *     StageEntry rather than "does the payload row have any non-null column".
 */
import { Prisma } from "@prisma/client";
import { STAGE_FIELD_MAP } from "@anagroci/contract/generated/stageFieldMap";

/** Prisma `include` covering every stage relation plus the receipt's own children. */
export const RECEIPT_INCLUDE = {
  timeline: { orderBy: { id: "asc" }, include: { actor: { select: { displayName: true } } } },
  stageEntries: true,
  branches: true,
  locker: { select: { displayName: true } },
  ...Object.fromEntries(
    Object.values(STAGE_FIELD_MAP).map((s) => [
      s.relation,
      s.cardinality === "many" ? { orderBy: { seq: "asc" } } : true,
    ])
  ),
} as const satisfies Prisma.ReceiptInclude;

type AnyRow = Record<string, unknown>;

/**
 * Rebuild stageData from the joined rows.
 *
 * A stage appears iff it has a StageEntry. For 1:N stages (n-otheract, n-ledger) only the highest
 * -seq row is projected: ReceiptRecord.stageData is structurally 1:1 — Record<label,string>, no row
 * index — and TrackingApi.setStageField has nowhere to put one. This read is therefore LOSSY for
 * those two stages by design; the full set is served by GET /api/receipts/:id/activities.
 */
export function assembleStageData(receipt: AnyRow): Record<string, Record<string, string>> {
  const entries = (receipt.stageEntries ?? []) as { stageId: string }[];
  const present = new Set(entries.map((e) => e.stageId));
  const out: Record<string, Record<string, string>> = {};

  for (const [stageId, spec] of Object.entries(STAGE_FIELD_MAP)) {
    if (!present.has(stageId)) continue;

    let row: AnyRow | undefined;
    const rel = receipt[spec.relation];
    if (spec.cardinality === "many") {
      const rows = (rel ?? []) as AnyRow[];
      row = rows.length ? rows[rows.length - 1] : undefined; // highest seq — see note above
    } else {
      row = (rel ?? undefined) as AnyRow | undefined;
    }

    // A StageEntry with no payload row still yields {} — presence without data is a real state.
    const fields: Record<string, string> = {};
    if (row) {
      for (const f of spec.fields) {
        const v = row[f.col];
        // NULL means "never written" and is omitted; "" means "written as blank" and is kept.
        if (v !== null && v !== undefined) fields[f.label] = String(v);
      }
    }
    out[stageId] = fields;
  }
  return out;
}

export function assembleBranches(receipt: AnyRow): Record<string, string> {
  const rows = (receipt.branches ?? []) as { stageId: string; branchId: string }[];
  return Object.fromEntries(rows.map((b) => [b.stageId, b.branchId]));
}

/** Columns that carry a typed shadow, written alongside the string column in the same transaction. */
const SHADOW_COLS: Record<string, string[]> = {
  "n-gross": ["loadedTruckWtKgs", "grossWtKgs"],
  "n-tare": ["tareWtKgs"],
  "n-netwt": ["netWtKgs", "paidWt"],
  "n-unload": ["sacs", "bonSacs", "humidSacs", "sacsDechires", "refraction"],
  "n-qfs": ["moisture", "nutCount", "kor", "finalKor"],
  "n-grn": ["price", "amount", "grnWeight"],
};

/**
 * Parse a workbook-style number for the *Num shadow columns. Handles the French decimal comma the
 * real sheets contain ('44,94'). Returns null rather than 0 for blanks, so "" stays distinguishable
 * from "0" in the typed view as well as the string one.
 */
export function toNum(v: string | null | undefined): Prisma.Decimal | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? new Prisma.Decimal(n) : null;
}

/** Translate {label: value} into {col: value}, plus any typed shadow columns. */
export function toColumnPayload(stageId: string, fields: Record<string, string>) {
  const spec = STAGE_FIELD_MAP[stageId];
  if (!spec) throw new Error(`Unknown stage "${stageId}"`);
  const shadows = SHADOW_COLS[stageId] ?? [];
  const data: Record<string, unknown> = {};

  for (const [label, value] of Object.entries(fields)) {
    const f = spec.fields.find((x) => x.label === label);
    // Reject rather than silently no-op: a typo'd label must not look like a successful write.
    if (!f) throw new UnknownStageFieldError(stageId, label);
    data[f.col] = value;
    if (shadows.includes(f.col)) data[`${f.col}Num`] = toNum(value);
  }
  return data;
}

export class UnknownStageFieldError extends Error {
  constructor(public stageId: string, public label: string) {
    super(`Unknown field "${label}" on stage "${stageId}"`);
    this.name = "UnknownStageFieldError";
  }
}

export const STAGE_MODEL_DELEGATE: Record<string, string> = Object.fromEntries(
  Object.entries(STAGE_FIELD_MAP).map(([id, s]) => [
    id,
    s.model.charAt(0).toLowerCase() + s.model.slice(1),
  ])
);
