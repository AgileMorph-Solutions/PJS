import { binNumberProblems, splitBinNumber } from "@anagroci/contract/domain/binNumber";

/**
 * Said under Bin Number when the saved value isn't one Bin from the list. The field is a dropdown now, so this only
 * happens to an older value (an upload, or one typed before Nov 2026). It stays as it is until someone picks a Bin.
 * One Lot goes wholly into one Bin (Sameer, 18 Nov 2026), so an older "BIN-004 / BIN-006" is flagged too.
 */
export function binFieldWarning(value: string | undefined, bins: readonly string[], stores: readonly string[]): string | undefined {
  const v = (value ?? "").trim();
  if (!v || bins.includes(v)) return undefined;
  if (splitBinNumber(v).length > 1) return "One Lot goes into one Bin only. Pick the Bin this Lot is in.";
  const [problem] = binNumberProblems(v, bins, stores);
  if (problem?.reason === "store") return `${v} is a warehouse, not a Bin. Pick a Bin inside it from the list.`;
  return `${v} isn't a Bin of this warehouse in Masters › Bins. Pick a Bin from the list, or add it there first.`;
}
