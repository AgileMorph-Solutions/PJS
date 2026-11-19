/**
 * Production Phase 1, steps 3–4: weigh a load pallet by pallet, then save its final weight (the client's
 * "RCN Receipts Tally Sheet"). No approval: whoever weighs saves directly.
 *
 * Any order (team decision, Nov 2026): pallets and the final weight can be recorded whatever the moisture check says,
 * and both stay correctable — the final weight is saved again to change it — until production accepts the load
 * (assertNotAccepted): its net has then left the warehouse bin and net − dust − voids is in the silos. The one rule kept
 * protects the numbers: a change may not leave the silos holding less than was already cooked out of them.
 */
import type { Prisma } from "@prisma/client";
import { finalWeightError, palletError } from "@anagroci/contract/domain/rcnWeighing";
import type { RcnFinalWeightInput, RcnPalletInput, RcnReceipt } from "@anagroci/contract/types/rcnReceipt";
import { prisma } from "../../db.js";
import { ValidationError } from "../../domain/validation.js";
import { assertSilosCoverCooked } from "./calibration.js";
import { assertNotAccepted, blankToNull, receiptAt, toView, type Actor } from "./rcnReceipts.js";

/** The receipt to weigh: any load at the site, at any step, until production accepts it. */
async function weighableReceipt(tx: Prisma.TransactionClient, site: string, id: string, actor: Actor) {
  const receipt = await receiptAt(tx, site, id);
  assertNotAccepted(receipt, actor);
  return receipt;
}

/**
 * After a change to a load's weighing: refuse it (rolling the transaction back) when its run's silos would now hold less
 * than the run already cooked out of them — Cooking would have used nuts the loads never brought.
 */
async function stillCoversCooked(tx: Prisma.TransactionClient, site: string, id: string) {
  const receipt = await receiptAt(tx, site, id);
  await assertSilosCoverCooked(tx, site, receipt.batchCode, `This change to ${id}`);
  return receipt;
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

export async function addPallet(site: string, actor: Actor, receiptId: string, input: RcnPalletInput): Promise<RcnReceipt> {
  return toView(await prisma.$transaction((tx) => addPalletIn(tx, site, actor, receiptId, input)));
}

/** addPallet's rules inside the caller's transaction (the production workbook upload shares one). */
export async function addPalletIn(tx: Prisma.TransactionClient, site: string, actor: Actor, receiptId: string, input: RcnPalletInput) {
  const data = palletData(input);
  const receipt = await weighableReceipt(tx, site, receiptId, actor);
  await tx.rcnPallet.create({ data: { ...data, rcnReceiptId: receipt.id, weighedById: actor.id } });
  return stillCoversCooked(tx, site, receipt.id);
}

/**
 * addPalletIn's rules for a whole tally sheet's worth of one load at once (the production workbook's RCN Tally Sheet):
 * the same checks per pallet, one write, one silo check — a load is 60–110 pallets in the client's file.
 */
export async function addPalletsIn(tx: Prisma.TransactionClient, site: string, actor: Actor, receiptId: string, inputs: RcnPalletInput[]) {
  const data = inputs.map(palletData);
  const receipt = await weighableReceipt(tx, site, receiptId, actor);
  await tx.rcnPallet.createMany({ data: data.map((d) => ({ ...d, rcnReceiptId: receipt.id, weighedById: actor.id })) });
  return stillCoversCooked(tx, site, receipt.id);
}

/** A typo on the scale is corrected in place; the pallet keeps its number. */
export async function updatePallet(site: string, actor: Actor, palletId: number, input: RcnPalletInput): Promise<RcnReceipt> {
  return toView(await prisma.$transaction((tx) => updatePalletIn(tx, site, actor, palletId, input)));
}

export async function updatePalletIn(tx: Prisma.TransactionClient, site: string, actor: Actor, palletId: number, input: RcnPalletInput) {
  const data = palletData(input);
  const pallet = await palletAt(tx, site, palletId);
  await weighableReceipt(tx, site, pallet.rcnReceiptId, actor);
  await tx.rcnPallet.update({ where: { id: pallet.id }, data });
  return stillCoversCooked(tx, site, pallet.rcnReceiptId);
}

export async function deletePallet(site: string, actor: Actor, palletId: number): Promise<RcnReceipt> {
  const row = await prisma.$transaction(async (tx) => {
    const pallet = await palletAt(tx, site, palletId);
    await weighableReceipt(tx, site, pallet.rcnReceiptId, actor);
    await tx.rcnPallet.delete({ where: { id: pallet.id } });
    return stillCoversCooked(tx, site, pallet.rcnReceiptId);
  });
  return toView(row);
}

/** Step 4: the empty pallets' weighings, dust and voids. Saved again, it replaces what was saved before. */
export async function saveFinalWeight(site: string, actor: Actor, receiptId: string, input: RcnFinalWeightInput): Promise<RcnReceipt> {
  return toView(await prisma.$transaction((tx) => saveFinalWeightIn(tx, site, actor, receiptId, input)));
}

/** saveFinalWeight's rules inside the caller's transaction (the production workbook upload shares one). */
export async function saveFinalWeightIn(tx: Prisma.TransactionClient, site: string, actor: Actor, receiptId: string, input: RcnFinalWeightInput) {
  const receipt = await weighableReceipt(tx, site, receiptId, actor);
  const problem = finalWeightError(input, receipt.pallets.length);
  if (problem) throw new ValidationError(problem);

  const stacks = (input.emptyPallets ?? []).filter((s) => blankToNull(s.weightKg) !== null);
  await tx.rcnEmptyPalletStack.deleteMany({ where: { rcnReceiptId: receipt.id } });
  await tx.rcnEmptyPalletStack.createMany({
    data: stacks.map((s) => ({ rcnReceiptId: receipt.id, weightKg: s.weightKg!.trim(), count: blankToNull(s.count) })),
  });
  await tx.rcnReceipt.update({
    where: { id: receipt.id },
    data: { dustKg: blankToNull(input.dustKg), voidsKg: blankToNull(input.voidsKg), finalisedById: actor.id, finalisedAt: new Date() },
  });
  return stillCoversCooked(tx, site, receipt.id);
}
