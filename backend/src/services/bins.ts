/**
 * Warehouse activities, per Bin (22 Nov 2026). Once RCN is in a Bin its Lots can't be told apart (Sameer, 18 Nov 2026), so
 * what happens inside the warehouse — sun drying, the labour activities, transfers — is recorded against the Bin. This is the
 * read side: each Bin of a warehouse with its stock (services/binStock.ts), and one Bin with what was done to it.
 */
import type { WarehouseBinStock } from "@anagroci/contract/domain/productionBatch";
import { prisma } from "../db.js";
import { siteBinStock } from "./binStock.js";
import { binActivityEntries, binDryingDecision } from "./binStages.js";
import { toLinkedDryingRow } from "./receiptLinks.js";

export interface SiteBinSummary {
  binCode: string;
  /** The warehouse the Bin is in (Masters › Bins); null for a Bin with no warehouse. */
  store: string | null;
  kg: number;
  lotCount: number;
  /** Lots in it whose kg isn't known (no GRN weight, split, shared truck): listed, not counted. */
  lotsWithoutKg: number;
}

/**
 * The Bins of a warehouse (`names`: its site, stores and aliases): only those Masters › Bins puts there (team, 23 Nov 2026:
 * a warehouse never lists another's Bins). With `unassigned`, instead every Bin of the master with no warehouse at all, so
 * they can be found and given one. Each with the stock this warehouse holds in it.
 */
export async function listSiteBins(names: readonly string[], { unassigned = false }: { unassigned?: boolean } = {}): Promise<SiteBinSummary[]> {
  const [stock, master] = await Promise.all([
    siteBinStock(names),
    prisma.bin.findMany({ where: unassigned ? { warehouseName: null } : { warehouseName: { in: [...names] } }, select: { code: true, warehouseName: true } }),
  ]);
  return master
    .map((b) => {
      const s: WarehouseBinStock | undefined = stock.get(b.code);
      return {
        binCode: b.code,
        store: b.warehouseName,
        kg: s?.kg ?? 0,
        lotCount: s?.lots.length ?? 0,
        lotsWithoutKg: s?.lots.filter((l) => l.kg === undefined).length ?? 0,
      };
    })
    .sort((a, b) => b.kg - a.kg || a.binCode.localeCompare(b.binCode));
}

/** One Bin of a warehouse: its stock and Lots, the RCN moved in and out of it, its dryings and its recorded activities. Null when it isn't this warehouse's. */
export async function getSiteBin(names: readonly string[], binCode: string) {
  const code = binCode.trim().toUpperCase();
  const [bin, stock] = await Promise.all([
    prisma.bin.findUnique({ where: { code }, select: { code: true, warehouseName: true } }),
    siteBinStock(names),
  ]);
  const s = stock.get(code);
  // This warehouse's Bin, or one with no warehouse at all (opened from "Bins with no warehouse"). Another warehouse's Bin
  // is never shown here, whatever is in it.
  if (!bin || (bin.warehouseName && !names.includes(bin.warehouseName))) return null;
  const [dryings, activities] = await Promise.all([
    // Every drying chain taken from this Bin, all its rounds: a re-dry round names the chain's first round, not the Bin.
    prisma.dryingBatch.findMany({ where: { source: "entered", lotNo: null, sourceBinNo: code, warehouseSite: { in: [...names] }, firstBatchId: null }, select: { id: true } })
      .then((firsts) => prisma.dryingBatch.findMany({
        where: { OR: [{ id: { in: firsts.map((f) => f.id) } }, { firstBatchId: { in: firsts.map((f) => f.id) } }] },
        orderBy: [{ dryingDate: "asc" }, { sn: "asc" }],
      })),
    prisma.warehouseActivityLedgerEntry.findMany({
      where: { warehouse: { in: [...names] }, OR: [{ locationFrom: code }, { locationTo: code }] },
      include: { createdBy: { select: { displayName: true } } },
      orderBy: [{ activityDate: "desc" }, { createdAt: "desc" }],
    }),
  ]);
  const recorded = activities.map(({ createdBy, ...a }) => ({ ...a, recordedBy: createdBy?.displayName ?? null }));
  return {
    binCode: code,
    store: bin.warehouseName ?? null,
    // Its own Other warehouse activities and Activity ledger entries, most recent first (services/binStages.ts).
    entries: await binActivityEntries(code),
    // "Does this Bin need drying?" — null until answered (25 Nov 2026).
    dryingDecision: await binDryingDecision(code),
    kg: s?.kg ?? 0,
    issuedKg: s?.issuedKg ?? 0,
    lots: s?.lots ?? [],
    movements: s?.movements ?? [],
    history: s?.history ?? [],
    dryings: dryings.map((d) => toLinkedDryingRow(d, true)),
    activities: recorded,
  };
}
