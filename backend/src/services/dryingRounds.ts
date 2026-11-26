/**
 * The drying rounds of some Lots, in the shape contract's driedReturn reads. Sun drying done in the app records what came back
 * from drying on its rounds (DryingBatch), never on the receipt's Drying step, so every rule that asks "is this Lot back from
 * drying, and in which bin?" needs them alongside the receipt.
 */
import type { DryingRoundFacts } from "@anagroci/contract/domain/productionBatch";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { wentStraightToProduction, onDryingYard } from "@anagroci/contract/domain/sunDrying";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Whether this truck's own drying — straight off the truck on the yard — ended "sent straight to production" (contract
 * wentStraightToProduction). Its GRN then doesn't wait for a Bin it will never get.
 */
/** The truck's own drying rounds (straight off the truck onto the yard), by its Lot; none before it has a Lot. */
export async function truckDryingRounds(db: Db, receiptId: string) {
  const lot = await db.stageLotAssignment.findUnique({ where: { receiptId }, select: { lotNumber: true } });
  const lotNo = lot?.lotNumber?.trim();
  if (!lotNo) return [];
  return db.dryingBatch.findMany({ where: { lotNo }, select: { sn: true, source: true, status: true } });
}

export async function straightToProduction(db: Db, receiptId: string): Promise<boolean> {
  return wentStraightToProduction(await truckDryingRounds(db, receiptId));
}

/** The truck's RCN is out on the drying yard right now (contract onDryingYard): its Bin step waits. */
export async function dryingOnYard(db: Db, receiptId: string): Promise<boolean> {
  return onDryingYard(await truckDryingRounds(db, receiptId));
}

export async function dryingRoundsByLot(db: Db, lotNos: readonly string[]): Promise<Map<string, DryingRoundFacts[]>> {
  const lots = [...new Set(lotNos.map((l) => l.trim()).filter(Boolean))];
  const byLot = new Map<string, DryingRoundFacts[]>();
  if (!lots.length) return byLot;
  const rows = await db.dryingBatch.findMany({
    where: { lotNo: { in: lots } },
    select: { lotNo: true, sn: true, status: true, source: true, receivedNetWeightKg: true, destinationBinNo: true, outputMoisturePct: true, outputKor: true },
  });
  for (const r of rows) {
    if (!r.lotNo) continue;
    const list = byLot.get(r.lotNo) ?? [];
    list.push({
      sn: r.sn,
      status: r.status,
      source: r.source,
      receivedNetWeightKg: r.receivedNetWeightKg === null ? null : Number(r.receivedNetWeightKg.toString()),
      destinationBinNo: r.destinationBinNo,
      outputMoisturePct: r.outputMoisturePct === null ? null : Number(r.outputMoisturePct.toString()),
      outputKor: r.outputKor === null ? null : Number(r.outputKor.toString()),
    });
    byLot.set(r.lotNo, list);
  }
  return byLot;
}
