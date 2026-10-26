/**
 * A truck's field change history, read back from StageFieldChange (written by services/receipts.ts applyStageFields
 * on every direct edit, approved submission and upload). Price/amount rows are not filtered here: auth/redact.ts drops
 * any {stageId, label} entry the caller's role may not see from every response, so this can't forget to.
 */
import type { FieldChangeRecord } from "@anagroci/contract/types/receipt";
import { prisma } from "../db.js";

export async function listFieldChanges(receiptId: string): Promise<FieldChangeRecord[]> {
  const rows = await prisma.stageFieldChange.findMany({
    where: { receiptId },
    select: {
      id: true, stageId: true, label: true, oldValue: true, newValue: true, at: true, via: true,
      user: { select: { displayName: true } },
      submission: { select: { submittedBy: { select: { displayName: true } } } },
    },
    // Newest first; id breaks ties between fields saved in the same write.
    orderBy: [{ at: "desc" }, { id: "desc" }],
  });
  // An approved form's values were typed by its submitter; the row's own user is the approver. Approval rows from
  // before the submission link have no submitter on record, so they still name the approver, with approvedBy left null.
  return rows.map((r) => ({
    id: r.id, stageId: r.stageId, label: r.label, oldValue: r.oldValue, newValue: r.newValue,
    at: r.at.toISOString(), via: r.via as FieldChangeRecord["via"],
    by: r.submission?.submittedBy.displayName ?? r.user.displayName,
    approvedBy: r.submission ? r.user.displayName : null,
  }));
}
