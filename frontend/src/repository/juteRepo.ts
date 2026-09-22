import { juteLedgers } from "../data/juteBags";
import type { LedgerEntries, LedgerRow } from "@anagroci/contract/types/receipt";

export type { LedgerRow, LedgerEntries };

/** Every ledger starts empty client-side; real rows come from the API. */
export function loadSeedLedgerEntries(): LedgerEntries {
  return Object.fromEntries(juteLedgers.map((l) => [l.id, [] as LedgerRow[]]));
}
