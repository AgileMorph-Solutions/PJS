/**
 * The soft problems an upload found in a truck's row, kept so they show on the truck's page
 * (domain/workbook/receiptSheet.ts writes them, contract domain/uploadChecks.ts decides them).
 * "Reviewed" only records that someone has seen it: the value is never changed from here.
 */
import type { UploadIssueRecord } from "@anagroci/contract/types/receipt";
import { prisma } from "../db.js";

const SELECT = {
  id: true, filename: true, sheet: true, row: true, column: true, severity: true, message: true, uploadedAt: true, reviewedAt: true,
  uploadedBy: { select: { displayName: true } }, reviewedBy: { select: { displayName: true } },
} as const;

type Row = Awaited<ReturnType<typeof prisma.uploadIssue.findFirstOrThrow<{ select: typeof SELECT }>>>;

const toWire = (r: Row): UploadIssueRecord => ({
  id: r.id, filename: r.filename, sheet: r.sheet, row: r.row, column: r.column, severity: r.severity as UploadIssueRecord["severity"], message: r.message,
  uploadedAt: r.uploadedAt.toISOString(), uploadedBy: r.uploadedBy?.displayName ?? null,
  reviewedAt: r.reviewedAt?.toISOString() ?? null, reviewedBy: r.reviewedBy?.displayName ?? null,
});

export async function listUploadIssues(receiptId: string): Promise<UploadIssueRecord[]> {
  const rows = await prisma.uploadIssue.findMany({ where: { receiptId }, select: SELECT, orderBy: [{ uploadedAt: "desc" }, { row: "asc" }, { id: "asc" }] });
  return rows.map(toWire);
}

/** Idempotent: reviewing an already-reviewed issue keeps who saw it first. Scoped to the receipt, so an id from another truck is "not found". */
export async function reviewUploadIssue(receiptId: string, issueId: string, actorId: string): Promise<UploadIssueRecord | null> {
  const existing = await prisma.uploadIssue.findFirst({ where: { id: issueId, receiptId }, select: { reviewedAt: true } });
  if (!existing) return null;
  if (!existing.reviewedAt) await prisma.uploadIssue.update({ where: { id: issueId }, data: { reviewedAt: new Date(), reviewedById: actorId } });
  return toWire(await prisma.uploadIssue.findFirstOrThrow({ where: { id: issueId }, select: SELECT }));
}
