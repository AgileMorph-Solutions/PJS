import type { JuteLedger } from "../types/stage.js";
import type { LedgerRow } from "../types/receipt.js";
import { parseBags } from "./juteVendorReceipt.js";

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

export const SUPPLIER_PENDING_COLUMN = "Bags still with supplier";

export const DERIVED_COLUMNS = new Set(["S N", "Balance", SUPPLIER_PENDING_COLUMN]);

export interface SupplierMovementAmounts {
  supplierCode: string;
  issued: number | null;
  returned: number | null;
}

/**
 * The bags each supplier still holds after each row, in the order given: everything issued to that supplier so far, minus
 * everything returned through their deliveries (the client's Q&A, section 3.2: "how many bags are currently with each
 * supplier"). Negative when a supplier has returned more than was issued: that is reported, never clamped. Damaged and
 * reusable bags don't change it, since those bags did come back. A row with no supplier has no balance to belong to (null).
 */
export function supplierPendingBalances(rows: SupplierMovementAmounts[]): (number | null)[] {
  const running = new Map<string, number>();
  return rows.map((r) => {
    const code = r.supplierCode.trim();
    if (!code) return null;
    const balance = (running.get(code) ?? 0) + (r.issued ?? 0) - (r.returned ?? 0);
    running.set(code, balance);
    return balance;
  });
}

export interface ReconciliationInput {
  opening: number; receipts: number; transfersIn: number;
  issues: number; damagedOrDiscarded: number; transfersOut: number; closing: number;
}

/**
 * What a supplier's balance will be once a draft row is saved, for the form to show. Empty until there is a supplier and the
 * counts are numbers. A preview from the rows this person can see: the server works out the figure that is kept.
 */
export function supplierPendingPreview(existingRows: LedgerRow[], draft: LedgerRow): string {
  const code = (draft["Supplier code"] ?? "").trim();
  if (!code) return "";
  const count = (label: string) => ((draft[label] ?? "").trim() === "" ? 0 : parseBags(draft[label]));
  const issued = count("Bags issued to supplier");
  const returned = count("Returned through RCN deliveries");
  if (issued === null || returned === null) return "";
  const last = existingRows.filter((r) => (r["Supplier code"] ?? "").trim() === code).at(-1);
  return String(Number(last?.[SUPPLIER_PENDING_COLUMN] || 0) + issued - returned);
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
