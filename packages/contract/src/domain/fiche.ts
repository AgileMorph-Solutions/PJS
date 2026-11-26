/**
 * The CCA "Fiche de Transfert" a truck arrives with (Conseil du Coton et de l'Anacarde): what the app reads off a photo or
 * scan of it, and how each value lands on stage n-verify (Verify supplier documents).
 *
 * Decided with the team (meeting with Sameer, 18 Nov 2026; scope confirmed 20 Nov, changed 23 Nov): the fiche fills FICHE,
 * FICHE CODE, the supplier and — when one of the fiche's places (sub-prefecture, department, village) is a town in
 * Masters › Origins — ORIGIN. REF. stays with the person. A place that isn't in Origins is never filled in by itself: the
 * fiche panel warns it isn't in the master, and only the person's own "Add to Origins" puts it there (team, 23 Nov 2026),
 * through the master's usual checks, so a misread letter can't quietly become a second spelling of a town.
 *
 * The form follows the fiche (team, 23 Nov 2026: "the form should be filled with the fiche"): on upload, or a new read, the
 * fiche's values go into their fields at once, saved as the uploader's own edit, over whatever was there. What a field
 * held before is kept beside the fiche (ficheFill's `replaced`), so the panel can say what differed and the person can put
 * it back. The supplier is the exception (FICHE_GUESSED_FIELDS): it isn't printed on the fiche but worked out from earlier
 * trucks, so one truck saved under the wrong supplier would spread to every later one; it only fills an empty field.
 *
 * Where each field sits on the paper (checked against the client's 2026 workbooks, Nov 2026):
 *   FICHE      — the red printed serial, top right ("00076601"). The workbooks' "fiche offloading no" / "fiche cca no"
 *                hold the same number (708 of 710 shared) written without the leading zeros (72515).
 *   FICHE CODE — "CODE DE L'ACHETEUR" (0201-0004). The client's drying report names it "Supplier's Code (CCAK)" beside
 *                "Supplier's Code (Anagroci)" = the LBA code; in Truck Reception each of the 61 codes belongs to exactly one
 *                supplier, which is what lets the code find the supplier.
 */
import { normalizeSupplierName } from "./supplierCode.js";
import { originKey } from "./origin.js";

export const FICHE_STAGE = "n-verify";

/** The n-verify fields a fiche fills from what it reads. ORIGIN is filled too, from the Origins match (see the header). */
export const FICHE_FILLED_FIELDS = ["FICHE", "FICHE CODE", "SUPPLIERS NAME"] as const;

/**
 * Of those, the ones not printed on the fiche but worked out from earlier trucks (supplierForBuyerCode): filled only when
 * the field is empty, never over a value the person chose (team, 23 Nov 2026). A difference is shown for them to decide.
 */
export const FICHE_GUESSED_FIELDS: readonly string[] = ["SUPPLIERS NAME"];

/**
 * What the reader returns, as read: "" wherever it couldn't read a value clearly. Names and phone numbers of the buyer,
 * transporter and driver are on the fiche too, and are deliberately never asked for — nobody needs them stored.
 */
export interface FicheReading {
  /** False when the document isn't a CCA Fiche de Transfert at all (ANAGROCI's own unloading slips look similar). */
  isCcaTransferFiche: boolean;
  /** The red printed serial number. */
  ficheNumber: string;
  /** CODE DE L'ACHETEUR. */
  buyerCode: string;
  /** NOM DU MAGASIN — shown to the person when the code names no supplier the app knows, to help them pick. */
  storeName: string;
  /** The fiche's "ORIGINE DU PRODUIT" places, for the Origin hint. Absent on readings made before they were asked for. */
  subPrefecture?: string;
  department?: string;
  village?: string;
  /** Anything the reader was unsure of, in its own words. */
  unclear: string;
}

/** The file types a fiche may be uploaded as: a scan (PDF) or a phone photo. */
export const FICHE_FILE_TYPES: Readonly<Record<string, string>> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WEBP",
};

/** Largest file kept. A phone photo is shrunk in the browser before upload; a multi-page scan can be a few MB. */
export const FICHE_MAX_BYTES = 10 * 1024 * 1024;

