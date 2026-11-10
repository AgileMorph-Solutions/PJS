/**
 * Production Phase 2: Calibration. A load whose Intake is done is sized into the 9 silos run by run; the QFS
 * Officer samples the silos (QC-2), which the Incharge approves like a moisture check; a failed silo is re-sized
 * by hand, moving kg to another silo. Rules are in contract domain/calibration.ts; silo stock is calculated from
 * these rows, never stored.
 *
 * Each write has an `…In` form that runs in the caller's transaction, like rcnReceipts.ts, so a later workbook
 * upload can share it.
 */
import type { Prisma } from "@prisma/client";
import { canWriteStageDirectly } from "@anagroci/contract/data/roles";
import { isIsoDate } from "@anagroci/contract/domain/dateFormat";
import {
  SILO_SIZE_KEYS, SIZING_GRADES, correctSizePct, manualCalibrationError, siloChecks, siloDailyStock, siloLabel, siloStock, sizingCheckError, sizingCheckNotes,
  calibrationRunError, isSiloSize, type SamplingPoint, type SiloSize, type SizingDecision, type SizingGrams, type SizeValues,
} from "@anagroci/contract/domain/calibration";
import type { MoistureCheckStatus } from "@anagroci/contract/domain/rcnReceipt";
import type {
  BatchCalibration, CalibrationRunInput, ManualCalibration, ManualCalibrationInput, SizingCheck, SizingCheckInput,
} from "@anagroci/contract/types/calibration";
import type { RcnReceipt } from "@anagroci/contract/types/rcnReceipt";
import { prisma } from "../../db.js";
import { runLabel, runWhere } from "./batches.js";
import { ValidationError } from "../../domain/validation.js";
import { blankToNull, receiptAt, runSizes, toView, type Actor } from "./rcnReceipts.js";

type Tx = Prisma.TransactionClient;

const kgColumns = (sizes: SizeValues | undefined) =>
  Object.fromEntries(SILO_SIZE_KEYS.map((k) => [`kg${k}`, blankToNull(sizes?.[k])])) as Record<`kg${SiloSize}`, string | null>;

const gramColumns = (grams: SizingGrams | undefined) =>
  Object.fromEntries(SIZING_GRADES.map((g) => [g === "under" ? "gUnder" : `g${g}`, blankToNull(grams?.[g])]));

// ── Silo stock ──────────────────────────────────────────────────────────────────────────────────

/** Every run and manual move at the site: the silos are the factory's, shared by all its batches. */
async function siloMovements(tx: Tx | typeof prisma, site: string) {
  const [runs, moves, cooks] = await Promise.all([
    tx.rcnCalibrationRun.findMany({ where: { rcnReceipt: { batch: { warehouse: site } } }, include: { rcnReceipt: { select: { batchCode: true } } } }),
    tx.manualCalibration.findMany({ where: { sizingCheck: { batch: { warehouse: site } } } }),
    tx.lotCookRun.findMany({ where: { lot: { batch: { warehouse: site } } } }),
  ]);
  return { runs: runs.map((r) => ({ batchCode: r.rcnReceipt.batchCode, date: r.date, sizes: runSizes(r) })), moves, cooks: cooks.map((c) => ({ date: c.date, sizes: runSizes(c) })) };
}

async function stockOf(tx: Tx, site: string, size: SiloSize): Promise<number> {
  const { runs, moves, cooks } = await siloMovements(tx, site);
  return siloStock(runs, moves, cooks).find((s) => s.size === size)!.stockKg;
}

/** Each silo's kg now: what Phase 3 may cook from. */
export async function siloStockBySize(tx: Tx, site: string): Promise<Record<SiloSize, number>> {
  const { runs, moves, cooks } = await siloMovements(tx, site);
  return Object.fromEntries(siloStock(runs, moves, cooks).map((s) => [s.size, s.stockKg])) as Record<SiloSize, number>;
}

// ── Step 2 · Kg into each silo ──────────────────────────────────────────────────────────────────

export async function addCalibrationRun(site: string, actorId: string, receiptId: string, input: CalibrationRunInput): Promise<RcnReceipt> {
  return toView(await prisma.$transaction((tx) => addCalibrationRunIn(tx, site, actorId, receiptId, input)));
}

/**
 * Any load, at any step (team decision, Nov 2026): a load can be sorted before its final weight is saved. Once the
 * final weight says how much the load hands over, never more than is left of it. No approval, like weighing.
 */
