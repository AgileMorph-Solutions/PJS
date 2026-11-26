/**
 * A truck from the Unit warehouse received at the Central one (24 Nov 2026): the SAME reception as a supplier truck — gate,
 * weight, quality, unloading, Lot, Bin, GRN, stock, drying, the same pages — one record per lot on the truck. Only what has no
 * meaning without a supplier is left out: who supplied it, the LBA code, credit/cash, the price and the paid weight. The
 * client's "Bouake RCN Receiving at Factory Report" has none of those either; in their place it has the transfer (BKT),
 * which the record links to, and what was sent, read from it.
 */
import type { ReceiptRecord, TransferOrigin } from "../types/receipt.js";
import { parseQty, BAG_WEIGHT_KG } from "./receiptMath.js";
import { READING_GAPS } from "./fieldRules.js";

type Ref = readonly [stageId: string, label: string];

const CUT_TEST = ["Good Kernel", "Immature", "Spotted", "Rejection", "Void", "Oil", "Shell"] as const;

/**
 * Not asked for, not shown, and not written on a reception from the Unit warehouse: the supplier's and the payment's fields,
 * and the cut test and second ("final") readings — the client's sheet records ONE set of readings for such a truck: KOR,
 * moisture and nut count received (user, 24 Nov 2026).
 */
export const TRANSFER_HIDDEN_FIELDS: readonly Ref[] = [
  ["n-gate", "CREDIT/CASH"],
  ["n-verify", "SUPPLIERS NAME"],
  ["n-verify", "LBA CODE"],
  ["n-verify", "REF."],
  // Refraction is the weight deducted from what the supplier is paid (PAID WT = Net − Refraction): no supplier, nothing to
  // deduct (user, 25 Nov 2026).
  ["n-unload", "Refraction"],
  ["n-netwt", "PAID WT"],
  ["n-grn", "PRICE"],
  ["n-grn", "AMOUNT"],
  ["n-qfs", "Final moisture (%)"],
  ["n-qfs", "Final nut count"],
  ["n-qfs", "FINAL KOR"],
  ...CUT_TEST.flatMap((g) => [["n-qfs", `Sample – ${g} (g)`], ["n-qfs", `Final – ${g} (g)`]] as Ref[]),
];

/** Only a truck from the Unit warehouse has these (the same sheet's columns): a supplier truck's reception never shows them. */
export const TRANSFER_ONLY_FIELDS: readonly Ref[] = [
  ["n-gate", "Laisse-Passer Entree (Yakro)"],
  ["n-unload", "New Jute Bag Used"],
];

/** Typed on a truck from the Unit warehouse, though a supplier truck's is calculated: its KOR, with no cut test behind it. */
export const TRANSFER_TYPED_FIELDS: readonly Ref[] = [["n-qfs", "KOR"]];

/** How a field reads on a reception from the Unit warehouse, where its usual label is about truck sampling. */
export const TRANSFER_FIELD_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "n-qfs": { "Sample moisture (%)": "Moisture received (%)", "Sample nut count": "Nut count received", KOR: "KOR received" },
};

export const isFromTransfer = (r: { transfer?: unknown }): boolean => Boolean(r.transfer);

const has = (refs: readonly Ref[], stageId: string, label: string) => refs.some(([s, l]) => s === stageId && l === label);

/** Whether a field applies to this record: a supplier truck has no transfer fields; a truck from the Unit warehouse no supplier's. */
export const fieldApplies = (r: { transfer?: unknown }, stageId: string, label: string): boolean =>
  isFromTransfer(r) ? !has(TRANSFER_HIDDEN_FIELDS, stageId, label) : !has(TRANSFER_ONLY_FIELDS, stageId, label);

/** The labels of a stage this record doesn't use, for a form to leave out. */
export const hiddenOnRecord = (r: { transfer?: unknown }, stageId: string): string[] =>
  (isFromTransfer(r) ? TRANSFER_HIDDEN_FIELDS : TRANSFER_ONLY_FIELDS).filter(([s]) => s === stageId).map(([, l]) => l);

/** Whether this record types a field a supplier truck calculates (KOR on a truck from the Unit warehouse). */
export const typedOnRecord = (r: { transfer?: unknown }, stageId: string, label: string): boolean =>
  isFromTransfer(r) && has(TRANSFER_TYPED_FIELDS, stageId, label);

/** The labels this record types though they are usually calculated, for a form to leave open. */
export const typedLabelsOnRecord = (r: { transfer?: unknown }, stageId: string): string[] =>
  isFromTransfer(r) ? TRANSFER_TYPED_FIELDS.filter(([s]) => s === stageId).map(([, l]) => l) : [];

