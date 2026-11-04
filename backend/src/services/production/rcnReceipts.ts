/**
 * Production Phase 1, steps 1–2: RCN Receipts — a load arriving on the production floor from one bin of a
 * batch, with its BTM slip — and each load's moisture check. Weighing (steps 3–4) is rcnWeighing.ts.
 */
import type { Prisma } from "@prisma/client";
import { canWriteStageDirectly, type Role } from "@anagroci/contract/data/roles";
import { isIsoDate } from "@anagroci/contract/domain/dateFormat";
import {
  CUT_TEST_GRAMS, RCN_RECEIPT_STATUS_LABELS, canTakeMoistureCheck, moistureCheckError, moistureKor, rcnReceiptStatus,
  type CutTestGram, type MoistureCheckStatus, type MoistureDecision,
} from "@anagroci/contract/domain/rcnReceipt";
import type { MoistureCheck, MoistureCheckInput, RcnFinalWeight, RcnReceipt, RcnReceiptInput } from "@anagroci/contract/types/rcnReceipt";
import { prisma } from "../../db.js";
import { ValidationError } from "../../domain/validation.js";
import { nextRcnReceiptId } from "../ids.js";

const INCLUDE = {
  createdBy: { select: { displayName: true } },
  moistureChecks: {
    include: { submittedBy: { select: { displayName: true } }, reviewedBy: { select: { displayName: true } } },
    orderBy: { id: "asc" },
  },
  pallets: { include: { weighedBy: { select: { displayName: true } } }, orderBy: { id: "asc" } },
  emptyPallets: { orderBy: { id: "asc" } },
  finalisedBy: { select: { displayName: true } },
} satisfies Prisma.RcnReceiptInclude;

type Row = Prisma.RcnReceiptGetPayload<{ include: typeof INCLUDE }>;
type CheckRow = Row["moistureChecks"][number];

type Actor = { id: string; role: Role };

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

export function toView(r: Row): RcnReceipt {
  const moistureChecks = r.moistureChecks.map(checkView);
  return {
    id: r.id,
    batchCode: r.batchCode,
    date: r.date,
    btmNo: r.btmNo,
    binCode: r.binCode,
    status: rcnReceiptStatus(moistureChecks, { pallets: r.pallets.length, finalised: r.finalisedAt !== null }),
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
    createdBy: r.createdBy.displayName,
    createdAt: r.createdAt.toISOString(),
  };
}

/** The site's receipts, newest first; only one batch's when `batchCode` is given. */
export async function listRcnReceipts(site: string, batchCode?: string): Promise<RcnReceipt[]> {
  const rows = await prisma.rcnReceipt.findMany({
    where: { batch: { warehouse: site }, ...(batchCode ? { batchCode } : {}) },
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
  const batchCode = (input.batchCode ?? "").trim().toUpperCase();
  if (!batchCode) throw new ValidationError("Choose the batch the load is for.");
  const date = (input.date ?? "").trim();
  if (!isIsoDate(date)) throw new ValidationError("A date is required.");
  const btmNo = (input.btmNo ?? "").trim();
  if (!btmNo) throw new ValidationError("Enter the BTM number from the slip.");
  const binCode = (input.binCode ?? "").trim().toUpperCase();
  if (!binCode) throw new ValidationError("Choose the warehouse bin the load came from.");

  const row = await prisma.$transaction(async (tx) => {
    const batch = await tx.productionBatch.findFirst({ where: { code: batchCode, warehouse: site }, select: { bins: { select: { binCode: true } } } });
    if (!batch) throw new ValidationError(`Batch ${batchCode} doesn't exist at ${site}.`);
    if (!batch.bins.some((b) => b.binCode === binCode)) throw new ValidationError(`${binCode} is not in batch ${batchCode}.`);

    return tx.rcnReceipt.create({
      data: { id: await nextRcnReceiptId(tx, site, date), batchCode, binCode, date, btmNo, createdById: actorId },
      include: INCLUDE,
    });
  });
  return toView(row);
}

export async function receiptAt(tx: Prisma.TransactionClient, site: string, id: string): Promise<Row> {
  const row = await tx.rcnReceipt.findFirst({ where: { id, batch: { warehouse: site } }, include: INCLUDE });
  if (!row) throw new ValidationError(`RCN Receipt ${id} doesn't exist at ${site}.`);
  return row;
}

export const blankToNull = (v: string | undefined) => ((v ?? "").trim() === "" ? null : v!.trim());

/**
 * Step 2. A QFS Officer's check waits for the Incharge ("Saved as PENDING — receipt does NOT change yet");
 * an Incharge's or Admin's applies at once ("Incharge and Admin entries apply immediately — no approval").
 */
export async function submitMoistureCheck(site: string, actor: Actor, receiptId: string, input: MoistureCheckInput): Promise<RcnReceipt> {
  const values = { ...input, sampleG: blankToNull(input.sampleG) ?? undefined };
  const problem = moistureCheckError(values);
  if (problem) throw new ValidationError(problem);

  const row = await prisma.$transaction(async (tx) => {
    const receipt = await receiptAt(tx, site, receiptId);
    const status = toView(receipt).status;
    if (!canTakeMoistureCheck(status)) throw new ValidationError(`${receipt.id} is ${RCN_RECEIPT_STATUS_LABELS[status]}; no moisture check is due.`);

    const direct = canWriteStageDirectly(actor.role);
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
  });
  return toView(row);
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
