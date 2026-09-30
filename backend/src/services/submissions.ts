/**
 * Branch Manager / QFS Officer submit-for-approval flow.
 *
 * A submission is a staged copy of what the submitter typed. It touches nothing until the Warehouse
 * Incharge approves it, at which point the values go through the same stage-write code every other
 * edit uses (applyStageFields), in ONE transaction with the status change — so a half-applied
 * submission is impossible. Rejection is terminal: it closes the submission with a reason, and only
 * the Warehouse Incharge can change the data afterwards (direct edits, audited).
 */
import type { User } from "@prisma/client";
import { deriveStatus } from "@anagroci/contract/domain/receiptStatus";
import type { ReceiptRecord } from "@anagroci/contract/types/receipt";
import { formById, formForRole, type Role } from "@anagroci/contract/data/roles";
import { prisma } from "../db.js";
import { ForbiddenError, ValidationError } from "../domain/validation.js";
import { loadReceiptRow, applyStageFields, assertLotAvailable } from "./receipts.js";
import { toReceiptRecord } from "../serialize.js";
import { assignedSupplierCodes } from "../auth/receiptAccess.js";

export type SubmissionValues = Record<string, Record<string, string>>;

/** Only the form's own stages/labels, non-blank, trimmed — anything else is a client bug or an
 * attempt to write fields outside the role's form. */
function cleanValues(role: Role, raw: unknown) {
  const form = formForRole(role);
  if (!form) throw new ForbiddenError("Your role has no form to submit.");
  if (!raw || typeof raw !== "object") throw new ValidationError("values is required.");

  const out: SubmissionValues = {};
  for (const [stageId, fields] of Object.entries(raw as SubmissionValues)) {
    const stage = form.stages.find((s) => s.stageId === stageId);
    if (!stage) throw new ValidationError(`Stage "${stageId}" isn't part of the ${form.title} form.`);
    for (const [label, value] of Object.entries(fields ?? {})) {
      if (!stage.labels.includes(label)) throw new ValidationError(`"${label}" isn't part of the ${form.title} form.`);
      const v = String(value ?? "").trim();
      if (v) (out[stageId] ??= {})[label] = v;
    }
  }
  if (!Object.keys(out).length) throw new ValidationError("Fill in at least one field before submitting.");
  return { form, values: out };
}

export async function submitForm(user: User & { role: Role }, receiptId: string, raw: unknown) {
  const { form, values } = cleanValues(user.role, raw);

  const receipt = await prisma.receipt.findUnique({ where: { id: receiptId }, select: { id: true, warehouse: true, lbaCode: true } });
  if (!receipt) throw Object.assign(new Error("Receipt not found"), { code: "P2025" });

  if (user.role === "branch_manager") {
    // A Branch Manager reports for their own suppliers only. The LBA code is the supplier's key,
    // taken from this submission if it names one, otherwise from the receipt.
    const lba = values["n-verify"]?.["LBA CODE"] ?? receipt.lbaCode;
    if (!lba) throw new ValidationError("LBA CODE is required so the supplier can be checked against your assignments.");
    if (!(await assignedSupplierCodes(user.id)).has(lba)) {
      throw new ForbiddenError(`Supplier ${lba} isn't assigned to you.`);
    }
  }

  // Terminal rejection means ANY earlier submission for this form — pending, approved or rejected —
  // ends the submitter's part; corrections after that are the Warehouse Incharge's.
  const existing = await prisma.formSubmission.findFirst({ where: { receiptId, formId: form.id } });
  if (existing) {
    throw new ValidationError(
      existing.status === "rejected"
        ? "This form was rejected and can't be resubmitted — ask the Warehouse Incharge to correct it."
        : `This form has already been ${existing.status}.`
    );
  }

  const lot = values["n-lot"]?.["Lot Number"];
  if (lot) await assertLotAvailable(prisma, receiptId, receipt.warehouse, lot);

  return prisma.formSubmission.create({ data: { receiptId, formId: form.id, values, submittedById: user.id } });
}

export interface SubmissionFilter { status?: string; receiptId?: string; site?: string[]; submittedById?: string }