/** How a step reads on a reception from the Unit warehouse, where its usual title is about a supplier. */
export const TRANSFER_STAGE_TITLES: Readonly<Record<string, string>> = {
  "n-verify": "Check the transfer documents",
};

/** One line of "sent vs received": what left the Unit warehouse, what this record has, and the difference when both exist. */
export interface SentVsReceivedRow {
  label: string;
  unit: string;
  sent: number | null;
  received: number | null;
  diff: number | null;
  /** Past what is allowed: any bag or kg (the client's rule, transfers.ts TRANSFER_TOLERANCE), or a big reading gap. */
  off: boolean;
}

const get = (r: Pick<ReceiptRecord, "stageData">, s: string, l: string) => parseQty(r.stageData[s]?.[l]) ?? null;

/**
 * What the Unit warehouse sent of this lot against what this reception recorded: bags, net weight, moisture, KOR, nut count.
 * Readings compare with the final ones (after unloading), else the truck sampling's. Worked out, never stored.
 */
export function sentVsReceived(r: Pick<ReceiptRecord, "stageData"> & { transfer: TransferOrigin }): SentVsReceivedRow[] {
  const s = r.transfer.sent;
  const bags = get(r, "n-unload", "SACS (bags)");
  const gross = get(r, "n-gross", "GROSS WT KGS");
  const net = get(r, "n-netwt", "NET WT KGS") ?? (gross !== null && bags !== null ? gross - bags * BAG_WEIGHT_KG : null);
  const row = (label: string, unit: string, sent: number | null, received: number | null, gap = 0): SentVsReceivedRow => {
    const diff = sent !== null && received !== null ? Math.round((received - sent) * 100) / 100 : null;
    return { label, unit, sent, received, diff, off: diff !== null && Math.abs(diff) > gap };
  };
  return [
    row("Bags", "bags", s.bags, bags),
    row("Net weight", "kg", s.netKg, net),
    row("Moisture", "%", s.moisture, get(r, "n-qfs", "Final moisture (%)") ?? get(r, "n-qfs", "Sample moisture (%)"), READING_GAPS.moisture),
    row("KOR", "lbs", s.kor, get(r, "n-qfs", "FINAL KOR") ?? get(r, "n-qfs", "KOR"), READING_GAPS.kor),
    row("Nut count", "nuts/kg", s.nutCount, get(r, "n-qfs", "Final nut count") ?? get(r, "n-qfs", "Sample nut count"), READING_GAPS.nutCount),
  ];
}

const fmtNum = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * What the Unit warehouse dispatched, shown under the field it is compared with (the client's sheet keeps "Bags Dispatched From
 * Bouake", "KOR Dispatched From BOUAKE", "Dispatched Moisture" beside what was received). Read from the BKT, never typed.
 */
export function dispatchedNotes(t: TransferOrigin, stageId: string): Record<string, string> {
  const from = `Dispatched from ${t.fromWarehouse}`;
  const s = t.sent;
  const out: Record<string, string> = {};
  if (stageId === "n-qfs") {
    if (s.moisture !== null) out["Sample moisture (%)"] = `${from}: ${fmtNum(s.moisture)} %`;
    if (s.nutCount !== null) out["Sample nut count"] = `${from}: ${fmtNum(s.nutCount)} nuts/kg`;
    if (s.kor !== null) out.KOR = `${from}: ${fmtNum(s.kor)} lbs`;
  }
  if (stageId === "n-unload" && s.bags !== null) out["SACS (bags)"] = `${from}: ${fmtNum(s.bags)} bags`;
  if (stageId === "n-netwt" && s.netKg !== null) out["NET WT KGS"] = `${from}: ${fmtNum(s.netKg)} kg`;
  return out;
}

/** Which "sent vs received" lines belong to a step: the client's difference columns, worked out where their reading is entered. */
const DIFF_ROWS: Readonly<Record<string, readonly string[]>> = {
  "n-unload": ["Bags"],
  "n-netwt": ["Net weight"],
  "n-qfs": ["Moisture", "KOR", "Nut count"],
};

/** The sent-vs-received lines a step shows (its "Difference in bags", "Weight difference", quality differences). */
export const stageDifferences = (r: Pick<ReceiptRecord, "stageData"> & { transfer: TransferOrigin }, stageId: string): SentVsReceivedRow[] =>
  DIFF_ROWS[stageId] ? sentVsReceived(r).filter((row) => DIFF_ROWS[stageId]!.includes(row.label)) : [];
