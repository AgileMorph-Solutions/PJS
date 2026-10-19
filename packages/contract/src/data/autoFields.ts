/**
 * Dates that fill themselves in (client review, Oct 2026: "the date should populate automatically").
 *
 * When the step is first saved and one of these is still blank, the server fills it; the person can still change
 * it until the record locks (domain/recordLock.ts). One list, read by the backend (which fills it, so every route —
 * form, batch grid, approval — behaves the same) and by the forms (which say so beside the field).
 *
 * Not here: the bin allocation date, which is stamped by the Finalise action rather than by saving the step, and the
 * dates on dispatch, receiving and drying, which their own forms fill.
 */
export type AutoDateSource = "today" | "arrival";

export const AUTO_DATE_FIELDS: Record<string, { label: string; from: AutoDateSource }[]> = {
  // The gate date is the day the truck arrived: the receipt already has it (today, unless a past arrival was entered).
  "n-gate": [{ label: "DATE OF ARRIVAL", from: "arrival" }],
  "n-unload": [{ label: "DATE OF OFFLOADING", from: "today" }],
};

export const isAutoDateField = (stageId: string, label: string): boolean =>
  (AUTO_DATE_FIELDS[stageId] ?? []).some((f) => f.label === label);

/**
 * The fields to add to a write so its auto dates are filled: only labels the write doesn't already carry and the
 * stage doesn't already hold. `existing` is the stage as stored.
 */
export function autoDateFill(
  stageId: string,
  given: Record<string, string>,
  existing: Record<string, string> | undefined,
  ctx: { today: string; arrivalDate: string },
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of AUTO_DATE_FIELDS[stageId] ?? []) {
    if ((given[f.label] ?? "").trim() !== "" || (f.label in given)) continue; // a value, or a deliberate clear, is the person's
    if ((existing?.[f.label] ?? "").trim() !== "") continue;
    const value = f.from === "arrival" ? ctx.arrivalDate : ctx.today;
    if (value) out[f.label] = value;
  }
  return out;
}
