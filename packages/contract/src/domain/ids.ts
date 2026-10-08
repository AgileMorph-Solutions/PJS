/**
 * The system's business identifiers — one place, read by both the backend (which issues them) and
 * the frontend (which displays and links them).
 *
 * Patterns are the client's own. The Oct 2026 team feedback gave the shape; their APPLICATION VIEW
 * workbook (REC-BKE-2026-0001, LOT-YAK-2026-0002, DP-BKE-2026-001) settled the codes and padding:
 *   Receipt      REC-BKE-2027-0001   issued when the truck's arrival is recorded — every truck, rejected or not
 *   Lot          LOT-BKE-2027-0001   issued when the truck passes quality — one accepted truck, one original Lot
 *   Transfer     BKT-2027-001        issued on a transfer request; continues their 2026 BKT001 / BKT-029 numbering
 *   Delivery     DP-BKE-2027-001     issued when a delivery plan is created
 * Receipts and Lots are four digits because one site already passes 900 receipts a year; plans and
 * transfers stay at three, as in the client's file.
 *
 * The warehouse code (BKE, YAK) comes from Warehouse.code in the master, never from the warehouse
 * name — a guessed code would be indistinguishable from a real one. The year is the year of the
 * arrival date (or the plan's / transfer's own date), not the year the record happened to be typed.
 */

export type SiteIdKind = "REC" | "LOT" | "DP";

/** Padding per kind, as in the client's own workbook; past the width the number simply grows. */
const SEQ_PAD: Record<SiteIdKind | "BKT", number> = { REC: 4, LOT: 4, DP: 3, BKT: 3 };

const pad = (kind: SiteIdKind | "BKT", seq: number) => String(seq).padStart(SEQ_PAD[kind], "0");

/** Upper-case letters and digits only — the code is embedded between dashes, so a dash in it would make IDs unparseable. */
export const WAREHOUSE_CODE_PATTERN = /^[A-Z0-9]{2,12}$/;

export function isValidWarehouseCode(code: string): boolean {
  return WAREHOUSE_CODE_PATTERN.test(code);
}

/** Year of a "YYYY-MM-DD…" date. Returns undefined rather than guessing when the date is missing or malformed. */
export function yearOf(date: string | null | undefined): number | undefined {
  const m = /^(\d{4})-\d{2}-\d{2}/.exec((date ?? "").trim());
  return m ? Number(m[1]) : undefined;
}

function assertSeq(seq: number) {
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError(`Sequence must be a positive integer, got ${seq}`);
}

function assertParts(code: string, year: number) {
  if (!isValidWarehouseCode(code)) throw new RangeError(`Invalid warehouse code "${code}"`);
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new RangeError(`Invalid year ${year}`);
}

/** The shared prefix of every ID of one kind for one warehouse and year — what the issuer scans for the current maximum. */
export function siteIdPrefix(kind: SiteIdKind, code: string, year: number): string {
  assertParts(code, year);
  return `${kind}-${code}-${year}-`;
}

function formatSiteId(kind: SiteIdKind, code: string, year: number, seq: number): string {
  assertSeq(seq);
  return `${siteIdPrefix(kind, code, year)}${pad(kind, seq)}`;
}

export const formatReceiptId = (code: string, year: number, seq: number) => formatSiteId("REC", code, year, seq);
export const formatLotNumber = (code: string, year: number, seq: number) => formatSiteId("LOT", code, year, seq);
export const formatDeliveryPlanId = (code: string, year: number, seq: number) => formatSiteId("DP", code, year, seq);

export function transferIdPrefix(year: number): string {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new RangeError(`Invalid year ${year}`);
  return `BKT-${year}-`;
}

export function formatTransferId(year: number, seq: number): string {
  assertSeq(seq);
  return `${transferIdPrefix(year)}${pad("BKT", seq)}`;
}

export interface ParsedSiteId {
  kind: SiteIdKind;
  code: string;
  year: number;
  seq: number;
}

