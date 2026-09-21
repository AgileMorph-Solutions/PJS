// Ported from frontend/src/domain/jute.ts and the derived-column handling in
// frontend/src/components/LedgerSection.tsx (`DERIVED_COLUMNS`, `handleSubmit`). Only the
// "warehouse-stock" ledger has a running "Balance" + auto "S N" today (see
// frontend/src/data/juteBags.ts) — this stays generic on column *names*, not ledger id, so it
// keeps working if another ledger grows a running balance later.
import type { LedgerRow } from "../types.js";

export const DERIVED_COLUMNS = new Set(["S N", "Balance"]);

export function lastBalance(rows: LedgerRow[]): number {
  if (rows.length === 0) return 0;
  const raw = rows[rows.length - 1]["Balance"];
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Fills in the derived columns on a new row exactly as the frontend's LedgerSection.handleSubmit
 * does client-side: "Balance" = last balance + received − issued, "S N" = row count + 1. Mutates
 * nothing — returns a new row. `existingRows` must be in insertion order (oldest first).
 */
export function withDerivedColumns(row: LedgerRow, existingRows: LedgerRow[], columns: string[]): LedgerRow {
  const out: LedgerRow = { ...row };
  if (columns.includes("Balance")) {
    const received = Number(row["Bags received"] || 0);
    const issued = Number(row["Bags issued"] || 0);
    out["Balance"] = String(lastBalance(existingRows) + received - issued);
  }
  if (columns.includes("S N")) {
    out["S N"] = String(existingRows.length + 1);
  }
  return out;
}

/**
 * The reconciliation invariant from the Sept 2026 clarification (also quoted in
 * frontend/src/data/juteBags.ts as `juteReconciliationRule`):
 *   opening + receipts + transfers in − issues − damaged/discarded − transfers out = closing
 * This is a checker, not an enforcer — real client data is allowed to violate it (ledger 1's
 * real sheet already does, going negative from row 195 on — a genuine data-quality issue, not a
 * bug to hide). Callers decide whether a violation blocks a write or just gets surfaced.
 */
export function checkReconciliation(input: {
  opening: number;
  receipts: number;
  transfersIn: number;
  issues: number;
  damagedOrDiscarded: number;
  transfersOut: number;
  closing: number;
}): { balanced: boolean; expectedClosing: number; delta: number } {
  const expectedClosing =
    input.opening + input.receipts + input.transfersIn - input.issues - input.damagedOrDiscarded - input.transfersOut;
  const delta = input.closing - expectedClosing;
  return { balanced: delta === 0, expectedClosing, delta };
}
