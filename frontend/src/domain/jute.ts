import type { JuteLedger } from "../types/stage";
import type { LedgerRow } from "../repository/juteRepo";

export function allRowsFor(ledger: JuteLedger, entries: LedgerRow[]): LedgerRow[] {
  return [...(ledger.sampleRows ?? []), ...entries];
}

export function lastBalance(rows: LedgerRow[]): number {
  if (rows.length === 0) return 0;
  const raw = rows[rows.length - 1]["Balance"];
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}