const SITE_ID_RE = /^(REC|LOT|DP)-([A-Z0-9]{2,12})-(\d{4})-(\d+)$/;

export function parseSiteId(value: string | null | undefined): ParsedSiteId | undefined {
  const m = SITE_ID_RE.exec((value ?? "").trim());
  if (!m) return undefined;
  return { kind: m[1] as SiteIdKind, code: m[2]!, year: Number(m[3]), seq: Number(m[4]) };
}

/**
 * The same ID in the current format for `code`: same kind, year and sequence number, with the
 * code and padding brought up to date. Used when a warehouse's code changes (BKE01 → BKE) or the
 * padding widens, so renumbering moves an existing ID rather than minting a new number — an ID
 * already in the current format comes back unchanged, which makes the move idempotent.
 */
export function recodeSiteId(value: string | null | undefined, code: string): string | undefined {
  const p = parseSiteId(value);
  return p ? formatSiteId(p.kind, code, p.year, p.seq) : undefined;
}

/**
 * Codes the client has since replaced, mapped to their successors. Their Oct 2026 email gave
 * BKE01; their workbook then used BKE. An ID printed, exported or bookmarked under the old code
 * resolves through this instead of going dead. Only codes the client themselves gave belong here.
 */
export const SUPERSEDED_WAREHOUSE_CODES: Readonly<Record<string, string>> = { BKE01: "BKE" };

/** The current-code form of an ID that carries a superseded code; undefined when it doesn't. */
export function currentFormOfSiteId(value: string | null | undefined): string | undefined {
  const p = parseSiteId(value);
  const next = p ? SUPERSEDED_WAREHOUSE_CODES[p.code] : undefined;
  return p && next ? formatSiteId(p.kind, next, p.year, p.seq) : undefined;
}

export function parseTransferId(value: string | null | undefined): { year: number; seq: number } | undefined {
  const m = /^BKT-(\d{4})-(\d+)$/.exec((value ?? "").trim());
  return m ? { year: Number(m[1]), seq: Number(m[2]) } : undefined;
}

/**
 * The sequence number inside a lot value written before system IDs existed. The 2026 workbooks
 * number lots as bare integers per site (Bouaké 1–454, all distinct); Excel sometimes hands them
 * over as "17.0". Anything else — "12,5" (two lots in one cell), a bin code — is not a single lot
 * and returns undefined, so the caller leaves it unresolved instead of inventing one.
 */
export function legacyLotSeq(raw: string | number | null | undefined): number | undefined {
  const s = String(raw ?? "").trim();
  const m = /^(\d+)(?:\.0+)?$/.exec(s);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 1 ? n : undefined;
}

/**
 * A lot value in the system format. Already-formatted values keep their number and are brought up
 * to the current code/padding (so a re-import or a second renumber run is a no-op); legacy integers are formatted with the given
 * warehouse code and year; anything ambiguous returns undefined.
 */
export function normalizeLotNumber(raw: string | number | null | undefined, code: string, year: number): string | undefined {
  const parsed = parseSiteId(String(raw ?? ""));
  if (parsed?.kind === "LOT") return recodeSiteId(String(raw), code);
  const seq = legacyLotSeq(raw);
  return seq === undefined ? undefined : formatLotNumber(code, year, seq);
}

/** The sequence inside a 2026-era transfer number: both "BKT001" and "BKT-414" occur in the real dispatch sheet. */
export function legacyTransferSeq(raw: string | null | undefined): number | undefined {
  const m = /^BKT\s*-?\s*(\d+)$/i.exec((raw ?? "").trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 1 ? n : undefined;
}

/** A transfer number in the system format; already-formatted values pass through, unrecognised ones return undefined. */
export function normalizeTransferId(raw: string | null | undefined, year: number): string | undefined {
  if (parseTransferId(raw)) return raw!.trim();
  const seq = legacyTransferSeq(raw);
  return seq === undefined ? undefined : formatTransferId(year, seq);
}
