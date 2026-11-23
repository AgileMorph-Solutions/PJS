/**
 * Rules on the values a person types into a truck's stages, checked as they are written (services/receipts.ts
 * applyStageFields, for a direct edit, an approved form and the batch grid; never for an upload, which is reported, not refused).
 * They are only ever applied to a value that is being changed, so a record that already holds something the rule would
 * refuse (an older or imported one) can still be opened and saved without touching it.
 */
import type { Prisma } from "@prisma/client";
import { resolveChoice } from "@anagroci/contract/data/fieldChoices";
import { ValidationError } from "../domain/validation.js";

type Tx = Prisma.TransactionClient;

/**
 * A field that is picked from a fixed list takes one of its answers, and nothing else: a typo ("cach") saved quietly is a
 * truck every report on CASH versus CREDIT then misses. The spelling is the list's own, so "cash" is stored as CASH.
 * The warehouse type has its own message (services/receipts.ts) and is left to it.
 */
export function withChoiceValues(
  stageId: string,
  fields: Record<string, string>,
  stored: Record<string, string> | undefined,
  skipLabels: readonly string[] = [],
): Record<string, string> {
  const out = { ...fields };
  for (const [label, raw] of Object.entries(fields)) {
    if (skipLabels.includes(label)) continue;
    const value = String(raw ?? "");
    if (!value.trim() || value === (stored?.[label] ?? "")) continue; // blank is "not chosen yet"; unchanged is not ours to refuse
    const choice = resolveChoice(stageId, label, value);
    if (!choice) continue; // no list for this field
    if (choice.value === undefined) throw new ValidationError(`${label} must be one of: ${choice.options.join(", ")}.`);
    out[label] = choice.value;
  }
  return out;
}

/**
 * The FICHE is the number that travels with a truck's load across the drying report, the transfer ledger and the
 * warehouse receiving sheet (it backs the "linked records" on the truck page), so two trucks at a warehouse can't share one:
 * records found by the fiche would then show on both.
 */
export async function assertFicheNotOnAnotherTruck(
  tx: Tx,
  receiptId: string,
  warehouse: string | undefined,
  fields: Record<string, string>,
  stored: Record<string, string> | undefined,
): Promise<void> {
  const fiche = (fields["FICHE"] ?? "").trim();
  if (!warehouse || !fiche || fiche === (stored?.["FICHE"] ?? "").trim()) return;
  const other = await tx.stageVerifyDocs.findFirst({
    where: { fiche: { equals: fiche, mode: "insensitive" }, receipt: { warehouse, NOT: { id: receiptId } } },
    select: { receiptId: true },
  });
  if (other) {
    throw new ValidationError(`FICHE ${fiche} is already on truck ${other.receiptId}. Each truck has its own fiche: check the number.`, { receiptId: other.receiptId });
  }
}
