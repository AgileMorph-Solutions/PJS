import type { BinProblem } from "@anagroci/contract/domain/binNumber";

/** Said under Bin Number while what's typed isn't a Bin yet. "Not saved yet" first, because nothing
 * is sent to the server until the value is one it would accept (see ReceiptDetailPage's binDraft). */
export function binProblemMessage(problems: BinProblem[]): string | undefined {
  const store = problems.find((p) => p.reason === "store");
  if (store) return `Not saved yet — ${store.code} is a warehouse, not a Bin. Choose a Bin inside it, e.g. ${store.code}-BIN-012.`;
  const unknown = problems.map((p) => p.code);
  if (!unknown.length) return undefined;
  return `Not saved yet — ${unknown.join(", ")} isn't in Masters › Bins. Pick a Bin from the list, or add it there first.`;
}
