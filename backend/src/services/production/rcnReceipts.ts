/**
 * Production Phase 1, steps 1–2: RCN Receipts — a load arriving on the production floor from one bin of a
 * batch, with its BTM slip — and each load's moisture check. Weighing (steps 3–4) is rcnWeighing.ts. Then production's
 * acceptance (acceptRcnReceipt): the warehouse's side of the load ends there.
 */
import type { Prisma } from "@prisma/client";
import { canRecordIntake, type Role } from "@anagroci/contract/data/roles";
import { isIsoDate } from "@anagroci/contract/domain/dateFormat";
import {
  CUT_TEST_GRAMS, acceptanceProblem, canTakeMoistureCheck, cropYearError, moistureCheckError, moistureKor, rcnReceiptStatus,
  type CutTestGram, type MoistureCheckStatus, type MoistureDecision,
} from "@anagroci/contract/domain/rcnReceipt";
import type { MoistureCheck, MoistureCheckInput, RcnAcceptance, RcnFinalWeight, RcnReceipt, RcnReceiptInput } from "@anagroci/contract/types/rcnReceipt";
import { SILO_SIZE_KEYS, type SizeValues } from "@anagroci/contract/domain/calibration";
import { prisma } from "../../db.js";
import { ValidationError } from "../../domain/validation.js";
import { nextRcnReceiptId } from "../ids.js";
import { runLabel, runWhere } from "./batches.js";

const INCLUDE = {
  createdBy: { select: { displayName: true } },
  moistureChecks: {
    include: { submittedBy: { select: { displayName: true } }, reviewedBy: { select: { displayName: true } } },
    orderBy: { id: "asc" },
  },
  pallets: { include: { weighedBy: { select: { displayName: true } } }, orderBy: { id: "asc" } },
  emptyPallets: { orderBy: { id: "asc" } },
  finalisedBy: { select: { displayName: true } },
  acceptedBy: { select: { displayName: true } },
} satisfies Prisma.RcnReceiptInclude;

export type Row = Prisma.RcnReceiptGetPayload<{ include: typeof INCLUDE }>;
type CheckRow = Row["moistureChecks"][number];

export type Actor = { id: string; role: Role };

function checkView(c: CheckRow): MoistureCheck {
  const grams: Partial<Record<CutTestGram, string>> = {};
  for (const [key] of CUT_TEST_GRAMS) if (c[key] !== null) grams[key] = c[key];
  return {
    id: c.id,
    moisture: c.moisture,
    nutCount: c.nutCount,
    sampleG: c.sampleG ?? "",
    grams,
    kor: moistureKor(grams),
    decision: c.decision as MoistureDecision,
    status: c.status as MoistureCheckStatus,
    submittedBy: c.submittedBy.displayName,
    submittedAt: c.submittedAt.toISOString(),
    reviewedBy: c.reviewedBy?.displayName ?? null,
    reviewedAt: c.reviewedAt?.toISOString() ?? null,
    rejectReason: c.rejectReason,
  };
}

function finalWeightView(r: Row): RcnFinalWeight | null {
  if (!r.finalisedAt) return null;
  return {
    emptyPallets: r.emptyPallets.map((s) => ({ weightKg: s.weightKg, count: s.count ?? "" })),
    dustKg: r.dustKg ?? "",
    voidsKg: r.voidsKg ?? "",
    finalisedBy: r.finalisedBy?.displayName ?? null,
    finalisedAt: r.finalisedAt.toISOString(),
  };
}

function acceptanceView(r: Row): RcnAcceptance | null {
  return r.acceptedAt ? { acceptedBy: r.acceptedBy?.displayName ?? null, acceptedAt: r.acceptedAt.toISOString() } : null;
}

/** A cooking row's kg per size, as typed; a blank size is left out. Shared with the silo stock (services/production/calibration.ts). */
export function runSizes(run: Record<`kg${SiloSizeKey}`, string | null>): SizeValues {
  const sizes: SizeValues = {};
  for (const k of SILO_SIZE_KEYS) if (run[`kg${k}`] !== null) sizes[k] = run[`kg${k}`]!;
  return sizes;
}
type SiloSizeKey = (typeof SILO_SIZE_KEYS)[number];

export function toView(r: Row): RcnReceipt {
  const moistureChecks = r.moistureChecks.map(checkView);
  return {
    id: r.id,
    batchCode: r.batchCode,
    date: r.date,
    cropYear: r.cropYear,
    btmNo: r.btmNo,
    binCode: r.binCode,
    status: rcnReceiptStatus(moistureChecks, { pallets: r.pallets.length, finalised: r.finalisedAt !== null, accepted: r.acceptedAt !== null }),
    moistureChecks,
    pallets: r.pallets.map((p, i) => ({
      id: p.id,
      no: i + 1,
      grossKg: p.grossKg,
      bags: p.bags,
      factoryBin: p.factoryBin,
      weighedBy: p.weighedBy.displayName,
      weighedAt: p.weighedAt.toISOString(),
    })),
    finalWeight: finalWeightView(r),
    acceptance: acceptanceView(r),
    createdBy: r.createdBy.displayName,
    createdAt: r.createdAt.toISOString(),
  };
}

