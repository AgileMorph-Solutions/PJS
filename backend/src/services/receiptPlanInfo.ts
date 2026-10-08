/**
 * Where each truck stands against its Delivery Plan: planned, planned with an exception, or
 * unplanned — and whether an exception has been approved. All DERIVED from the receipt, its plan
 * and the plan's other trucks (contract domain/deliveryPlan.ts); the only stored facts are the
 * approval and the moment a plan was attached to a truck that had already arrived.
 *
 * Approval never blocks a reception: the truck is weighed, tested and stocked either way. It is the
 * recorded decision that an off-plan arrival was accepted on purpose.
 */
import type { Prisma } from "@prisma/client";
import {
  exceptionApprovalStatus, planLinkStatus, plannedReceptionInfo, unplannedInfo, type ReceptionPlanInfo,
} from "@anagroci/contract/domain/deliveryPlan";
import type { ReceiptPlanInfo } from "@anagroci/contract/types/receipt";
import { prisma } from "../db.js";
import { ValidationError } from "../domain/validation.js";
import { siteOf } from "./ids.js";
import { PLAN_FACTS_SELECT, toFacts, toTerms } from "./planFacts.js";

const RECEIPT_SELECT = {
  ...PLAN_FACTS_SELECT,
  lbaCode: true,
  deliveryPlanLinkedAt: true,
  exceptionApprovedAt: true,
  exceptionNote: true,
  exceptionApprover: { select: { displayName: true } },
} as const satisfies Prisma.ReceiptSelect;

type Db = Prisma.TransactionClient | typeof prisma;

async function build(where: Prisma.ReceiptWhereInput, db: Db): Promise<ReceiptPlanInfo[]> {
  const receipts = await db.receipt.findMany({ where, select: RECEIPT_SELECT, orderBy: { createdAt: "asc" } });
  const planIds = [...new Set(receipts.flatMap((r) => (r.deliveryPlanId ? [r.deliveryPlanId] : [])))];

  // A truck is judged against ALL its plan's trucks, not just the ones in this list: "over the
  // planned quantity" depends on what had already arrived, whatever warehouse filter was applied.
  const plans = planIds.length
    ? await db.deliveryPlan.findMany({ where: { id: { in: planIds } }, include: { receipts: { select: PLAN_FACTS_SELECT } } })
    : [];
  const planned = new Map<string, ReceptionPlanInfo>();
  for (const p of plans) {
    for (const [id, info] of plannedReceptionInfo(toTerms(p), p.receipts.map(toFacts))) planned.set(id, info);
  }

  const known = new Set((await db.supplier.findMany({ select: { code: true } })).map((s) => s.code));
  return receipts.map((r) => {
    const facts = toFacts(r);
    // "Unknown supplier" only when a code was recorded and the master doesn't have it — a blank code is "not recorded yet".
    const info = planned.get(r.id) ?? unplannedInfo(facts, { knownSupplier: r.lbaCode.trim() ? known.has(r.lbaCode.trim()) : undefined });
    const approvedAt = r.exceptionApprovedAt?.toISOString() ?? null;
    return {
      receiptId: r.id,
      deliveryPlanId: r.deliveryPlanId,
      type: info.type,
      flags: info.flags,
      planLinkStatus: planLinkStatus(r.deliveryPlanId, r.deliveryPlanLinkedAt?.toISOString()),
      approval: exceptionApprovalStatus(info, facts.rejected, approvedAt),
      approvedAt,
      approvedBy: r.exceptionApprover?.displayName ?? null,
      approvalNote: r.exceptionNote,
    };
  });
}

/** `site` is a resolved list of names, like every scoped list. */
export const listReceiptPlanInfo = (site?: string[], db: Db = prisma) => build(site ? { warehouse: { in: site } } : {}, db);

export async function getReceiptPlanInfo(receiptId: string, db: Db = prisma): Promise<ReceiptPlanInfo | null> {
  return (await build({ id: receiptId }, db))[0] ?? null;
}

/** Records that an unplanned or off-plan truck was accepted on purpose. */
export async function approveException(receiptId: string, actorId: string, note?: string | null): Promise<ReceiptPlanInfo> {
  const info = await getReceiptPlanInfo(receiptId);
  if (!info) throw Object.assign(new Error("Receipt not found"), { code: "P2025" });
  if (info.approval === "not_applicable_rejected") throw new ValidationError("A rejected truck enters no stock, so there is nothing to approve.");
  if (info.approval === "not_required") throw new ValidationError("This truck arrived as planned — there is no exception to approve.");
  if (info.approval === "pending") {
    await prisma.receipt.update({
      where: { id: receiptId },
      data: { exceptionApprovedAt: new Date(), exceptionApprovedBy: actorId, exceptionNote: note?.trim() || null },
    });
  }
  return (await getReceiptPlanInfo(receiptId))!;
}

/**
 * Attaches a plan to a truck that has already arrived — the "unplanned, regularise later" case.
 * Only a truck with no plan: moving one between plans would erase how it first arrived.
 */
export async function linkReceiptToPlan(receiptId: string, planId: string): Promise<ReceiptPlanInfo> {
  const receipt = await prisma.receipt.findUnique({ where: { id: receiptId }, select: { warehouse: true, lbaCode: true, deliveryPlanId: true } });
  if (!receipt) throw Object.assign(new Error("Receipt not found"), { code: "P2025" });
  if (receipt.deliveryPlanId) throw new ValidationError(`This truck is already linked to ${receipt.deliveryPlanId}.`);
  const plan = await prisma.deliveryPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new ValidationError(`Delivery plan ${planId} doesn't exist.`);
  const site = (await siteOf(prisma, receipt.warehouse)) ?? receipt.warehouse;
  if (plan.destinationWarehouse !== site) throw new ValidationError(`Delivery plan ${plan.id} is for ${plan.destinationWarehouse}, not ${site}.`);
  // Both codes must be known to compare; a blank on either side is "not recorded", not a mismatch.
  if (plan.supplierCode && receipt.lbaCode.trim() && plan.supplierCode.trim() !== receipt.lbaCode.trim()) {
    throw new ValidationError(`Delivery plan ${plan.id} is for supplier ${plan.supplierCode}, not ${receipt.lbaCode.trim()}.`);
  }
  await prisma.receipt.update({ where: { id: receiptId }, data: { deliveryPlanId: plan.id, deliveryPlanLinkedAt: new Date() } });
  return (await getReceiptPlanInfo(receiptId))!;
}
