import type { BinStageId } from "@anagroci/contract/domain/warehouseActivityStages";
import { nowStamp } from "../ui/DateTimeInput";

/**
 * What a new entry of a Bin's Activity ledger starts with (team, 23 Nov 2026; the Location since 26 Nov 2026): now, this Bin and
 * this warehouse, shown filled in and changeable. "Performed by" is filled with the person's name by the server when saved.
 */
export function binLedgerDefaults(stageId: BinStageId, binCode: string, warehouse: string): Record<string, string> {
  return stageId === "n-ledger" ? { "Date/time": nowStamp(), "Linked Lot/Bin": binCode, Location: warehouse } : {};
}

/** The ledger's own notes on a Bin: the truck's speak of "this truck" and of a record that locks, neither true here. */
export const BIN_LEDGER_NOTES: Partial<Record<BinStageId, Record<string, string>>> = {
  "n-ledger": {
    "Date/time": "When it happened: now unless you change it. It can't be in the future.",
    Location: "This warehouse unless you pick another.",
    "Linked Lot/Bin": "This Bin unless you pick another.",
    "Performed by": "Fills itself with your name when saved.",
  },
};
