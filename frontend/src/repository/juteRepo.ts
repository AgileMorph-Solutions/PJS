import { juteLedgers } from "../data/juteBags";

export type LedgerRow = Record<string, string>;
export type LedgerEntries = Record<string, LedgerRow[]>;

export function loadSeedLedgerEntries(): LedgerEntries {
  const entries: LedgerEntries = {};
  for (const l of juteLedgers) entries[l.id] = [];
  return entries;
}
