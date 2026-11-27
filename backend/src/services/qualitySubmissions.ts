/**
 * The QFS Officer's quality checks on warehouse records that had no approval step of their own (26 Nov 2026, user): a drying
 * round's quality going onto the yard and its check after, a transfer lot's quality. The kinds and
 * their rules are the contract's (domain/qualityChecks.ts).
 *
 * Like a reception form (services/submissions.ts): a submission is only the readings, it changes nothing until the Warehouse
 * Incharge approves, and then the readings go through the same service the Incharge's own entry uses (checkDryingIn,
 * setDryingInputQuality, setTransferLotQuality) in ONE transaction with the status change, so a
 * half-applied check is impossible. A rejection is final and needs a reason. A form only fills what is still empty.
 */
import { Prisma } from "@prisma/client";
import {
  QUALITY_SUBMISSION_INFO, QUALITY_SUBMISSION_KEYS, isQualitySubmissionKind, qualitySubmissionProblem,
  type QualitySubmissionKind, type QualitySubmissionStatus, type QualitySubmissionView,
} from "@anagroci/contract/domain/qualityChecks";
import { dryingPhase } from "@anagroci/contract/domain/sunDrying";
import { requestIdOfTarget, scopeKey } from "@anagroci/contract/domain/qualityRequests";
import { classifyActivity } from "@anagroci/contract/data/warehouseActivities";
import { prisma } from "../db.js";
import { ValidationError } from "../domain/validation.js";
import { checkDryingIn, dryingRoundName, setDryingInputQuality } from "./dryingBatches.js";
import { setTransferLotQuality } from "./transferLots.js";
import { siteOf } from "./ids.js";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;
type Person = { id: string; displayName?: string | null };

/** The record a check is about: its site (for who may see and approve it), and the name the screens give it. */
export interface QualityTarget { warehouse: string; reference: string }

/**
 * The record of a check, and why it can't take one now (undefined when it can). The same answer at submission and at
 * approval, so a record that moved on in between (the Incharge checked the round himself) refuses the approval plainly.
 */
async function targetState(db: Db, kind: QualitySubmissionKind, targetId: string): Promise<QualityTarget & { blocked?: string }> {
  switch (kind) {
    case "drying_before":
    case "drying_after": {
      // Before drying, from the Incharge's open form: the round doesn't exist yet, the check is the request's.
      const requestId = kind === "drying_before" ? requestIdOfTarget(targetId) : null;
      if (requestId !== null) {
        const r = await db.qualityRequest.findUnique({ where: { id: requestId }, select: { warehouse: true, reference: true, status: true } });
        if (!r) throw new ValidationError("That drying form doesn't exist.");
        if (r.status === "answered") return { warehouse: r.warehouse, reference: r.reference, blocked: `The quality going onto the yard for ${r.reference} is already approved.` };
        if (r.status !== "open") return { warehouse: r.warehouse, reference: r.reference, blocked: `The drying form for ${r.reference} is no longer open.` };
        return { warehouse: r.warehouse, reference: r.reference };
      }
      const b = await db.dryingBatch.findUnique({ where: { id: targetId } });
      if (!b) throw new ValidationError("That drying round doesn't exist.");
      const warehouse = b.warehouseSite ?? b.warehouse ?? "";
      const reference = dryingRoundName(b);
      if (b.source !== "entered") return { warehouse, reference, blocked: "This drying row comes from a workbook; it can't be checked in the app." };
      const phase = dryingPhase(b.status);
      if (kind === "drying_before") {
        if (b.inputMoisturePct !== null) return { warehouse, reference, blocked: `${reference} already has its quality going onto the yard.` };
        if (phase !== "in_drying" && phase !== "quality_check") return { warehouse, reference, blocked: `${reference} is finished.` };
        return { warehouse, reference };
      }
      if (phase === "in_drying") return { warehouse, reference, blocked: `${reference} hasn't come back from the yard yet: the Warehouse Incharge records what came back first.` };
      if (phase !== "quality_check") return { warehouse, reference, blocked: `${reference} was already checked.` };
      return { warehouse, reference };
    }
    case "transfer_lot": {
      const id = Number(targetId);
      const lot = Number.isInteger(id) ? await db.transferLot.findUnique({ where: { id }, select: { lotNo: true, warehouse: true, grossWeightKg: true, moisture: true } }) : null;
      if (!lot) throw new ValidationError("That transfer lot doesn't exist.");
      const reference = `Transfer lot ${lot.lotNo}`;
      if (lot.moisture !== null) return { warehouse: lot.warehouse, reference, blocked: `${reference} already has its quality.` };
      return { warehouse: lot.warehouse, reference };
    }
  }
}