/** The fiche number as the workbooks write it: digits only, without the printed leading zeros. "" when it isn't a number. */
export function normalizeFicheNumber(raw: string | null | undefined): string {
  const s = (raw ?? "").replace(/\s+/g, "");
  if (!/^\d+$/.test(s)) return "";
  return s.replace(/^0+/, "");
}

/**
 * The buyer code as NNNN-NNNN, the shape of 674 of the 675 codes in the 2026 workbooks. The reader may see the dash as a
 * space or a dot, or read on into the store label beside it ("0201-0004 LT-NOVAREA"); the code itself is kept. "" when
 * there is no 4+4-digit code in what was read.
 */
export function normalizeBuyerCode(raw: string | null | undefined): string {
  const m = (raw ?? "").match(/(?<!\d)(\d{4})\s*[-–.\s]?\s*(\d{4})(?!\d)/);
  return m ? `${m[1]}-${m[2]}` : "";
}

export interface SupplierRow { code: string; name: string; status?: string | null }

/**
 * The supplier a buyer code belongs to, worked out from the trucks already recorded (their FICHE CODE and LBA CODE side by
 * side) rather than stored a second time on the supplier: the 2026 data shows one supplier per code. Only suppliers in the
 * master that the picker offers (not inactive) count. Returns the name as the supplier picker shows it, or undefined when no
 * truck has used the code yet or it points at more than one supplier — then the person picks.
 */
export function supplierForBuyerCode(
  pastTrucks: ReadonlyArray<{ lbaCode: string | null }>,
  suppliers: ReadonlyArray<SupplierRow>,
): string | undefined {
  const byCode = new Map(suppliers.filter((s) => s.status !== "inactive").map((s) => [s.code, s]));
  const found = new Set<string>();
  for (const t of pastTrucks) {
    const s = t.lbaCode ? byCode.get(t.lbaCode.trim()) : undefined;
    if (s) found.add(s.code);
  }
  if (found.size !== 1) return undefined;
  return normalizeSupplierName(byCode.get([...found][0]!)!.name);
}

export interface FicheSuggestion { value: string; from: string }

/**
 * What the fiche offers for each n-verify field, ready for the stage form's "Use …" buttons. Empty when the document
 * isn't a CCA fiche, so a wrong upload can't put numbers from another form into the record.
 */
export function ficheSuggestions(reading: FicheReading | null | undefined, supplierName: string | undefined): Record<string, FicheSuggestion> {
  if (!reading || !reading.isCcaTransferFiche) return {};
  const out: Record<string, FicheSuggestion> = {};
  const fiche = normalizeFicheNumber(reading.ficheNumber);
  const code = normalizeBuyerCode(reading.buyerCode);
  if (fiche) out["FICHE"] = { value: fiche, from: "the fiche" };
  if (code) out["FICHE CODE"] = { value: code, from: "the fiche" };
  if (code && supplierName) out["SUPPLIERS NAME"] = { value: supplierName, from: `CCA supplier code ${code} on earlier trucks` };
  return out;
}

/** A receipt's fiche as the API sends it: the file's details and what was read off it — never the file itself. */
export interface FicheDocumentRecord {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: string | null;
  /** Null until read, and when reading failed (readError says why, in words the warehouse can act on). */
  reading: FicheReading | null;
  readAt: string | null;
  readError: string | null;
}

/** GET / POST /api/receipts/:id/fiche: the fiche (null when none is uploaded) and what it offers each n-verify field. */
export interface FicheView {
  document: FicheDocumentRecord | null;
  suggestions: Record<string, FicheSuggestion>;
  /** What the fiche says about where the RCN came from, beside the Origin field. Null when nothing was read. */
  originHint: FicheOriginHint | null;
  /** The fields this upload / read filled in (labels), so the page can say so. Absent on a plain read of the fiche. */
  filled?: string[];
  /** What each field the fiche changed held before (label → value), kept with the fiche; empty when it changed nothing. */
  replaced: Record<string, string>;
}