/** The site's receipts, newest first; only one batch's when `batchCode` is given. */
export async function listRcnReceipts(site: string, batchCode?: string): Promise<RcnReceipt[]> {
  const rows = await prisma.rcnReceipt.findMany({
    where: { batch: batchCode ? runWhere(site, batchCode) : { warehouse: site } },
    include: INCLUDE,
    orderBy: [{ date: "desc" }, { id: "desc" }],
  });
  return rows.map(toView);
}

/**
 * "1 load = 1 receipt; 1 receipt = 1 bin; only bins of the chosen batch" (Phase 1 doc). The same BTM from
 * the same bin again is allowed: the doc makes it a warning, shown by the screen before saving.
 */
export async function createRcnReceipt(site: string, actorId: string, input: RcnReceiptInput): Promise<RcnReceipt> {
  const row = await prisma.$transaction((tx) => createRcnReceiptIn(tx, site, actorId, input));
  return toView(row);
}

/** createRcnReceipt's rules inside the caller's transaction (the production workbook upload shares one). */
export async function createRcnReceiptIn(tx: Prisma.TransactionClient, site: string, actorId: string, input: RcnReceiptInput): Promise<Row> {
  const date = (input.date ?? "").trim();
  if (!isIsoDate(date)) throw new ValidationError("A date is required.");
  const btmNo = (input.btmNo ?? "").trim();
  if (!btmNo) throw new ValidationError("Enter the BTM number from the slip.");
  const binCode = (input.binCode ?? "").trim().toUpperCase();
  if (!binCode) throw new ValidationError("Choose the warehouse bin the load came from.");
  const yearProblem = cropYearError(input.cropYear);
  if (yearProblem) throw new ValidationError(yearProblem);
  const cropYear = (input.cropYear ?? "").trim() || null;
  // The client's sheets never name a run, only the bin. A bin is in one run at a time (createBatchIn refuses a second),
  // so the bin alone finds it: the production workbook leaves the run out, the screen still names it.
  const runRef = (input.batchCode ?? "").trim().toUpperCase() || (await runOfBin(tx, site, binCode));

  {
    const batch = await tx.productionBatch.findFirst({ where: runWhere(site, runRef), select: { code: true, name: true, bins: { select: { binCode: true } } } });
    if (!batch) throw new ValidationError(`Production run ${runRef} doesn't exist at ${site}.`);
    const batchCode = batch.code;
    if (!batch.bins.some((b) => b.binCode === binCode)) throw new ValidationError(`${binCode} is not in production run ${runLabel(batch.code, batch.name)}.`);

    return tx.rcnReceipt.create({
      data: { id: await nextRcnReceiptId(tx, site, date), batchCode, binCode, date, cropYear, btmNo, createdById: actorId },
      include: INCLUDE,
    });
  }
}

async function runOfBin(tx: Prisma.TransactionClient, site: string, binCode: string): Promise<string> {
  const inRun = await tx.productionBatchBin.findFirst({ where: { binCode, batch: { warehouse: site } }, select: { batchCode: true } });
  if (!inRun) throw new ValidationError(`${binCode} isn't in any production run at ${site}. Start a production run with it first.`);
  return inRun.batchCode;
}

/** The load's crop year, given or corrected after the load was recorded (a load made from the tally sheet has none). */
export async function setRcnCropYear(site: string, id: string, cropYear: string | undefined): Promise<RcnReceipt> {
  return toView(await prisma.$transaction((tx) => setRcnCropYearIn(tx, site, id, cropYear)));
}

export async function setRcnCropYearIn(tx: Prisma.TransactionClient, site: string, id: string, cropYear: string | undefined): Promise<Row> {
  const problem = cropYearError(cropYear);
  if (problem) throw new ValidationError(problem);
  await receiptAt(tx, site, id);
  await tx.rcnReceipt.update({ where: { id }, data: { cropYear: (cropYear ?? "").trim() || null } });
  return receiptAt(tx, site, id);
}

export async function receiptAt(tx: Prisma.TransactionClient, site: string, id: string): Promise<Row> {
  const row = await tx.rcnReceipt.findFirst({ where: { id, batch: { warehouse: site } }, include: INCLUDE });
  if (!row) throw new ValidationError(`RCN Receipt ${id} doesn't exist at ${site}.`);
  return row;
}

export const blankToNull = (v: string | undefined) => ((v ?? "").trim() === "" ? null : v!.trim());

/**
 * Once production accepts a load, its quantity and quality are what left the warehouse bin and went into the silos: a
 * later change would move both behind production's back. Only Admin, who settles a disagreement, changes it after that.
 */
