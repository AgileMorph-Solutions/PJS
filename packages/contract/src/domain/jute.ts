import type { JuteLedger } from "../types/stage.js";
import type { LedgerRow } from "../types/receipt.js";

/**
 * Sample rows are hardcoded demo data in juteBags.ts. Once the backend seeds the real workbook
 * rows, the server is the only source of ledger rows and this prepend must NOT be applied, or
 * the samples double-count against their own seeded copies. Kept only for offline/demo use.
 */
export function allRowsFor(ledger: JuteLedger, entries: LedgerRow[]): LedgerRow[] {
  return [...(ledger.sampleRows ?? []), ...entries];
}

export function lastBalance(rows: LedgerRow[]): number {
  if (rows.length === 0) return 0;
  const raw = rows[rows.length - 1]["Balance"];
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export const DERIVED_COLUMNS = new Set(["S N", "Balance"]);

export interface ReconciliationInput {
  opening: number; receipts: number; transfersIn: number;
  issues: number; damagedOrDiscarded: number; transfersOut: number; closing: number;
}

/**
 * The universal rule from juteBags.ts's juteReconciliationRule:
 *   opening + receipts + transfers in − issues − damaged/discarded − transfers out = closing
 * A checker, never an enforcer: the real BOUAKE sheet genuinely goes negative, and blocking
 * those rows would destroy client data rather than surface it.
 */
export function checkReconciliation(i: ReconciliationInput) {
  const expectedClosing =
    i.opening + i.receipts + i.transfersIn - i.issues - i.damagedOrDiscarded - i.transfersOut;
  return { balanced: expectedClosing === i.closing, expectedClosing, delta: i.closing - expectedClosing };
}

/**
 * Server-side equivalent of the derivation LedgerSection.tsx does client-side today.
 * NOTE: for `warehouse-stock` the Balance half is superseded by the jute_warehouse_movement_balance
 * view — a stored running balance is exactly the drift the view exists to prevent.
 */
export function withDerivedColumns(
  row: LedgerRow,
  existingRows: LedgerRow[],
  columns: string[]
): LedgerRow {
  const out: LedgerRow = { ...row };
  if (columns.includes("Balance")) {
    const received = Number(row["Bags received"] || 0);
    const issued = Number(row["Bags issued"] || 0);
    out["Balance"] = String(lastBalance(existingRows) + received - issued);
  }
  if (columns.includes("S N")) out["S N"] = String(existingRows.length + 1);
  return out;
}
