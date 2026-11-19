/**
 * Production Phase 2: Calibration. A load is in the silos, as one total (net − dust − voids), once production accepts
 * it: nobody weighs the 9 silos one by one (decision, Nov 2026), so there is nothing to sort by hand. The QFS
 * Officer samples the silos (QC-2), which the Production Incharge approves like a moisture check; a failed silo is
 * re-sized by hand, recorded as typed. Rules are in contract domain/calibration.ts; silo stock is calculated from the
 * loads and cooking rows, never stored.
 *
 * Each write has an `…In` form that runs in the caller's transaction, like rcnReceipts.ts, so a later workbook
 * upload can share it.
 */
import type { Prisma } from "@prisma/client";
import { canRunProduction } from "@anagroci/contract/data/roles";
import { isIsoDate } from "@anagroci/contract/domain/dateFormat";
import {
  SIZING_GRADES, correctSizePct, manualCalibrationError, siloChecks, siloDailyStock, siloLabel, siloPool, sizingCheckError, sizingCheckNotes,
  isSiloSize, type SamplingPoint, type SiloSize, type SizingDecision, type SizingGrams,
} from "@anagroci/contract/domain/calibration";
import type { MoistureCheckStatus } from "@anagroci/contract/domain/rcnReceipt";
import { weighingTotals } from "@anagroci/contract/domain/rcnWeighing";
import type {
  BatchCalibration, ManualCalibration, ManualCalibrationInput, SizingCheck, SizingCheckInput,
} from "@anagroci/contract/types/calibration";
import { prisma } from "../../db.js";
import { runLabel, runWhere } from "./batches.js";
import { ValidationError } from "../../domain/validation.js";
import { blankToNull, runSizes, type Actor } from "./rcnReceipts.js";

type Tx = Prisma.TransactionClient;

const gramColumns = (grams: SizingGrams | undefined) =>
  Object.fromEntries(SIZING_GRADES.map((g) => [g === "under" ? "gUnder" : `g${g}`, blankToNull(grams?.[g])]));

// ── Silo stock ──────────────────────────────────────────────────────────────────────────────────

/**
 * Every load production accepted, every move and every cooking row at the site: the silos are the factory's, shared by
 * all its batches. A load goes in on its own date, at net − dust − voids, the same function its own page shows; a load
 * weighed but not yet accepted is still the warehouse's.
 */
/**
 * One production run's silo movements: its accepted loads in, its own Lots' cooking out. Each run's stock is its own
 * (Nov 2026, the client: "each production run is different"), so one run can never cook nuts another run brought.
 */
async function siloMovements(tx: Tx | typeof prisma, site: string, batchCode: string) {
  const [loads, moves, cooks] = await Promise.all([
    tx.rcnReceipt.findMany({
      where: { acceptedAt: { not: null }, batchCode, batch: { warehouse: site } },
      select: { batchCode: true, date: true, dustKg: true, voidsKg: true, pallets: true, emptyPallets: true },
    }),
    tx.manualCalibration.findMany({ where: { sizingCheck: { batchCode, batch: { warehouse: site } } } }),
    tx.lotCookRun.findMany({ where: { lot: { batchCode, batch: { warehouse: site } } } }),
  ]);
  return {
    loads: loads.map((r) => ({
      batchCode: r.batchCode,
      date: r.date,
      kg: weighingTotals(r.pallets, { emptyPallets: r.emptyPallets, dustKg: r.dustKg ?? undefined, voidsKg: r.voidsKg ?? undefined }).toSilosKg,
    })),
    moves,
    cooks: cooks.map((c) => ({ date: c.date, sizes: runSizes(c) })),
  };
}

/** The run's kg in the silos now: what Phase 3 may cook from for that run. */
export async function siloStockKg(tx: Tx, site: string, batchCode: string): Promise<number> {
  const { loads, cooks } = await siloMovements(tx, site, batchCode);
  return siloPool(loads, cooks).stockKg;
}

/**
 * After a change that takes kg out of the silos' input (a load's weighing lowered or reopened): refuse it, rolling the
 * transaction back, when the silos would now hold less than was already cooked out of them.
 */
