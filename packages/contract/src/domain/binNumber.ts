/**
 * The Allocate Bin stage's "Bin Number" field. One entry can name more than one Bin — the real
 * workbook has "BKE-002-BIN-004 / BKE-002-BIN-006" — so a value is a list, split on "/" or ",".
 * The server's check and the receipt page both split it here, so they never disagree on what a part is.
 */
export function splitBinNumber(value: string | null | undefined): string[] {
  return (value ?? "").split(/\s*[/,]\s*/).map((b) => b.trim()).filter(Boolean);
}

/** One part of a Bin Number that the server would refuse, and why. */
export interface BinProblem {
  code: string;
  /** "store": a warehouse code (BKE-001), not a Bin inside it. "unknown": not in the Bin master at all. */
  reason: "store" | "unknown";
}

/**
 * The parts of a typed Bin Number the server would refuse — mirrors backend's assertBinIsAPhysicalBin
 * (same split, same exact-match on the code), so the page can hold back a value that would only be
 * rejected. Matching is exact on purpose: the rule exists so one Bin is never spelled two ways.
 */
export function binNumberProblems(value: string | null | undefined, bins: readonly string[], stores: readonly string[]): BinProblem[] {
  const known = new Set(bins);
  const storeSet = new Set(stores);
  return splitBinNumber(value).flatMap((code): BinProblem[] =>
    storeSet.has(code) ? [{ code, reason: "store" }] : known.has(code) ? [] : [{ code, reason: "unknown" }]
  );
}
