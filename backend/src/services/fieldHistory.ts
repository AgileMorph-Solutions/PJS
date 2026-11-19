/**
 * A truck's field change history, read back from StageFieldChange (written by services/receipts.ts applyStageFields
 * on every direct edit, approved submission and upload). Price/amount rows are not filtered here: auth/redact.ts drops
 * any {stageId, label} entry the caller's role may not see from every response, so this can't forget to.
 */
import type { FieldChangeRecord, SiteFieldChangeRecord } from "@anagroci/contract/types/receipt";
import { prisma } from "../db.js";

const SELECT = {
  id: true, stageId: true, label: true, oldValue: true, newValue: true, at: true, via: true,
  user: { select: { displayName: true } },
  submission: { select: { submittedBy: { select: { displayName: true } } } },
} as const;
// Newest first; id breaks ties between fields saved in the same write.
const NEWEST_FIRST = [{ at: "desc" as const }, { id: "desc" as const }];

type Row = Awaited<ReturnType<typeof prisma.stageFieldChange.findMany<{ select: typeof SELECT }>>>[number];

export async function listFieldChanges(receiptId: string): Promise<FieldChangeRecord[]> {
  const rows = await prisma.stageFieldChange.findMany({ where: { receiptId }, select: SELECT, orderBy: NEWEST_FIRST });
  return rows.map(toRecord);
}

/** The most a Logs page reads at once; older changes are reached by narrowing the dates. */
export const SITE_LOG_LIMIT = 2000;

/**
 * Every field change on the trucks of a site (or every site, for an admin with none chosen), newest first, between two
 * dates (ISO, inclusive). The Logs page: who changed what, on which truck, when, and by which route.
 */
export async function listSiteFieldChanges(site: string[] | undefined, from?: string, to?: string): Promise<SiteFieldChangeRecord[]> {
  const at = {
    ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}),
    ...(to ? { lt: new Date(new Date(`${to}T00:00:00Z`).getTime() + 86400000) } : {}),
  };
  const rows = await prisma.stageFieldChange.findMany({
    where: { ...(site ? { receipt: { warehouse: { in: site } } } : {}), ...(from || to ? { at } : {}) },
    select: { ...SELECT, receipt: { select: { id: true, vehicleNo: true, warehouse: true } } },
    orderBy: NEWEST_FIRST,
    take: SITE_LOG_LIMIT,
  });
  return rows.map((r) => ({ ...toRecord(r), receiptId: r.receipt.id, vehicleNo: r.receipt.vehicleNo, warehouse: r.receipt.warehouse }));
}

function toRecord(r: Row): FieldChangeRecord {
  // An approved form's values were typed by its submitter; the row's own user is the approver. Approval rows from
  // before the submission link have no submitter on record, so they still name the approver, with approvedBy left null.
  return {
    id: r.id, stageId: r.stageId, label: r.label, oldValue: r.oldValue, newValue: r.newValue,
    at: r.at.toISOString(), via: r.via as FieldChangeRecord["via"],
    by: r.submission?.submittedBy.displayName ?? r.user.displayName,
    approvedBy: r.submission ? r.user.displayName : null,
  };
}