export async function listSubmissions(f: SubmissionFilter) {
  const rows = await prisma.formSubmission.findMany({
    where: {
      status: f.status,
      receiptId: f.receiptId,
      submittedById: f.submittedById,
      receipt: f.site ? { warehouse: { in: f.site } } : undefined,
    },
    include: {
      submittedBy: { select: { displayName: true, username: true } },
      reviewedBy: { select: { displayName: true } },
      receipt: { select: { warehouse: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id, receiptId: r.receiptId, formId: r.formId, values: r.values as SubmissionValues, status: r.status,
    submittedBy: r.submittedBy.displayName, submittedAt: r.createdAt.toISOString(),
    reviewedBy: r.reviewedBy?.displayName ?? null, reviewedAt: r.reviewedAt?.toISOString() ?? null,
    rejectReason: r.rejectReason, warehouse: r.receipt.warehouse,
  }));
}

async function loadOpen(id: string) {
  const sub = await prisma.formSubmission.findUnique({ where: { id }, include: { receipt: { select: { warehouse: true } } } });
  if (!sub) throw Object.assign(new Error("Submission not found"), { code: "P2025" });
  if (sub.status !== "submitted") throw new ValidationError(`This submission was already ${sub.status}.`);
  return sub;
}

/** Warehouse of a submission, for the route's access check before it approves or rejects. */
export async function submissionWarehouse(id: string): Promise<string> {
  const sub = await prisma.formSubmission.findUnique({ where: { id }, select: { receipt: { select: { warehouse: true } } } });
  if (!sub) throw Object.assign(new Error("Submission not found"), { code: "P2025" });
  return sub.receipt.warehouse;
}

export async function approveSubmission(reviewer: User, id: string) {
  const sub = await loadOpen(id);
  const values = sub.values as SubmissionValues;
  const form = formById(sub.formId);

  await prisma.$transaction(async (tx) => {
    for (const [stageId, fields] of Object.entries(values)) {
      await applyStageFields(tx, sub.receiptId, stageId, fields, { actor: { id: reviewer.id, via: "approval" } });
    }

    // Receipt's own top-level columns mirror three stage fields (see PATCHABLE in receipts.ts).
    const top: Record<string, string> = {};
    if (values["n-verify"]?.["SUPPLIERS NAME"]) top.supplierName = values["n-verify"]["SUPPLIERS NAME"];
    if (values["n-verify"]?.["LBA CODE"]) top.lbaCode = values["n-verify"]["LBA CODE"];
    if (values["n-gate"]?.["VEHICLE NO."]) top.vehicleNo = values["n-gate"]["VEHICLE NO."];
    if (Object.keys(top).length) await tx.receipt.update({ where: { id: sub.receiptId }, data: top });

    const fresh = await loadReceiptRow(sub.receiptId, tx);
    const status = deriveStatus(toReceiptRecord(fresh!) as ReceiptRecord);
    await tx.timelineEntry.create({
      data: {
        receiptId: sub.receiptId, status, at: new Date().toISOString(), actorId: reviewer.id,
        note: `Approved: ${form?.title ?? sub.formId}`,
      },
    });

    // Guard against two reviewers approving at once: only flip a still-"submitted" row.
    const flipped = await tx.formSubmission.updateMany({
      where: { id, status: "submitted" },
      data: { status: "approved", reviewedById: reviewer.id, reviewedAt: new Date() },
    });
    if (flipped.count !== 1) throw new ValidationError("This submission was already reviewed.");
  });
}

export async function rejectSubmission(reviewer: User, id: string, reason: string | undefined) {
  if (!reason?.trim()) throw new ValidationError("A reason is required to reject a submission.");
  const sub = await loadOpen(id);

  await prisma.$transaction(async (tx) => {
    const flipped = await tx.formSubmission.updateMany({
      where: { id, status: "submitted" },
      data: { status: "rejected", reviewedById: reviewer.id, reviewedAt: new Date(), rejectReason: reason.trim() },
    });
    if (flipped.count !== 1) throw new ValidationError("This submission was already reviewed.");

    const fresh = await loadReceiptRow(sub.receiptId, tx);
    const status = deriveStatus(toReceiptRecord(fresh!) as ReceiptRecord);
    await tx.timelineEntry.create({
      data: {
        receiptId: sub.receiptId, status, at: new Date().toISOString(), actorId: reviewer.id,
        note: `Rejected submission (${sub.formId}): ${reason.trim()}`,
      },
    });
  });
}
