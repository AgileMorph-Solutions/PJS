/**
 * Supplier names and LBA codes.
 *
 * The client's own codes are LBA-<number>-<three letters> (LBA-013-DAG for "DAGNOGO KARIM"), the
 * letters coming from the distinctive word of the name once "RCN" and "SCOOP(S)" are left out
 * ("RCN SCOOPS DIENE" -> DIE). They were made by hand and don't follow it every time (BAOBAB is both
 * BAB and BAO), so this only SUGGESTS a code and the person can change it before saving.
 *
 * "RCN" (raw cashew nuts) was the commodity prefix on every supplier name in the workbooks; the client
 * asked for names without it. It is dropped from stored supplier names, and the original is kept
 * (Supplier.formerName) so a workbook that still says "RCN SCOOPS DIENE" still matches.
 */

/** A supplier name as stored and shown: no leading "RCN", no surrounding spaces. Inner spacing is left as typed. */
export function normalizeSupplierName(name: string | null | undefined): string {
  return (name ?? "").replace(/^\s*RCN(\s+|$)/i, "").trim();
}

/** What two spellings of the same supplier have in common, for matching only (never stored). */
export const supplierNameKey = (name: string | null | undefined) => normalizeSupplierName(name).replace(/\s+/g, " ").toUpperCase();

const SKIP_WORDS = new Set(["RCN", "SCOOP", "SCOOPS"]);

/** Up to three capital letters from the name's first distinctive word, padded with X when it has fewer. */
function nameLetters(name: string): string {
  const words = name.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().split(/[^A-Z]+/).filter((w) => w && !SKIP_WORDS.has(w));
  return (words[0] ?? "").slice(0, 3).padEnd(3, "X");
}

/** The next free LBA-NNN-XXX: one more than the highest LBA number in use, so it can never collide. */
export function suggestLbaCode(name: string, existingCodes: Iterable<string>): string {
  const taken = new Set<string>();
  let highest = 0;
  for (const code of existingCodes) {
    taken.add(code);
    const n = /^LBA-(\d+)-/.exec(code)?.[1];
    if (n) highest = Math.max(highest, Number(n));
  }
  const letters = nameLetters(normalizeSupplierName(name));
  for (let next = highest + 1; ; next++) {
    const code = `LBA-${String(next).padStart(3, "0")}-${letters}`;
    if (!taken.has(code)) return code;
  }
}
