/**
 * Production Phase 0: batches — which of the factory's warehouse bins will be processed next.
 *
 * The bins and their stock come straight from procurement (contract's warehouseBinStock over the
 * site's receipts), so a batch always starts from what procurement actually recorded, and every
 * batch bin leads back to the Lots in it, their trucks and suppliers.
 */
import { Prisma } from "@prisma/client";
import { arrivedLots, BATCH_CODE_PATTERN, batchStatus, planBatch, warehouseBinStock, type WarehouseBinStock } from "@anagroci/contract/domain/productionBatch";
import { MOISTURE_DECISION_LABELS, type MoistureDecision } from "@anagroci/contract/domain/rcnReceipt";
import { weighingTotals } from "@anagroci/contract/domain/rcnWeighing";
import { SIZING_DECISION_LABELS, samplingPointLabel, siloLabel, sizesTotal, type SamplingPoint, type SiloSize, type SizingDecision } from "@anagroci/contract/domain/calibration";
import { isIsoDate } from "@anagroci/contract/domain/dateFormat";
import type { AvailableBin, BatchDetail, BatchHistoryEntry, BatchSummary } from "@anagroci/contract/types/productionBatch";
import { prisma } from "../../db.js";
import { resolveSite } from "../../domain/site.js";
import { ValidationError } from "../../domain/validation.js";
import { listReceipts } from "../receipts.js";
import { listTransfers } from "../transfers.js";

/**
 * The factory site production works at. Production happens only at a FACTORY site (Yakro); a user
 * pinned to another site is refused rather than shown an empty screen. An admin with no site chosen
 * gets the factory, as long as there is exactly one.
 */
export async function productionSite(scoped: string | undefined): Promise<string> {
  if (scoped) {
    const row = await prisma.warehouse.findUnique({ where: { name: scoped }, select: { kind: true } });
    if (row?.kind !== "FACTORY") throw new ValidationError(`Production runs at the factory; ${scoped} isn't one.`);
    return scoped;
  }
  const factories = await prisma.warehouse.findMany({ where: { kind: "FACTORY", site: null }, select: { name: true } });
  if (factories.length !== 1) throw new ValidationError("Choose which factory (?warehouse=).");
  return factories[0]!.name;
}

/** Stock of every bin at the site: its own procurement receipts, plus the Lots other sites sent here on a BKT. */
export async function procurementBinStock(site: string): Promise<Map<string, WarehouseBinStock>> {
  const names = await resolveSite(site);
  const [receipts, transfers] = await Promise.all([listReceipts(names), listTransfers(names)]);
  return warehouseBinStock(receipts, arrivedLots(transfers.filter((t) => names.includes(t.toWarehouse))));
}

/**
 * Which batch each bin is already in. Every batch counts as running until closing exists (Phase 8);
 * when it does, closed batches drop out here and their bins become selectable again.
 */
async function runningBatchOfBins(binCodes?: string[]): Promise<Map<string, string>> {
  const rows = await prisma.productionBatchBin.findMany({
    where: binCodes ? { binCode: { in: binCodes } } : {},
    select: { binCode: true, batchCode: true },
  });
  return new Map(rows.map((r) => [r.binCode, r.batchCode]));
}

/** The New batch screen's list: the site's bins holding stock, plus bins already in a batch (greyed out). */
export async function listAvailableBins(site: string): Promise<AvailableBin[]> {
  const stock = await procurementBinStock(site);
  const batchBins = await prisma.productionBatchBin.findMany({ where: { batch: { warehouse: site } }, select: { binCode: true, batchCode: true } });
  const codes = [...new Set([...stock.keys(), ...batchBins.map((b) => b.binCode)])];
  const [master, inBatch] = await Promise.all([
    prisma.bin.findMany({ where: { code: { in: codes } }, select: { code: true, warehouseName: true } }),
    runningBatchOfBins(codes),
  ]);
  const storeOf = new Map(master.map((b) => [b.code, b.warehouseName]));
  return codes
    .map((code) => {
      const s = stock.get(code);
      return {
        binCode: code,
        store: storeOf.get(code) ?? null,
        kg: s?.kg ?? 0,
        lotCount: s?.lots.length ?? 0,
        lotsWithoutKg: s?.lots.filter((l) => l.kg === undefined).length ?? 0,
        inBatch: inBatch.get(code) ?? null,
        inMaster: storeOf.has(code),
      };
    })
    .sort((a, b) => b.kg - a.kg || a.binCode.localeCompare(b.binCode));
}

