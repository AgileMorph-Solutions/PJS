/**
 * Origins: the upstream town the RCN came from (DIANRA, MANKONO…) — not a warehouse.
 *
 * The master is the union of every origin observed in the workbooks, and they already carry the
 * same town spelled more than one way (M BAHIAKRO / M'BAHIAKRO in the seed; SAKASSOU / SAKKASSOU in
 * the discharge sheet). Those stay as they are — reported, never merged. What these rules stop is a
 * new spelling being ADDED from the app when the town is already there.
 */

/** An origin name as stored: capitals, single spaces, no surrounding spaces (the whole master is upper case). */
export function normalizeOriginName(name: string | null | undefined): string {
  return (name ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * What two spellings of the same town have in common, for matching only (never stored): accents,
 * spaces and punctuation dropped, doubled letters counted once. M'BAHIAKRO = M BAHIAKRO, SAKKASSOU = SAKASSOU.
 */
export function originKey(name: string | null | undefined): string {
  return normalizeOriginName(name).normalize("NFD").replace(/\p{M}/gu, "").replace(/[^A-Z0-9]/g, "").replace(/(.)\1+/g, "$1");
}

/** The existing origin that `name` would duplicate (same town, other spelling), if any. */
export function findSimilarOrigin(name: string, origins: readonly string[]): string | undefined {
  const key = originKey(name);
  return key ? origins.find((o) => originKey(o) === key) : undefined;
}

/** True when a typed origin is something the master doesn't have — the pickers warn, they don't block. */
export function isUnlistedOrigin(value: string | null | undefined, origins: readonly string[]): boolean {
  const v = normalizeOriginName(value);
  return Boolean(v) && !origins.includes(v);
}
