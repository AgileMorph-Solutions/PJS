/**
 * The drying rounds of some Lots, in the shape contract's driedReturn reads. Sun drying done in the app records what came back
 * from drying on its rounds (DryingBatch), never on the receipt's Drying step, so every rule that asks "is this Lot back from
 * drying, and in which bin?" needs them alongside the receipt.
 */
import type { DryingRoundFacts } from "@anagroci/contract/domain/productionBatch";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

type Db = Prisma.TransactionClient | typeof prisma;

export async function dryingRoundsByLot(db: Db, lotNos: readonly string[]): Promise<Map<string, DryingRoundFacts[]>> {
  const lots = [...new Set(lotNos.map((l) => l.trim()).filter(Boolean))];
  const byLot = new Map<string, DryingRoundFacts[]>();
  if (!lots.length) return byLot;
  const rows = await db.dryingBatch.findMany({
    where: { lotNo: { in: lots } },
    select: { lotNo: true, sn: true, status: true, source: true, receivedNetWeightKg: true, destinationBinNo: true },
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
    });
    byLot.set(r.lotNo, list);
  }
  return byLot;
}