export async function addCalibrationRunIn(tx: Tx, site: string, actorId: string, receiptId: string, input: CalibrationRunInput) {
  const date = (input.date ?? "").trim();
  if (date && !isIsoDate(date)) throw new ValidationError("A date is required.");
  const receipt = await receiptAt(tx, site, receiptId);
  const view = toView(receipt);
  const problem = calibrationRunError({ date, sizes: input.sizes }, view.calibration?.leftKg ?? null);
  if (problem) throw new ValidationError(problem);
  await tx.rcnCalibrationRun.create({ data: { rcnReceiptId: receipt.id, date, ...kgColumns(input.sizes), createdById: actorId } });
  return receiptAt(tx, site, receipt.id);
}

/**
 * A wrong run is removed and typed again. Refused when nuts have since been moved out of one of its silos by hand
 * and removing it would leave that silo below zero.
 */
export async function deleteCalibrationRun(site: string, runId: number): Promise<RcnReceipt> {
  const row = await prisma.$transaction(async (tx) => {
    const run = await tx.rcnCalibrationRun.findFirst({ where: { id: runId, rcnReceipt: { batch: { warehouse: site } } } });
    if (!run) throw new ValidationError(`Calibration run ${runId} doesn't exist at ${site}.`);
    await tx.rcnCalibrationRun.delete({ where: { id: run.id } });
    const { runs, moves, cooks } = await siloMovements(tx, site);
    const short = siloStock(runs, moves, cooks).find((s) => s.stockKg < 0);
    if (short) throw new ValidationError(`Removing this run would leave silo ${siloLabel(short.size)} at ${short.stockKg.toLocaleString("en-US")} kg: nuts were moved or cooked out of it since.`);
    return receiptAt(tx, site, run.rcnReceiptId);
  });
  return toView(row);
}

// ── Step 3 · QC-2 sizing check ──────────────────────────────────────────────────────────────────

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

/** A QFS Officer's check waits for the Incharge; an Incharge's or Admin's own is approved as it is saved. */
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

  const direct = canWriteStageDirectly(actor.role);
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

// ── Step 4 · Wholes manual calibration ──────────────────────────────────────────────────────────

export async function addManualCalibration(site: string, actorId: string, checkId: number, input: ManualCalibrationInput): Promise<SizingCheck> {
  return checkView(await prisma.$transaction((tx) => addManualCalibrationIn(tx, site, actorId, checkId, input)));
}

/**
 * "Only after a failed QC-2; kg moves between silos." The nuts leave the silo the failed sample was taken from,
 * and can't take it below zero.
 */
export async function addManualCalibrationIn(tx: Tx, site: string, actorId: string, checkId: number, input: ManualCalibrationInput): Promise<CheckRow> {
  const check = await checkAt(tx, site, checkId);
  if (check.decision !== "fail" || check.status !== "approved") throw new ValidationError("Nuts are re-sized by hand only after a failed, approved sizing check.");
  if (!isSiloSize(check.point)) throw new ValidationError("This sample was taken before calibration; there is no silo to re-size.");
  const date = (input.date ?? "").trim();
  if (date && !isIsoDate(date)) throw new ValidationError("A date is required.");
  const fromSize = input.fromSize ?? check.point;
  if (fromSize !== check.point) throw new ValidationError(`The sample was from silo ${siloLabel(check.point)}; the nuts are re-sized out of that silo.`);

  const problem = manualCalibrationError({ ...input, date, fromSize }, await stockOf(tx, site, check.point));
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
  const [{ runs, moves, cooks }, siteChecks] = await Promise.all([siloMovements(prisma, site), listSizingChecks(site)]);
  const own = siloStock(runs.filter((r) => r.batchCode === batchCode), []);
  const standing = siloChecks(siteChecks.map((c) => ({ ...c, moves: c.manualCalibrations.length })));
  const stillDeciding = new Set(Object.values(standing).filter((c) => c.state === "failed" || c.state === "re_sized").map((c) => c.checkId));
  return {
    silos: siloStock(runs, moves, cooks),
    batchSizedKg: Object.fromEntries(own.map((s) => [s.size, s.sizedInKg])) as Record<SiloSize, number>,
    siloChecks: standing,
    sizingChecks: siteChecks.filter((c) => c.batchCode === batchCode || stillDeciding.has(c.id)).reverse(),
    daily: siloDailyStock(runs, moves, cooks),
  };
}