export function assertNotAccepted(row: Pick<Row, "id" | "acceptedAt">, actor: Actor): void {
  if (row.acceptedAt && actor.role !== "admin") {
    throw new ValidationError(`Production has accepted ${row.id}: its weighing and quality can't change now. Ask an Admin to correct it.`);
  }
}

/**
 * Production accepts the warehouse's load (Lokesh, 16 Nov 2026: "Then operations will accept, then those details should
 * come automatic"). Nothing is copied: the warehouse bin's stock and the silos are worked out from acceptedAt.
 */
export async function acceptRcnReceipt(site: string, actor: Actor, receiptId: string): Promise<RcnReceipt> {
  return toView(await prisma.$transaction((tx) => acceptRcnReceiptIn(tx, site, actor, receiptId)));
}

export async function acceptRcnReceiptIn(tx: Prisma.TransactionClient, site: string, actor: Actor, receiptId: string): Promise<Row> {
  const receipt = await receiptAt(tx, site, receiptId);
  const problem = acceptanceProblem(toView(receipt).status);
  if (problem) throw new ValidationError(`${receipt.id} can't be accepted yet. ${problem}`);
  await tx.rcnReceipt.update({ where: { id: receipt.id }, data: { acceptedById: actor.id, acceptedAt: new Date() } });
  return receiptAt(tx, site, receipt.id);
}

/**
 * Step 2. A QFS Officer's check waits for the Incharge ("Saved as PENDING — receipt does NOT change yet");
 * an Incharge's or Admin's applies at once ("Incharge and Admin entries apply immediately — no approval").
 */
export async function submitMoistureCheck(site: string, actor: Actor, receiptId: string, input: MoistureCheckInput): Promise<RcnReceipt> {
  const row = await prisma.$transaction((tx) => submitMoistureCheckIn(tx, site, actor, receiptId, input));
  return toView(row);
}

/** submitMoistureCheck's rules inside the caller's transaction (the production workbook upload shares one). */
export async function submitMoistureCheckIn(
  tx: Prisma.TransactionClient, site: string, actor: Actor, receiptId: string, input: MoistureCheckInput,
  /** approved: saved as approved whoever saves it (a production workbook upload, which needs no approval). */
  opts: { approved?: boolean } = {},
): Promise<Row> {
  const values = { ...input, sampleG: blankToNull(input.sampleG) ?? undefined };
  const problem = moistureCheckError(values);
  if (problem) throw new ValidationError(problem);

  {
    const receipt = await receiptAt(tx, site, receiptId);
    assertNotAccepted(receipt, actor);
    const status = toView(receipt).status;
    // Any step, any order; only a check already waiting for the Incharge holds a new one back.
    if (!canTakeMoistureCheck(status)) throw new ValidationError(`${receipt.id} already has a moisture check waiting for approval.`);

    // The load's quality is the warehouse's to give (Option 1): its Incharge's own check counts at once.
    const direct = opts.approved || canRecordIntake(actor.role);
    const grams = Object.fromEntries(CUT_TEST_GRAMS.map(([key]) => [key, blankToNull(input[key])]));
    await tx.rcnMoistureCheck.create({
      data: {
        rcnReceiptId: receipt.id,
        moisture: input.moisture!.trim(),
        nutCount: input.nutCount!.trim(),
        sampleG: Object.values(grams).some((g) => g !== null) ? blankToNull(input.sampleG) : null,
        ...grams,
        decision: input.decision!,
        status: direct ? "approved" : "submitted",
        submittedById: actor.id,
        ...(direct ? { reviewedById: actor.id, reviewedAt: new Date() } : {}),
      },
    });
    return receiptAt(tx, site, receipt.id);
  }
}

/** The Incharge's answer to a submitted check. A reject needs a reason and applies nothing. */
export async function reviewMoistureCheck(site: string, actorId: string, checkId: number, approve: boolean, reason?: string): Promise<RcnReceipt> {
  const rejectReason = (reason ?? "").trim();
  if (!approve && !rejectReason) throw new ValidationError("Give a reason for rejecting the check.");

  const row = await prisma.$transaction(async (tx) => {
    const check = await tx.rcnMoistureCheck.findFirst({ where: { id: checkId, rcnReceipt: { batch: { warehouse: site } } } });
    if (!check) throw new ValidationError(`Moisture check ${checkId} doesn't exist at ${site}.`);
    if (check.status !== "submitted") throw new ValidationError(`This check was already ${check.status}.`);
    await tx.rcnMoistureCheck.update({
      where: { id: check.id },
      data: { status: approve ? "approved" : "rejected", reviewedById: actorId, reviewedAt: new Date(), rejectReason: approve ? null : rejectReason },
    });
    return receiptAt(tx, site, check.rcnReceiptId);
  });
  return toView(row);
}
