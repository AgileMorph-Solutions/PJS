/**
 * Production Phase 1, steps 3–4: weigh a load pallet by pallet, then save its final weight (the client's
 * "RCN Receipts Tally Sheet"). No approval: whoever weighs saves directly.
 *
 * Any order (team decision, Nov 2026): pallets and the final weight can be recorded whatever the moisture check says,
 * and both stay correctable — the final weight is saved again to change it. The one rule kept protects the numbers:
 * a change may not leave the load handing over less than has already been sorted into the silos.
 */
import type { Prisma } from "@prisma/client";
import { finalWeightError, palletError } from "@anagroci/contract/domain/rcnWeighing";
import type { RcnFinalWeightInput, RcnPalletInput, RcnReceipt } from "@anagroci/contract/types/rcnReceipt";
import { prisma } from "../../db.js";
import { ValidationError } from "../../domain/validation.js";
import { blankToNull, receiptAt, toView } from "./rcnReceipts.js";

/** The receipt to weigh: any load at the site, at any step. */
const weighableReceipt = (tx: Prisma.TransactionClient, site: string, id: string) => receiptAt(tx, site, id);

/**
 * After a change to a load's weighing: refuse it (rolling the transaction back) when the load would now hand over less
 * than is already sorted into the silos — the silos would hold nuts the load never had.
 */
async function stillCoversSorted(tx: Prisma.TransactionClient, site: string, id: string) {
  const row = await receiptAt(tx, site, id);
  const cal = toView(row).calibration;
  if (cal && cal.leftKg !== null && cal.leftKg < 0) {
    throw new ValidationError(`${id} would hand over ${cal.toSilosKg} kg, less than the ${cal.sizedKg} kg already sorted into the silos. Remove a calibration run first.`);
  }
  return row;
}

function palletData(input: RcnPalletInput) {
  const problem = palletError(input);
  if (problem) throw new ValidationError(problem);
  return { grossKg: input.grossKg!.trim(), bags: input.bags!.trim(), factoryBin: input.factoryBin!.trim().toUpperCase() };
}

async function palletAt(tx: Prisma.TransactionClient, site: string, palletId: number) {
  const pallet = await tx.rcnPallet.findFirst({ where: { id: palletId, rcnReceipt: { batch: { warehouse: site } } } });
  if (!pallet) throw new ValidationError(`Pallet ${palletId} doesn't exist at ${site}.`);
  return pallet;
}

export async function addPallet(site: string, actorId: string, receiptId: string, input: RcnPalletInput): Promise<RcnReceipt> {
  return toView(await prisma.$transaction((tx) => addPalletIn(tx, site, actorId, receiptId, input)));
}

/** addPallet's rules inside the caller's transaction (the production workbook upload shares one). */
export async function addPalletIn(tx: Prisma.TransactionClient, site: string, actorId: string, receiptId: string, input: RcnPalletInput) {
  const data = palletData(input);
  const receipt = await weighableReceipt(tx, site, receiptId);
  await tx.rcnPallet.create({ data: { ...data, rcnReceiptId: receipt.id, weighedById: actorId } });
  return stillCoversSorted(tx, site, receipt.id);
}

/** A typo on the scale is corrected in place; the pallet keeps its number. */
export async function updatePallet(site: string, palletId: number, input: RcnPalletInput): Promise<RcnReceipt> {
  return toView(await prisma.$transaction((tx) => updatePalletIn(tx, site, palletId, input)));
}

export async function updatePalletIn(tx: Prisma.TransactionClient, site: string, palletId: number, input: RcnPalletInput) {
  const data = palletData(input);
  const pallet = await palletAt(tx, site, palletId);
  await weighableReceipt(tx, site, pallet.rcnReceiptId);
  await tx.rcnPallet.update({ where: { id: pallet.id }, data });
  return stillCoversSorted(tx, site, pallet.rcnReceiptId);
}

export async function deletePallet(site: string, palletId: number): Promise<RcnReceipt> {
  const row = await prisma.$transaction(async (tx) => {
    const pallet = await palletAt(tx, site, palletId);
    await weighableReceipt(tx, site, pallet.rcnReceiptId);
    await tx.rcnPallet.delete({ where: { id: pallet.id } });
    return stillCoversSorted(tx, site, pallet.rcnReceiptId);
  });
  return toView(row);
}

/** Step 4: the empty pallets' weighings, dust and voids. Saved again, it replaces what was saved before. */
export async function saveFinalWeight(site: string, actorId: string, receiptId: string, input: RcnFinalWeightInput): Promise<RcnReceipt> {
  return toView(await prisma.$transaction((tx) => saveFinalWeightIn(tx, site, actorId, receiptId, input)));
}

/** saveFinalWeight's rules inside the caller's transaction (the production workbook upload shares one). */
export async function saveFinalWeightIn(tx: Prisma.TransactionClient, site: string, actorId: string, receiptId: string, input: RcnFinalWeightInput) {
  {
    const receipt = await weighableReceipt(tx, site, receiptId);
    const problem = finalWeightError(input, receipt.pallets.length);
    if (problem) throw new ValidationError(problem);

    const stacks = (input.emptyPallets ?? []).filter((s) => blankToNull(s.weightKg) !== null);
    await tx.rcnEmptyPalletStack.deleteMany({ where: { rcnReceiptId: receipt.id } });
    await tx.rcnEmptyPalletStack.createMany({
      data: stacks.map((s) => ({ rcnReceiptId: receipt.id, weightKg: s.weightKg!.trim(), count: blankToNull(s.count) })),
    });
    await tx.rcnReceipt.update({
      where: { id: receipt.id },
      data: { dustKg: blankToNull(input.dustKg), voidsKg: blankToNull(input.voidsKg), finalisedById: actorId, finalisedAt: new Date() },
    });
    return stillCoversSorted(tx, site, receipt.id);
  }
}