/**
 * What an upload (or a new read) puts into the step: every value the fiche gives, over what the form held, plus ORIGIN when
 * one of the fiche's places is exactly a town in Origins — except a guessed field (the supplier), which only fills an empty one. `replaced` is what a field held before, for each field the fiche
 * changed — the difference the panel shows, and what "Put back" restores. A field that was empty or already the same isn't
 * in it.
 */
export function ficheFill(
  suggestions: Record<string, FicheSuggestion>,
  originHint: FicheOriginHint | null | undefined,
  current: Record<string, string> | undefined,
): { fill: Record<string, string>; replaced: Record<string, string> } {
  const offered: Record<string, string> = Object.fromEntries(Object.entries(suggestions).map(([label, s]) => [label, s.value]));
  if (originHint?.match?.exact) offered["ORIGIN"] = originHint.match.origin;
  const fill: Record<string, string> = {};
  const replaced: Record<string, string> = {};
  for (const [label, value] of Object.entries(offered)) {
    const before = (current?.[label] ?? "").trim();
    if (before === value || (before && FICHE_GUESSED_FIELDS.includes(label))) continue;
    fill[label] = value;
    if (before) replaced[label] = before;
  }
  return { fill, replaced };
}

/**
 * Whether the file's first bytes are what its type says, so a renamed file (a .exe called fiche.jpg) is refused before it is
 * stored and later shown back in the browser.
 */
export function ficheBytesMatchType(bytes: Uint8Array, mimeType: string): boolean {
  const starts = (...b: number[]) => b.every((x, i) => bytes[i] === x);
  switch (mimeType) {
    case "application/pdf": return starts(0x25, 0x50, 0x44, 0x46); // %PDF
    case "image/jpeg": return starts(0xff, 0xd8, 0xff);
    case "image/png": return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/webp": return starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50; // RIFF....WEBP
    default: return false;
  }
}

export type FichePlaceLevel = "Sub-prefecture" | "Department" | "Village";

export interface FicheOriginHint {
  /** The places written on the fiche, in the order they are tried. */
  places: { level: FichePlaceLevel; name: string }[];
  /**
   * The Origins entry one of those places is: `exact` when it is the same town (spelling variants included, origin.ts
   * originKey), otherwise one letter off — a likely misreading, offered as "did you mean". Absent when none is in Origins.
   */
  match?: { origin: string; level: FichePlaceLevel; exact: boolean };
}

/** Edits between two strings, stopping early past 1 — only "one letter off" matters here. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Which Origins entry the fiche points to. Team, 24 Nov 2026: the Origin is the fiche's VILLAGE. The sub-prefecture, then the
 * department, stand in only when the village is blank, never when the village is just missing from Origins: matching
 * YAMOUSSOUKRO for a truck from AKPESSEKRO filled the wrong Origin. A village not in Origins is the person's to add (one click).
 * The other places are still listed, for context. A one-letter-off match counts only when it is the one such town, and only
 * for names of 5+ letters, so two short towns are never confused.
 */
export function ficheOriginHint(reading: FicheReading | null | undefined, origins: readonly string[]): FicheOriginHint | null {
  if (!reading?.isCcaTransferFiche) return null;
  const places = ([
    ["Village", reading.village], ["Sub-prefecture", reading.subPrefecture], ["Department", reading.department],
  ] as const).flatMap(([level, name]) => ((name ?? "").trim() ? [{ level, name: name!.trim().toUpperCase() }] : []));
  if (!places.length) return null;
  // The same town written at two levels (YAMOUSSOUKRO department and sub-prefecture) is one place to offer.
  for (let i = places.length - 1; i > 0; i--) if (places.slice(0, i).some((p) => originKey(p.name) === originKey(places[i]!.name))) places.splice(i, 1);
  const origin = places[0]!;
  const key = originKey(origin.name);
  const keyed = origins.map((o) => ({ origin: o, key: originKey(o) }));
  const hit = keyed.find((o) => o.key && o.key === key);
  if (hit) return { places, match: { origin: hit.origin, level: origin.level, exact: true } };
  if (key.length >= 5) {
    const close = keyed.filter((o) => o.key.length >= 5 && withinOneEdit(key, o.key));
    if (close.length === 1) return { places, match: { origin: close[0]!.origin, level: origin.level, exact: false } };
  }
  return { places };
}
