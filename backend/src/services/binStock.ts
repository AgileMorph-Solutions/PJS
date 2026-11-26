/**
 * The stock of a warehouse's Bins, worked out (never stored) from everything that put RCN in or took it out: the Lots
 * reception put there, Lots that arrived on a BKT made per Lot, drying from a Bin, trucks loaded from a Bin, lots made out of
 * Bins to send (once weighed), and the loads production accepted. One function for the Warehouse activities pages and for production's choice of Bins, so the two
 * can never show different stock for the same Bin (contract's warehouseBinStock).
 */
import { arrivedLots, binDryingMovements, binLotMovements, binTransferMovements, lotLinesSentOnBkts, lotsSentOnBkts, warehouseBinStock, type BinDryingRoundFacts, type WarehouseBinStock } from "@anagroci/contract/domain/productionBatch";
import { listTransferLots } from "./transferLots.js";
import { weighingTotals } from "@anagroci/contract/domain/rcnWeighing";
import { prisma } from "../db.js";
import { listReceipts } from "./receipts.js";
import { listTransfers } from "./transfers.js";
import { dryingRoundsByLot } from "./dryingRounds.js";

const num = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));

/** Sun drying started from a Bin at these warehouses: in-app rounds with a source Bin and no Lot. */
export async function binDryingRounds(names: readonly string[]): Promise<BinDryingRoundFacts[]> {
  const rows = await prisma.dryingBatch.findMany({
    where: { source: "entered", lotNo: null, sourceBinNo: { not: null }, warehouseSite: { in: [...names] } },
    select: { id: true, sn: true, firstBatchId: true, round: true, status: true, sourceBinNo: true, destinationBinNo: true, issuedNetWeightKg: true, receivedNetWeightKg: true, dryingDate: true },
  });
  return rows.map((r) => ({
    id: r.id, sn: r.sn, firstBatchId: r.firstBatchId, round: r.round, status: r.status,
    sourceBinNo: r.sourceBinNo, destinationBinNo: r.destinationBinNo,
    issuedNetWeightKg: num(r.issuedNetWeightKg), receivedNetWeightKg: num(r.receivedNetWeightKg),
    date: r.dryingDate?.toISOString().slice(0, 10) ?? "",
  }));
}

/**
 * Stock of every Bin at a site (`names`: the site, its stores and aliases — domain/site.ts), less the loads production runs
 * held there accepted out of them (only a Central site has any). `productionSite` narrows those runs to one site name.
 * Without it the runs are found by the site's own names: the Warehouse activities pages and the drying check used to leave
 * production's loads out, so a Bin read more there than on production's pages (25 Nov 2026: Yakro BIN-10, BIN-16).
 */
export async function siteBinStock(names: readonly string[], productionSite?: string): Promise<Map<string, WarehouseBinStock>> {
  const [receipts, transfers, binRounds, accepted, transferLots] = await Promise.all([
    listReceipts([...names]),
    listTransfers([...names]),
    binDryingRounds(names),
    prisma.rcnReceipt.findMany({
      where: { acceptedAt: { not: null }, batch: { warehouse: productionSite ?? { in: [...names] } } },
      select: { id: true, acceptedAt: true, binCode: true, pallets: true, emptyPallets: true },
    }),
    listTransferLots(names),
  ]);
  const lotRounds = await dryingRoundsByLot(prisma, receipts.filter((r) => r.stageData["n-drying"]).map((r) => r.lotNo ?? ""));
  const issued = accepted.map((r) => ({
    binCode: r.binCode, netKg: weighingTotals(r.pallets, { emptyPallets: r.emptyPallets }).netKg,
    date: r.acceptedAt?.toISOString().slice(0, 10) ?? "", ref: r.id,
  }));
  const movements = [...binDryingMovements(binRounds), ...binTransferMovements(transfers, names), ...binLotMovements(transferLots)];
  return warehouseBinStock(receipts, arrivedLots(transfers.filter((t) => names.includes(t.toWarehouse))), lotRounds, issued, movements, lotsSentOnBkts(transfers, names), lotLinesSentOnBkts(transfers, names));
}

/**
 * Why a Bin can't be worked on from this site (`names`: the site first, then its stores and aliases), or null when it can:
 * only a Bin Masters › Bins puts here (team, 23 Nov 2026: a warehouse never works on another's Bins). A Bin with no warehouse
 * waits until an admin gives it one — it is listed under "Bins with no warehouse" so it can be found.
 */
export async function binSiteProblem(names: readonly string[], code: string): Promise<string | null> {
  const bin = await prisma.bin.findUnique({ where: { code }, select: { warehouseName: true } });
  if (!bin) return `Bin "${code}" isn't in the Bin master — add it in Masters › Bins first.`;
  if (!bin.warehouseName) return `Bin ${code} has no warehouse yet. An admin sets it in Masters › Bins, then it can be used.`;
  return names.includes(bin.warehouseName) ? null : `Bin ${code} isn't a Bin of this warehouse.`;
}
