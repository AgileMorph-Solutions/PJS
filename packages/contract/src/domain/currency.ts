/**
 * The one currency every price and amount is in, and how it is written (26 Nov 2026, user: "currency is CFA", written before
 * the number). The client confirmed on 24 Nov 2026 that prices are West African CFA francs (ISO code XOF); the team writes
 * them "CFA". Prices are per kg. One place, so a label, a table cell and an input box can't disagree.
 */
export const CURRENCY = "CFA";

/**
 * A money figure written as on a bill, without the currency: thousands separated ("19,158,140"), at most two decimals. Text
 * that isn't a number is given back as it is, never turned into 0, so a slip stays visible.
 */
export function formatAmount(value: number | string | null | undefined): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const n = typeof value === "number" ? value : Number(text);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : text;
}

/** A money value as the app shows it, as on a bill: the currency first, then the figure ("CFA 19,158,140"). */
export function formatMoney(value: number | string | null | undefined): string {
  const amount = formatAmount(value);
  return amount && Number.isFinite(Number(String(value).trim())) ? `${CURRENCY} ${amount}` : "";
}

/** The stage fields that hold money, whose input boxes show the currency before the number. */
const MONEY_FIELDS: Record<string, readonly string[]> = { "n-grn": ["PRICE", "AMOUNT"] };

export const isMoneyField = (stageId: string, label: string): boolean => MONEY_FIELDS[stageId]?.includes(label) ?? false;