export interface CreateBatchInput {
  code?: string;
  startDate?: string;
  proposedBy?: string;
  bins?: string[];
}

export async function createBatch(site: string, actorId: string, input: CreateBatchInput) {
  const stock = await procurementBinStock(site);
  return prisma.$transaction((tx) => createBatchIn(tx, site, actorId, input, stock));
}

/**
 * The batch rules, inside the caller's transaction: the New batch screen runs them in one of its own, the
 * production workbook upload in the one that holds the whole file. `stock` is the site's bin stock as
 * procurementBinStock gives it.
 */
export async function createBatchIn(tx: Prisma.TransactionClient, site: string, actorId: string, input: CreateBatchInput, stock: Map<string, WarehouseBinStock>) {
  const code = (input.code ?? "").trim().toUpperCase();
  if (!code) throw new ValidationError("A batch needs a name.");
  if (!BATCH_CODE_PATTERN.test(code)) throw new ValidationError(`"${code}" can only use letters, digits and - _ .`);
  const startDate = (input.startDate ?? "").trim();
  if (!isIsoDate(startDate)) throw new ValidationError("A start date is required.");
  const binCodes = [...new Set((input.bins ?? []).map((b) => String(b).trim().toUpperCase()).filter(Boolean))];
  if (binCodes.length === 0) throw new ValidationError("Pick at least one warehouse bin.");

  {
    // Lock the chosen bins, so two batches created at the same moment can't both take the same bin.
    const locked = await tx.$queryRaw<{ code: string }[]>`SELECT code FROM "Bin" WHERE code IN (${Prisma.join(binCodes)}) FOR UPDATE`;
    const missing = binCodes.filter((c) => !locked.some((l) => l.code === c));
    if (missing.length) throw new ValidationError(`Not in Masters › Bins: ${missing.join(", ")}. Add the bin there first.`);

    const empty = binCodes.filter((c) => !stock.get(c)?.lots.length);
    if (empty.length) throw new ValidationError(`No procurement stock in ${empty.join(", ")} at ${site}.`);

    const taken = await tx.productionBatchBin.findMany({ where: { binCode: { in: binCodes } }, select: { binCode: true, batchCode: true } });
    if (taken.length) throw new ValidationError(taken.map((t) => `${t.binCode} is already in batch ${t.batchCode}`).join("; ") + ".");

    if (await tx.productionBatch.findUnique({ where: { code }, select: { code: true } })) throw new ValidationError(`Batch ${code} already exists.`);

    await tx.productionBatch.create({
      data: {
        code,
        warehouse: site,
        startDate,
        proposedBy: (input.proposedBy ?? "").trim() || null,
        createdById: actorId,
        bins: { create: binCodes.map((binCode) => ({ binCode, plannedKg: new Prisma.Decimal(stock.get(binCode)!.kg) })) },
      },
    });
    return code;
  }
}