export async function assertSilosCoverCooked(tx: Tx, site: string, batchCode: string, what: string): Promise<void> {
  const stock = await siloStockKg(tx, site, batchCode);
  if (stock < 0) throw new ValidationError(`${what} would leave production run ${batchCode}'s silo stock at ${stock.toLocaleString("en-US")} kg: the run has already cooked more than that.`);
}

// ── QC-2 sizing check ──────────────────────────────────────────────────────────────────

const CHECK_INCLUDE = {
  submittedBy: { select: { displayName: true } },
  reviewedBy: { select: { displayName: true } },
  manualCalibrations: { include: { createdBy: { select: { displayName: true } } }, orderBy: { id: "asc" } },
} satisfies Prisma.SizingCheckInclude;

type CheckRow = Prisma.SizingCheckGetPayload<{ include: typeof CHECK_INCLUDE }>;

function manualView(m: CheckRow["manualCalibrations"][number]): ManualCalibration {
  return {
    id: m.id,
    sizingCheckId: m.sizingCheckId,
    date: m.date,
    fromSize: m.fromSize as SiloSize,
    toSize: m.toSize as SiloSize,
    kg: m.kg,
    createdBy: m.createdBy.displayName,
    createdAt: m.createdAt.toISOString(),
  };
}

function checkView(c: CheckRow): SizingCheck {
  const grams: SizingGrams = {};
  for (const g of SIZING_GRADES) {
    const v = c[g === "under" ? "gUnder" : (`g${g}` as `g${SiloSize}`)];
    if (v !== null) grams[g] = v;
  }
  const point = c.point as SamplingPoint;
  const values = { date: c.date, point, sampleG: c.sampleG, grams };
  return {
    id: c.id,
    batchCode: c.batchCode,
    binCode: c.binCode ?? "",
    date: c.date,
    point,
    nutCount: c.nutCount ?? "",
    sampleG: c.sampleG,
    grams,
    correctPct: correctSizePct(point, c.sampleG, grams),
    notes: sizingCheckNotes(values),
    decision: c.decision as SizingDecision,
    status: c.status as MoistureCheckStatus,
    submittedBy: c.submittedBy.displayName,
    submittedAt: c.submittedAt.toISOString(),
    reviewedBy: c.reviewedBy?.displayName ?? null,
    reviewedAt: c.reviewedAt?.toISOString() ?? null,
    rejectReason: c.rejectReason,
    manualCalibrations: c.manualCalibrations.map(manualView),
  };
}

async function checkAt(tx: Tx, site: string, id: number): Promise<CheckRow> {
  const row = await tx.sizingCheck.findFirst({ where: { id, batch: { warehouse: site } }, include: CHECK_INCLUDE });
  if (!row) throw new ValidationError(`Sizing check ${id} doesn't exist at ${site}.`);
  return row;
}

export async function submitSizingCheck(site: string, actor: Actor, input: SizingCheckInput): Promise<SizingCheck> {
  return checkView(await prisma.$transaction((tx) => submitSizingCheckIn(tx, site, actor, input)));
}

/** A QFS Officer's check waits for the Production Incharge; theirs or an Admin's own is approved as it is saved. */
export async function submitSizingCheckIn(tx: Tx, site: string, actor: Actor, input: SizingCheckInput): Promise<CheckRow> {
  const runRef = (input.batchCode ?? "").trim().toUpperCase();
  if (!runRef) throw new ValidationError("Choose the production run the sample is for.");
  const date = (input.date ?? "").trim();
  if (date && !isIsoDate(date)) throw new ValidationError("A date is required.");
  const problem = sizingCheckError({ ...input, date });
  if (problem) throw new ValidationError(problem);

  const batch = await tx.productionBatch.findFirst({ where: runWhere(site, runRef), select: { code: true, name: true, bins: { select: { binCode: true } } } });
  if (!batch) throw new ValidationError(`Production run ${runRef} doesn't exist at ${site}.`);
  const batchCode = batch.code;
  const binCode = blankToNull(input.binCode)?.toUpperCase() ?? null;
  if (binCode && !batch.bins.some((b) => b.binCode === binCode)) throw new ValidationError(`${binCode} is not in production run ${runLabel(batch.code, batch.name)}.`);

  const direct = canRunProduction(actor.role);
  const created = await tx.sizingCheck.create({
    data: {
      batchCode,
      binCode,
      date,
      point: input.point!,
      nutCount: blankToNull(input.nutCount),
      sampleG: input.sampleG!.trim(),
      ...gramColumns(input.grams),
      decision: input.decision!,
      status: direct ? "approved" : "submitted",
      submittedById: actor.id,
      ...(direct ? { reviewedById: actor.id, reviewedAt: new Date() } : {}),
    },
  });
  return checkAt(tx, site, created.id);
}

