/**
 * Jute bags received from a vendor (client trial observations, 02-11-2026, point 7: vendor name, delivery note no,
 * date, invoiced quantity, received quantity, short quantity, remarks). No workbook has these columns; the 2026 sheet
 * only ever recorded the bags received, under this activity type.
 *
 * What was received is one row of the warehouse stock ledger, so the running balance needs no second source. Short
 * quantity is worked out from the two counts and never stored.
 */
export const JUTE_PURCHASE_ACTIVITY = "JUTE BAGS PURCHASED/UNLOADINGS";

export interface VendorReceiptInput {
  vendorName?: string;
  deliveryNoteNo?: string;
  date?: string;
  invoicedQty?: string | number | null;
  receivedQty?: string | number | null;
  remarks?: string;
}

/** The largest count the database's integer column holds. */
const MAX_BAGS = 2_147_483_647;

/** A count of bags, or null when it isn't one. Spaces are allowed ("1 000"); "1,000" and "1.000" are refused, since a
 * French decimal comma and an English thousands comma read the same and bags are never fractional. */
export function parseBags(v: string | number | null | undefined): number | null {
  const s = String(v ?? "").replace(/\s/g, "");
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n <= MAX_BAGS ? n : null;
}

export const isRealDate = (d: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const parsed = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === d;
};

/** What is wrong with an entry, in plain words, or an empty list. One place, for the form and for the server. */
export function vendorReceiptProblems(input: VendorReceiptInput): string[] {
  const out: string[] = [];
  if (!input.vendorName?.trim()) out.push("Enter the vendor name.");
  if (!input.deliveryNoteNo?.trim()) out.push("Enter the delivery note number.");
  if (!isRealDate(input.date?.trim() ?? "")) out.push("Enter the date the bags were received.");
  if (parseBags(input.invoicedQty) === null) out.push("Invoiced quantity must be a whole number of bags.");
  const received = parseBags(input.receivedQty);
  // A receipt of nothing adds no stock, and the ledger would read a 0 as a movement out.
  if (received === null || received === 0) out.push("Received quantity must be a whole number of bags, at least 1.");
  return out;
}

/** Positive when fewer bags arrived than were invoiced, negative when more did. The difference is reported, not corrected. */
export const shortQuantity = (invoiced: number, received: number): number => invoiced - received;

export function shortQuantityLabel(short: number): string {
  if (short === 0) return "None";
  return short > 0 ? `${short.toLocaleString()} short` : `${(-short).toLocaleString()} over`;
}