const BATCH_INCLUDE = {
  bins: true,
  createdBy: { select: { displayName: true } },
  rcnReceipts: {
    select: {
      btmNo: true, binCode: true, createdAt: true, createdBy: { select: { displayName: true } },
      moistureChecks: {
        select: {
          moisture: true, decision: true, status: true, submittedById: true, reviewedById: true, submittedAt: true, reviewedAt: true, rejectReason: true,
          submittedBy: { select: { displayName: true } }, reviewedBy: { select: { displayName: true } },
        },
      },
      pallets: { select: { grossKg: true, bags: true } },
      emptyPallets: { select: { weightKg: true } },
      dustKg: true, voidsKg: true, finalisedAt: true, finalisedBy: { select: { displayName: true } },
      calibrationRuns: {
        select: {
          date: true, createdAt: true, createdBy: { select: { displayName: true } },
          kgApp: true, kgAp: true, kgA: true, kgAB: true, kgB: true, kgBC: true, kgC: true, kgD: true, kgE: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  },
  sizingChecks: {
    select: {
      point: true, decision: true, status: true, submittedById: true, reviewedById: true, submittedAt: true, reviewedAt: true, rejectReason: true,
      submittedBy: { select: { displayName: true } }, reviewedBy: { select: { displayName: true } },
      manualCalibrations: { select: { fromSize: true, toSize: true, kg: true, createdAt: true, createdBy: { select: { displayName: true } } } },
    },
  },
} satisfies Prisma.ProductionBatchInclude;

type BatchRow = Prisma.ProductionBatchGetPayload<{ include: typeof BATCH_INCLUDE }>;

function toSummary(b: BatchRow): BatchSummary {
  const plan = planBatch(b.bins.map((x) => Number(x.plannedKg)), b.startDate);
  return {
    code: b.code,
    warehouse: b.warehouse,
    startDate: b.startDate,
    proposedBy: b.proposedBy,
    createdBy: b.createdBy.displayName,
    createdAt: b.createdAt.toISOString(),
    status: batchStatus(b.rcnReceipts.length),
    plannedKg: plan.plannedKg,
    days: plan.days,
    endDate: plan.endDate ?? null,
    binCodes: b.bins.map((x) => x.binCode).sort(),
  };
}

export async function listBatches(site: string): Promise<BatchSummary[]> {
  const rows = await prisma.productionBatch.findMany({ where: { warehouse: site }, include: BATCH_INCLUDE, orderBy: { createdAt: "desc" } });
  return rows.map(toSummary);
}

const tonnes = (kg: number) => `${(kg / 1000).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} t`;

export async function getBatch(site: string, code: string): Promise<BatchDetail | null> {
  const row = await prisma.productionBatch.findFirst({ where: { code, warehouse: site }, include: BATCH_INCLUDE });
  if (!row) return null;
  const stock = await procurementBinStock(site);
  const summary = toSummary(row);

  const bins = row.bins
    .map((b) => {
      const s = stock.get(b.binCode);
      return { binCode: b.binCode, plannedKg: Number(b.plannedKg), currentKg: s?.kg ?? 0, lots: s?.lots ?? [] };
    })
    .sort((a, b) => b.plannedKg - a.plannedKg);

  // Read off the records themselves (the batch, its receipts and their checks), not kept as a second log.
  const history: BatchHistoryEntry[] = [
    { at: summary.createdAt, text: `Batch created with ${bins.length} bin${bins.length === 1 ? "" : "s"} (${tonnes(summary.plannedKg)})`, actor: summary.createdBy },
    ...row.rcnReceipts.flatMap((r, i) => [
      {
        at: r.createdAt.toISOString(),
        text: i === 0 ? `First RCN Receipt, BTM ${r.btmNo} from ${r.binCode}: batch In process` : `RCN Receipt BTM ${r.btmNo} from ${r.binCode}`,
        actor: r.createdBy.displayName,
      },
      ...r.moistureChecks.flatMap((c) => moistureHistory(r.btmNo, c)),
      ...(r.finalisedAt ? [weighedHistory(r)] : []),
      ...r.calibrationRuns.map((c) => ({
        at: c.createdAt.toISOString(),
        text: `BTM ${r.btmNo} sized into silos: ${kgText(sizesTotal({ App: c.kgApp ?? undefined, Ap: c.kgAp ?? undefined, A: c.kgA ?? undefined, AB: c.kgAB ?? undefined, B: c.kgB ?? undefined, BC: c.kgBC ?? undefined, C: c.kgC ?? undefined, D: c.kgD ?? undefined, E: c.kgE ?? undefined }))}`,
        actor: c.createdBy.displayName,
      })),
    ]),
    ...row.sizingChecks.flatMap((c) => [
      ...reviewedHistory(
        `Sizing check (QC-2), ${samplingPointLabel(c.point as SamplingPoint)}: ${SIZING_DECISION_LABELS[c.decision as SizingDecision]}`,
        "Sizing check",
        c,
      ),
      ...c.manualCalibrations.map((m) => ({
        at: m.createdAt.toISOString(),
        text: `Re-sized by hand: ${kgText(Number(m.kg))} from silo ${siloLabel(m.fromSize as SiloSize)} to ${siloLabel(m.toSize as SiloSize)}`,
        actor: m.createdBy.displayName,
      })),
    ]),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return { ...summary, bins, history };
}

/** For the procurement Bin page: the batch a bin has been put in, if any. */
export async function batchOfBin(binCode: string): Promise<{ batchCode: string; plannedKg: number } | null> {
  const row = await prisma.productionBatchBin.findFirst({ where: { binCode }, select: { batchCode: true, plannedKg: true } });
  return row ? { batchCode: row.batchCode, plannedKg: Number(row.plannedKg) } : null;
}

type CheckForHistory = BatchRow["rcnReceipts"][number]["moistureChecks"][number];

const kgText = (kg: number) => `${kg.toLocaleString("en-US", { maximumFractionDigits: 2 })} kg`;

/** One entry when the final weight is saved, not one per pallet: 50–100 pallet rows would drown the history. */
function weighedHistory(r: BatchRow["rcnReceipts"][number]): BatchHistoryEntry {
  const t = weighingTotals(r.pallets, { emptyPallets: r.emptyPallets, dustKg: r.dustKg ?? undefined, voidsKg: r.voidsKg ?? undefined });
  return {
    at: r.finalisedAt!.toISOString(),
    text: `BTM ${r.btmNo} weighed: ${t.pallets} pallet${t.pallets === 1 ? "" : "s"}, net ${kgText(t.netKg)}, ${kgText(t.toSilosKg)} to silos`,
    actor: r.finalisedBy?.displayName ?? null,
  };
}

/**
 * A check is one entry when the Incharge/Admin entered it directly, two (submitted, then reviewed) otherwise.
 * Only a direct entry is reviewed by its own author: a submitter can't approve.
 */
function moistureHistory(btmNo: string, c: CheckForHistory): BatchHistoryEntry[] {
  return reviewedHistory(`BTM ${btmNo} moisture ${c.moisture} %, ${MOISTURE_DECISION_LABELS[c.decision as MoistureDecision]}`, `BTM ${btmNo} moisture check`, c);
}

type ReviewedForHistory = Pick<CheckForHistory, "status" | "submittedById" | "reviewedById" | "submittedAt" | "reviewedAt" | "rejectReason" | "submittedBy" | "reviewedBy">;

/** A moisture check and a QC-2 sizing check read the same way in the history. */
function reviewedHistory(what: string, name: string, c: ReviewedForHistory): BatchHistoryEntry[] {
  const direct = c.reviewedById === c.submittedById;
  if (direct) return [{ at: c.submittedAt.toISOString(), text: what, actor: c.submittedBy.displayName }];
  const entries: BatchHistoryEntry[] = [{ at: c.submittedAt.toISOString(), text: `${what}: submitted for approval`, actor: c.submittedBy.displayName }];
  if (c.reviewedAt) {
    entries.push({
      at: c.reviewedAt.toISOString(),
      text: c.status === "approved" ? `${name} approved` : `${name} rejected: ${c.rejectReason ?? ""}`,
      actor: c.reviewedBy?.displayName ?? null,
    });
  }
  return entries;
}
