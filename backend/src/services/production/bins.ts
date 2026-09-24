/**
 * Bin service — the production twin's pivot read. A Bin isn't itself a write target in this pass
 * (bins are auto-observed the first time a BTM or Lot references one — see btm.ts/lots.ts); this
 * file only assembles the "what's in this Bin" view: BTMs in, Lots out, running stock from the
 * views in domain/productionStock.ts.
 */
import { PRODUCTION_FIELD_MAP } from "@anagroci/contract/generated/productionFieldMap";
import { BTM_SPINE_TABLES, BIN_SPINE_TABLES, PRODUCTION_TABLE_LABELS, phaseForTable } from "@anagroci/contract/domain/productionStatus";
import { prisma } from "../../db.js";
import { binStock, siloStock } from "../../domain/productionStock.js";
import { createProductionRow, listProductionRows, PRODUCTION_MODEL_DELEGATE } from "../../productionStore.js";
import { ValidationError } from "../../domain/validation.js";

export async function listBins() {
  const bins = await prisma.productionBin.findMany({ orderBy: { binNo: "asc" } });
  const [btmCounts, lotCounts] = await Promise.all([
    prisma.btmIntake.groupBy({ by: ["binNo"], _count: { binNo: true } }),
    prisma.productionLot.groupBy({ by: ["binNo"], _count: { binNo: true } }),
  ]);
  const btmByBin = new Map(btmCounts.map((r) => [r.binNo, r._count.binNo]));
  const lotByBin = new Map(lotCounts.map((r) => [r.binNo, r._count.binNo]));
  return bins.map((b) => ({ ...b, btmCount: btmByBin.get(b.binNo) ?? 0, lotCount: lotByBin.get(b.binNo) ?? 0 }));
}

export async function getBin(binNo: string) {
  const row = await prisma.productionBin.findUnique({ where: { binNo } });
  if (!row) return null;
  const [btmIntakes, lots, stock, silo] = await Promise.all([
    prisma.btmIntake.findMany({ where: { binNo }, orderBy: { btmNo: "asc" } }),
    prisma.productionLot.findMany({ where: { binNo }, orderBy: { lotNo: "asc" } }),
    binStock(binNo),
    siloStock(binNo),
  ]);
  return { ...row, btmIntakes, lots, stock, silo };
}

/** Generic access for the Bin-spine tables beyond the pivot view above (silos-stock-row,
 * wholes-manual-calibration, offloading-bin-report) — the same auto-observe-on-write pattern
 * btm.ts/lots.ts use, since a Bin is never itself an explicit write target. */
export async function listBinTable(tableId: string, binNo: string, limit?: number) {
  const spec = PRODUCTION_FIELD_MAP[tableId];
  if (!spec || spec.spine !== "bin") throw new ValidationError(`"${tableId}" is not a Bin-spine production table.`);
  return listProductionRows(tableId, binNo, limit);
}

export async function addBinRow(tableId: string, binNo: string, fields: Record<string, string>) {
  const spec = PRODUCTION_FIELD_MAP[tableId];
  if (!spec || spec.spine !== "bin") throw new ValidationError(`"${tableId}" is not a Bin-spine production table.`);
  if (!binNo || !binNo.trim()) throw new ValidationError("A Bin No is required.");
  await prisma.productionBin.upsert({ where: { binNo }, update: {}, create: { binNo, source: "auto-observed" } });
  return createProductionRow(tableId, binNo, fields);
}

export interface BinPhaseStep {
  tableId: string;
  label: string;
  phase: string;
  kind: "aggregate" | "direct";
  doneCount: number;
  totalCount: number;
}

type CountableDelegate = { findMany: (a: unknown) => Promise<{ btmNo: string }[]>; count: (a: unknown) => Promise<number> };

/**
 * The Bin page's Phase 1-2 tracker — a Bin isn't a single record, so "done" per step is a real
 * fraction (see the plan: "80 of 103 BTMs"), never a misleading binary checkmark. The 4 BTM-spine
 * tables are "aggregate" (how many of this Bin's BTMs have any row here, out of how many BTMs feed
 * this Bin at all); the 3 Bin-spine tables are "direct" (this Bin's own rows, 0/1 or 1/1) — both
 * expressed as doneCount/totalCount so the UI renders one consistent fraction badge either way.
 */
export async function getBinPhaseProgress(binNo: string): Promise<BinPhaseStep[]> {
  const btmNos = (await prisma.btmIntake.findMany({ where: { binNo }, select: { btmNo: true } })).map((r) => r.btmNo);
  const totalBtms = btmNos.length;

  const aggregateSteps = await Promise.all(
    BTM_SPINE_TABLES.map(async (tableId): Promise<BinPhaseStep> => {
      const delegateName = PRODUCTION_MODEL_DELEGATE[tableId]!;
      const delegate = (prisma as unknown as Record<string, CountableDelegate>)[delegateName];
      const doneCount = totalBtms
        ? (await delegate.findMany({ where: { btmNo: { in: btmNos } }, select: { btmNo: true }, distinct: ["btmNo"] })).length
        : 0;
      return { tableId, label: PRODUCTION_TABLE_LABELS[tableId] ?? tableId, phase: phaseForTable(tableId), kind: "aggregate", doneCount, totalCount: totalBtms };
    })
  );

  const directSteps = await Promise.all(
    BIN_SPINE_TABLES.map(async (tableId): Promise<BinPhaseStep> => {
      const delegateName = PRODUCTION_MODEL_DELEGATE[tableId]!;
      const delegate = (prisma as unknown as Record<string, CountableDelegate>)[delegateName];
      const has = (await delegate.count({ where: { binNo } })) > 0;
      return { tableId, label: PRODUCTION_TABLE_LABELS[tableId] ?? tableId, phase: phaseForTable(tableId), kind: "direct", doneCount: has ? 1 : 0, totalCount: 1 };
    })
  );

  return [...aggregateSteps, ...directSteps];
}
