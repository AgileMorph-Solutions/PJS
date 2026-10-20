/**
 * The one way a date is written on screen (client review, Oct 2026: "a certain format which will be constant all over
 * the app"): DD/MM/YYYY, the Ivorian convention. Stored and sent values stay ISO (YYYY-MM-DD), which is what the
 * workbooks, the API and every date comparison in the code use; only what a person reads or types goes through here.
 *
 * To change the format, change it here and nowhere else: every table, form, filter and detail page reads these.
 *
 * Text that is not a date is returned as it is. The imported workbooks hold some date cells that are free text
 * (`*Raw` columns) and those are stored verbatim and shown verbatim: never reinterpreted, never blanked.
 */
export const DATE_FORMAT_LABEL = "DD/MM/YYYY";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;
/** The truck timeline's own "YYYY-MM-DD HH:mm" stamp (truckTimeline.ts). */
const STAMP = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/;
/** 11 real rows of the jute ledger workbook hold day-first "DD-MM-YYYY" text (see parseLedgerDate); the same day, shown in our format. */
const DAY_FIRST_DASHED = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;
const pad = (n: number) => String(n).padStart(2, "0");

/** A real calendar day (rejects 2026-02-31). */
function validDay(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function isIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  return Boolean(m) && validDay(Number(m![1]), Number(m![2]), Number(m![3]));
}

/** Today as ISO, by the clock the person is looking at (not UTC). */
export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A date or timestamp for display. "" for nothing, the text itself when it is not a date. */
export function formatDate(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  if (isIsoDate(v)) return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
  const stamp = STAMP.exec(v);
  if (stamp && isIsoDate(stamp[1]!)) return formatDate(stamp[1]);
  const dashed = DAY_FIRST_DASHED.exec(v);
  if (dashed && validDay(Number(dashed[3]), Number(dashed[2]), Number(dashed[1]))) return `${pad(Number(dashed[1]))}/${pad(Number(dashed[2]))}/${dashed[3]}`;
  if (ISO_TIMESTAMP.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  }
  return v;
}

/** A timestamp for display, with the time. A plain date has no time to show, so it comes out as a date. */
export function formatDateTime(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (ISO_TIMESTAMP.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return `${formatDate(v)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const stamp = STAMP.exec(v);
  if (stamp && isIsoDate(stamp[1]!)) return `${formatDate(stamp[1])} ${stamp[2]}`;
  return formatDate(v);
}

/**
 * What a person typed, as ISO: "" when empty, null when it is not a date. Takes DD/MM/YYYY (also with - or . between the
 * parts, a one-digit day or month, a two-digit year read as 20YY) and ISO, which a paste from a workbook gives.
 */
export function parseDateInput(text: string): string | null {
  const t = text.trim();
  if (!t) return "";
  if (ISO_DATE.test(t)) return isIsoDate(t) ? t : null;
  const m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})$/.exec(t);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return validDay(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
}