/** Where a check would be taken, for the route's warehouse check before anything is read or written. */
export async function qualityTarget(kind: unknown, targetId: unknown): Promise<QualityTarget> {
  if (!isQualitySubmissionKind(kind)) throw new ValidationError("Choose which quality check this is.");
  if (typeof targetId !== "string" || !targetId.trim()) throw new ValidationError("Say which record the check is for.");
  const { warehouse, reference } = await targetState(prisma, kind, targetId.trim());
  return { warehouse, reference };
}

/** Only the check's own keys, trimmed, blanks left out. Refuses what the contract's qualitySubmissionProblem refuses. */
export function cleanQualityValues(kind: QualitySubmissionKind, raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") throw new ValidationError("values is required.");
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const s = String(v ?? "").trim();
    if (s) out[k] = s;
  }
  const problem = qualitySubmissionProblem(kind, out);
  if (problem) throw new ValidationError(problem);
  return Object.fromEntries(Object.entries(out).filter(([k]) => QUALITY_SUBMISSION_KEYS[kind].includes(k)));
}

export async function submitQualityCheck(user: Person, kind: unknown, targetId: unknown, raw: unknown): Promise<QualitySubmissionView> {
  if (!isQualitySubmissionKind(kind)) throw new ValidationError("Choose which quality check this is.");
  const id = String(targetId ?? "").trim();
  const values = cleanQualityValues(kind, raw);
  const row = await prisma.$transaction(async (tx) => {
    const target = await targetState(tx, kind, id);
    if (target.blocked) throw new ValidationError(target.blocked);
    // One waiting at a time: the Incharge decides it first, as with a reception form (contract submitAgainBlocker).
    const waiting = await tx.qualitySubmission.findFirst({ where: { kind, targetId: id, status: "submitted" }, select: { id: true } });
    if (waiting) throw new ValidationError(`This check of ${target.reference} is already waiting for the Warehouse Incharge's approval.`);
    return tx.qualitySubmission.create({ data: { kind, targetId: id, warehouse: target.warehouse, values, submittedById: user.id }, include: INCLUDE });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return toView(row, (await qualityTarget(kind, id)).reference);
}

const INCLUDE = { submittedBy: { select: { displayName: true } }, reviewedBy: { select: { displayName: true } } } as const;
type Row = Prisma.QualitySubmissionGetPayload<{ include: typeof INCLUDE }>;

function toView(r: Row, reference: string): QualitySubmissionView {
  const kind = r.kind as QualitySubmissionKind;
  return {
    id: r.id, kind, section: QUALITY_SUBMISSION_INFO[kind].section, reference, targetId: r.targetId, warehouse: r.warehouse,
    values: (r.values ?? {}) as Record<string, string>, status: r.status as QualitySubmissionStatus,
    submittedBy: r.submittedBy.displayName, submittedAt: r.createdAt.toISOString(),
    reviewedBy: r.reviewedBy?.displayName ?? null, reviewedAt: r.reviewedAt?.toISOString() ?? null, rejectReason: r.rejectReason,
  };
}

/** The name of each row's record, read once per row; a record deleted since is named by its kind and id. */
async function withReferences(rows: Row[]): Promise<QualitySubmissionView[]> {
  return Promise.all(rows.map(async (r) => {
    const reference = await qualityTarget(r.kind, r.targetId).then((t) => t.reference, () => `${QUALITY_SUBMISSION_INFO[r.kind as QualitySubmissionKind]?.title ?? r.kind} #${r.targetId}`);
    return toView(r, reference);
  }));
}

export interface QualitySubmissionFilter { site?: string[]; status?: string; submittedById?: string }

/** Newest first. */
export async function listQualitySubmissions(f: QualitySubmissionFilter): Promise<QualitySubmissionView[]> {
  const rows = await prisma.qualitySubmission.findMany({
    where: { status: f.status, submittedById: f.submittedById, warehouse: f.site ? { in: f.site } : undefined },
    include: INCLUDE, orderBy: { createdAt: "desc" },
  });
  return withReferences(rows);
}

/** The site of a submission, for the route's access check before a decision. */
export async function qualitySubmissionWarehouse(id: number): Promise<string> {
  const row = await prisma.qualitySubmission.findUnique({ where: { id }, select: { warehouse: true } });
  if (!row) throw Object.assign(new Error("Quality check not found"), { code: "P2025" });
  return row.warehouse;
}

/** What the Incharge adds when approving: the new Bin a passed drying goes into, when the QFS Officer didn't name it. */
export interface ApproveQualityInput { destinationBin?: string }

/** Applies the readings through the record's own service, as the reviewer, naming who took them. */
async function applyCheck(tx: Tx, row: { kind: string; targetId: string; values: Prisma.JsonValue; submittedById: string }, reviewer: Person, submitter: string, extra: ApproveQualityInput) {
  const values = (row.values ?? {}) as Record<string, string>;
  const kind = row.kind as QualitySubmissionKind;
  // The round says who checked it: the QFS Officer who did, approved by the Incharge.
  const actor = { id: reviewer.id, displayName: `${submitter} (approved by ${reviewer.displayName ?? "the Warehouse Incharge"})` };
  switch (kind) {
    case "drying_before": {
      // Approved for an open form: the reading fills it (services/qualityRequests.ts), and is saved with the round.
      const requestId = requestIdOfTarget(row.targetId);
      if (requestId !== null) {
        await tx.qualityRequest.update({ where: { id: requestId }, data: { status: "answered", values, answeredById: row.submittedById, answeredAt: new Date() } });
        return;
      }
      await setDryingInputQuality(tx, row.targetId, values, actor);
      return;
    }
    case "drying_after": {
      const destinationBin = (extra.destinationBin ?? "").trim() || values.destinationBin;
      await checkDryingIn(tx, row.targetId, { ...values, decision: values.decision, ...(destinationBin ? { destinationBin } : {}) }, actor);
      // The round is checked: an Incharge's form still open for it is done (services/qualityRequests.ts settleAfterRequest).
      await tx.qualityRequest.updateMany({ where: { kind, scope: scopeKey({ kind: "round", roundId: row.targetId }), status: { in: ["open", "answered"] } }, data: { status: "used", roundId: row.targetId, closedAt: new Date() } });
      return;
    }
    case "transfer_lot":
      await setTransferLotQuality(tx, Number(row.targetId), values);
      return;
  }
}

async function loadOpen(tx: Tx, id: number) {
  const row = await tx.qualitySubmission.findUnique({ where: { id }, include: INCLUDE });
  if (!row) throw Object.assign(new Error("Quality check not found"), { code: "P2025" });
  if (row.status !== "submitted") throw new ValidationError(`This quality check was already ${row.status}.`);
  return row;
}

export async function approveQualityCheck(reviewer: Person, id: number, extra: ApproveQualityInput = {}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await loadOpen(tx, id);
    const target = await targetState(tx, row.kind as QualitySubmissionKind, row.targetId);
    if (target.blocked) throw new ValidationError(`${target.blocked} Reject this check with a reason instead.`);
    await applyCheck(tx, row, reviewer, row.submittedBy.displayName, extra);
    // Two reviewers at once: only a still-"submitted" row flips.
    const flipped = await tx.qualitySubmission.updateMany({ where: { id, status: "submitted" }, data: { status: "approved", reviewedById: reviewer.id, reviewedAt: new Date() } });
    if (flipped.count !== 1) throw new ValidationError("This quality check was already reviewed.");
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function rejectQualityCheck(reviewer: Person, id: number, reason: string | undefined): Promise<void> {
  if (!reason?.trim()) throw new ValidationError("A reason is required to reject a quality check.");
  await prisma.$transaction(async (tx) => {
    await loadOpen(tx, id);
    const flipped = await tx.qualitySubmission.updateMany({ where: { id, status: "submitted" }, data: { status: "rejected", reviewedById: reviewer.id, reviewedAt: new Date(), rejectReason: reason.trim() } });
    if (flipped.count !== 1) throw new ValidationError("This quality check was already reviewed.");
  });
}
