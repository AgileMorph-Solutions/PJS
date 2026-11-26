/**
 * Fields that fill themselves in. Two client requests:
 * - Oct 2026 review: "the date should populate automatically".
 * - Nov 2026, docs/Procurement Auto Populate Fields.xlsx (rows marked Auto-fill): WH Location at Arrival, and the
 *   Activity Ledger's Date, Location, Linked Lot/Bin and Performed by.
 * - Nov 2026 field rules (docs/procurement-field-rules.png): Arrival's WEEK from the arrival date, the Bin's linked Lot.
 *
 * Arrival's Warehouse type is not filled from here: it follows whatever WH LOCATION names (warehouseKindOf in the
 * backend's receipts service), so changing the location changes the type and the two can't disagree.
 *
 * When the step is saved and one of these is still blank, the server fills it; the person can still change it until the
 * record locks (domain/recordLock.ts). One list, read by the backend (which fills it, so every route — form, batch grid,
 * approval — behaves the same) and by the forms (which say so beside the field).
 *
 * Not here: the bin allocation date and who finalised it, which the Finalise action stamps (domain/binFinalise.ts); the Tally Clerk bag count, which the sheet marks a Suggestion, not an Auto-fill
 * (receiptMath.ts's PREFILL_RULES); and the dates on dispatch, receiving and drying, which their own forms fill.
 */
export type AutoSource =
  /** Today's date (the day the step is saved). */
  | "today"
  /** The receipt's arrival date. */
  | "arrival"
  /** The receipt's warehouse: the site the truck was recorded at (BOUAKE). */
  | "site"
  /** The receipt's own Lot and Bin ("LOT-BKE-2026-001 / BKE-002-BIN-003"). */
  | "lotAndBin"
  /** The signed-in person who saves the step. */
  | "actor"
  /** The arrival date's week, as the 2026 sheet writes it: "W-8 Feb" (ISO week number, then the month). */
  | "arrivalWeek"
  /** The receipt's own Lot, alone. */
  | "lot"
  /** The next serial number at the receipt's warehouse: the highest S N it has + 1 (26 Nov 2026, user). */
  | "nextSn";

export interface AutoField { label: string; from: AutoSource }

export const AUTO_FIELDS: Record<string, AutoField[]> = {
  // The gate date is the day the truck arrived: the receipt already has it (today, unless a past arrival was entered).
  "n-gate": [
    // Each warehouse numbers its own trucks, as each one's workbook did (26 Nov 2026, user: "SN should be auto fill").
    { label: "S N", from: "nextSn" },
    { label: "DATE OF ARRIVAL", from: "arrival" },
    { label: "WH LOCATION", from: "site" },
    { label: "WEEK", from: "arrivalWeek" },
  ],
  // The Lot is issued on Pass, before the Bin is chosen, so the Bin always knows which Lot it holds.
  "n-bin": [{ label: "Linked Lot Number(s)", from: "lot" }],
  "n-unload": [{ label: "DATE OF OFFLOADING", from: "today" }],
  "n-ledger": [
    { label: "Date/time", from: "today" },
    { label: "Location", from: "site" },
    { label: "Linked Lot/Bin", from: "lotAndBin" },
    { label: "Performed by", from: "actor" },
  ],
};

export const autoFieldFor = (stageId: string, label: string): AutoField | undefined =>
  (AUTO_FIELDS[stageId] ?? []).find((f) => f.label === label);

export const isAutoField = (stageId: string, label: string): boolean => autoFieldFor(stageId, label) !== undefined;

/** What the form says beside a blank auto field, so nobody wonders why it appears after saving. */
export const AUTO_FIELD_NOTES: Record<AutoSource, string> = {
  today: "Fills itself with today's date when this step is saved.",
  arrival: "Fills itself with the day the truck arrived when this step is saved.",
  site: "Fills itself with this truck's warehouse when this step is saved.",
  lotAndBin: "Fills itself with this truck's Lot and Bin when this step is saved.",
  actor: "Fills itself with your name when this step is saved.",
  arrivalWeek: "Fills itself with the arrival date's week (W-8 Feb) when this step is saved.",
  lot: "Fills itself with this truck's Lot when this step is saved.",
  nextSn: "Fills itself with the next number at this warehouse when this step is saved.",
};

/** What the server knows when it fills. A source with no value here (no Lot yet, no kind in the master) stays blank. */
export interface AutoFillContext {
  today: string;
  arrivalDate: string;
  site?: string;
  lot?: string;
  bin?: string;
  actorName?: string;
  /** The next S N at the receipt's warehouse (nextSerial below, over the S N it already has). */
  nextSn?: string;
}

function valueOf(from: AutoSource, ctx: AutoFillContext): string {
  switch (from) {
    case "today": return ctx.today;
    case "arrival": return ctx.arrivalDate;
    case "site": return ctx.site ?? "";
    case "lotAndBin": return [ctx.lot, ctx.bin].map((v) => (v ?? "").trim()).filter(Boolean).join(" / ");
    case "actor": return ctx.actorName ?? "";
    case "arrivalWeek": return weekLabel(ctx.arrivalDate);
    case "lot": return (ctx.lot ?? "").trim();
    case "nextSn": return ctx.nextSn ?? "";
  }
}

/**
 * The next serial number after the ones already used: the highest whole number among them + 1, or 1 for the first. A value
 * that isn't a whole number (a workbook's "12A", a blank) is skipped, never read as 0 or guessed at.
 */
export function nextSerial(used: readonly (string | null | undefined)[]): string {
  const max = used.reduce<number>((m, v) => {
    const s = String(v ?? "").trim();
    return /^\d+$/.test(s) ? Math.max(m, Number(s)) : m;
  }, 0);
  return String(max + 1);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-02-16" → "W-8 Feb": the ISO week number (weeks start Monday; week 1 holds the year's first Thursday) and the date's month. */
export function weekLabel(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate ?? "");
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  const day = d.getUTCDay() || 7;
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((thursday.getTime() - yearStart) / 86400000 + 1) / 7);
  return `W-${week} ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * The fields to add to a write so its auto fields are filled: only labels the write doesn't already carry and the
 * stage doesn't already hold. `existing` is the stage as stored. A value the context can't give is left out, never
 * guessed.
 */
export function autoFill(
  stageId: string,
  given: Record<string, string>,
  existing: Record<string, string> | undefined,
  ctx: AutoFillContext,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of AUTO_FIELDS[stageId] ?? []) {
    if ((given[f.label] ?? "").trim() !== "" || (f.label in given)) continue; // a value, or a deliberate clear, is the person's
    if ((existing?.[f.label] ?? "").trim() !== "") continue;
    const value = valueOf(f.from, ctx).trim();
    if (value) out[f.label] = value;
  }
  return out;
}