/** The Incharge's answer to a submitted check. A reject needs a reason and applies nothing. */
export async function reviewSizingCheck(site: string, actorId: string, checkId: number, approve: boolean, reason?: string): Promise<SizingCheck> {
  const rejectReason = (reason ?? "").trim();
  if (!approve && !rejectReason) throw new ValidationError("Give a reason for rejecting the check.");
  const row = await prisma.$transaction(async (tx) => {
    const check = await checkAt(tx, site, checkId);
    if (check.status !== "submitted") throw new ValidationError(`This check was already ${check.status}.`);
    await tx.sizingCheck.update({
      where: { id: check.id },
      data: { status: approve ? "approved" : "rejected", reviewedById: actorId, reviewedAt: new Date(), rejectReason: approve ? null : rejectReason },
    });
    return checkAt(tx, site, check.id);
  });
  return checkView(row);
}

// ── Wholes manual calibration ──────────────────────────────────────────────────────────

export async function addManualCalibration(site: string, actorId: string, checkId: number, input: ManualCalibrationInput): Promise<SizingCheck> {
  return checkView(await prisma.$transaction((tx) => addManualCalibrationIn(tx, site, actorId, checkId, input)));
}

/**
 * "Only after a failed QC-2; kg moves between silos." The nuts leave the silo the failed sample was taken from. No
 * silo's own kg is known, so the kg are recorded as typed and change no total.
 */
export async function addManualCalibrationIn(tx: Tx, site: string, actorId: string, checkId: number, input: ManualCalibrationInput): Promise<CheckRow> {
  const check = await checkAt(tx, site, checkId);
  if (check.decision !== "fail" || check.status !== "approved") throw new ValidationError("Nuts are re-sized by hand only after a failed, approved sizing check.");
  if (!isSiloSize(check.point)) throw new ValidationError("This sample was taken before calibration; there is no silo to re-size.");
  const date = (input.date ?? "").trim();
  if (date && !isIsoDate(date)) throw new ValidationError("A date is required.");
  const fromSize = input.fromSize ?? check.point;
  if (fromSize !== check.point) throw new ValidationError(`The sample was from silo ${siloLabel(check.point)}; the nuts are re-sized out of that silo.`);

  const problem = manualCalibrationError({ ...input, date, fromSize });
  if (problem) throw new ValidationError(problem);
  await tx.manualCalibration.create({
    data: { sizingCheckId: check.id, date, fromSize, toSize: input.toSize!, kg: input.kg!.trim(), createdById: actorId },
  });
  return checkAt(tx, site, check.id);
}

// ── Read ────────────────────────────────────────────────────────────────────────────────────────

/** Every sizing check at the site, oldest first, as the screens read them (the workbook export uses this too). */
export async function listSizingChecks(site: string): Promise<SizingCheck[]> {
  const rows = await prisma.sizingCheck.findMany({ where: { batch: { warehouse: site } }, include: CHECK_INCLUDE, orderBy: { id: "asc" } });
  return rows.map(checkView);
}

export async function batchCalibration(site: string, runRef: string): Promise<BatchCalibration | null> {
  const batch = await prisma.productionBatch.findFirst({ where: runWhere(site, runRef), select: { code: true } });
  if (!batch) return null;
  const batchCode = batch.code;
  const [{ loads, moves, cooks }, siteChecks] = await Promise.all([siloMovements(prisma, site, batchCode), listSizingChecks(site)]);
  const standing = siloChecks(siteChecks.map((c) => ({ ...c, moves: c.manualCalibrations.length })));
  const stillDeciding = new Set(Object.values(standing).filter((c) => c.state === "failed" || c.state === "re_sized").map((c) => c.checkId));
  return {
    silos: siloPool(loads, cooks),
    siloChecks: standing,
    sizingChecks: siteChecks.filter((c) => c.batchCode === batchCode || stillDeciding.has(c.id)).reverse(),
    daily: siloDailyStock(loads, moves, cooks),
  };
}
