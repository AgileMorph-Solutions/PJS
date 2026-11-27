/**
 * Live quality requests (27 Nov 2026, user): the Incharge's open drying form asks the QFS Officer at once, and the request
 * stays until the Incharge cancels the form. The rules are the contract's (domain/qualityRequests.ts); this file keeps them.
 *
 * The QFS Officer's reading is always a QualitySubmission, approved or rejected in Approvals (services/qualitySubmissions.ts).
 * Before drying, with no round yet, the check is about the request ("request:<id>"); approved, its reading is kept here and
 * fills the Incharge's form.
 */
import { Prisma } from "@prisma/client";
import {
  CANCELLED_NOTE, isLiveRequest, isQualityRequestKind, parseScope, requestTargetId, scopeFitsKind, scopeKey,
  type QualityRequestKind, type QualityRequestScope, type QualityRequestStatus, type QualityRequestView,
} from "@anagroci/contract/domain/qualityRequests";
import { dryingPhase } from "@anagroci/contract/domain/sunDrying";
import { prisma } from "../db.js";
import { ValidationError } from "../domain/validation.js";
import { dryingRoundName } from "./dryingBatches.js";
import { submitQualityCheck } from "./qualitySubmissions.js";
import { siteOf } from "./ids.js";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;
type Person = { id: string; displayName?: string | null };

const INCLUDE = { openedBy: { select: { displayName: true } }, answeredBy: { select: { displayName: true } } } as const;
type Row = Prisma.QualityRequestGetPayload<{ include: typeof INCLUDE }>;
const LIVE = ["open", "answered"];

const notFound = () => Object.assign(new Error("Quality request not found"), { code: "P2025" });

/** A scope from the request, checked against its kind. */
export function readScope(kind: unknown, raw: unknown): { kind: QualityRequestKind; scope: QualityRequestScope } {
  if (!isQualityRequestKind(kind)) throw new ValidationError("Choose which drying check the form is for.");
  const s = raw as Partial<Record<string, unknown>> | null;
  const scope: QualityRequestScope | null =
    s?.kind === "receipt" && typeof s.receiptId === "string" && s.receiptId.trim() ? { kind: "receipt", receiptId: s.receiptId.trim() }
    : s?.kind === "bin" && typeof s.binCode === "string" && s.binCode.trim() ? { kind: "bin", binCode: s.binCode.trim().toUpperCase() }
    : s?.kind === "round" && typeof s.roundId === "string" && s.roundId.trim() ? { kind: "round", roundId: s.roundId.trim() }
    : null;
  if (!scope || !scopeFitsKind(kind, scope)) throw new ValidationError("Say which truck, Bin or drying round the form is for.");
  return { kind, scope };
}

/** Where the form's record is, and how people name it. The route checks the warehouse before anything is written. */
export async function requestTarget(db: Db, scope: QualityRequestScope): Promise<{ warehouse: string; reference: string }> {
  switch (scope.kind) {
    case "receipt": {
      const r = await db.receipt.findUnique({ where: { id: scope.receiptId }, select: { warehouse: true, vehicleNo: true } });
      if (!r) throw notFound();
      const lot = (await db.stageLotAssignment.findUnique({ where: { receiptId: scope.receiptId }, select: { lotNumber: true } }))?.lotNumber;
      return { warehouse: r.warehouse, reference: [`Truck ${scope.receiptId}`, lot && `Lot ${lot}`, r.vehicleNo].filter(Boolean).join(" · ") + ", straight onto the yard" };
    }
    case "bin": {
      const b = await db.bin.findUnique({ where: { code: scope.binCode }, select: { warehouseName: true } });
      if (!b?.warehouseName) throw new ValidationError(`Bin ${scope.binCode} isn't a Bin of a warehouse.`);
      return { warehouse: (await siteOf(db, b.warehouseName)) ?? b.warehouseName, reference: `Drying from Bin ${scope.binCode}` };
    }
    case "round": {
      const b = await db.dryingBatch.findUnique({ where: { id: scope.roundId } });
      if (!b) throw notFound();
      return { warehouse: b.warehouseSite ?? b.warehouse ?? "", reference: dryingRoundName(b) };
    }
  }
}

const toView = (r: Row): QualityRequestView => ({
  id: r.id, kind: r.kind as QualityRequestKind, scope: parseScope(r.scope)!, warehouse: r.warehouse, reference: r.reference,
  status: r.status as QualityRequestStatus, openedBy: r.openedBy.displayName, openedAt: r.createdAt.toISOString(),
  values: (r.values ?? null) as Record<string, string> | null,
  answeredBy: r.answeredBy?.displayName ?? null, answeredAt: r.answeredAt?.toISOString() ?? null, roundId: r.roundId,
});

/** The form still open for this truck, Bin or round, if any: the page opens it again when the Incharge comes back. */
export async function findLiveRequest(kind: QualityRequestKind, scope: QualityRequestScope): Promise<QualityRequestView | null> {
  const row = await prisma.qualityRequest.findFirst({ where: { kind, scope: scopeKey(scope), status: { in: LIVE } }, include: INCLUDE });
  return row ? toView(row) : null;
}

/**
 * The Incharge's drying form opened: asks the QFS Officer, or finds the request already asked for this truck, Bin or round
 * (the same form open in two tabs, by two people, or again after leaving the page, is one request).
 */
export async function openQualityRequest(user: Person, kind: QualityRequestKind, scope: QualityRequestScope): Promise<QualityRequestView> {
  return prisma.$transaction(async (tx) => {
    const { warehouse, reference } = await requestTarget(tx, scope);
    if (scope.kind === "round") {
      const b = (await tx.dryingBatch.findUnique({ where: { id: scope.roundId }, select: { status: true, source: true } }))!;
      if (b.source !== "entered" || dryingPhase(b.status) !== "quality_check") throw new ValidationError(`${reference} isn't waiting for its check after drying.`);
    }
    const key = scopeKey(scope);
    const live = await tx.qualityRequest.findFirst({ where: { kind, scope: key, status: { in: LIVE } }, include: INCLUDE });
    if (live) return toView(live);
    return toView(await tx.qualityRequest.create({ data: { kind, scope: key, warehouse, reference, openedById: user.id }, include: INCLUDE }));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function getQualityRequest(id: number): Promise<QualityRequestView> {
  const row = await prisma.qualityRequest.findUnique({ where: { id }, include: INCLUDE });
  if (!row) throw notFound();
  return toView(row);
}

export async function qualityRequestWarehouse(id: number): Promise<string> {
  const row = await prisma.qualityRequest.findUnique({ where: { id }, select: { warehouse: true } });
  if (!row) throw notFound();
  return row.warehouse;
}

/**
 * The Incharge clicked Cancel. Before drying, a check still waiting for approval is withdrawn, and the QFS Officer sees it
 * as cancelled; after drying it stays in Approvals as the round's check. Cancelling one already saved changes nothing.
 */
export async function cancelQualityRequest(user: Person, id: number): Promise<QualityRequestView> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.qualityRequest.findUnique({ where: { id }, select: { kind: true, status: true } });
    if (!row) throw notFound();
    if (!isLiveRequest(row.status)) return;
    await tx.qualityRequest.update({ where: { id }, data: { status: "cancelled", closedAt: new Date() } });
    if (row.kind === "drying_before") {
      await tx.qualitySubmission.updateMany({
        where: { kind: "drying_before", targetId: requestTargetId(id), status: "submitted" },
        data: { status: "cancelled", reviewedById: user.id, reviewedAt: new Date(), rejectReason: CANCELLED_NOTE },
      });
    }
  });
  return getQualityRequest(id);
}

/**
 * The QFS Officer's reading for the Incharge's open form: a check in Approvals, about the request before drying (or about
 * the round, once it started without the reading), about the round after drying.
 */
export async function answerQualityRequest(user: Person, id: number, raw: unknown) {
  const row = await prisma.qualityRequest.findUnique({ where: { id } });
  if (!row) throw notFound();
  const scope = parseScope(row.scope)!;
  if (scope.kind === "round") return submitQualityCheck(user, "drying_after", scope.roundId, raw);
  if (row.status === "used") {
    if (!row.roundId) throw new ValidationError(`The Warehouse Incharge entered the quality going onto the yard for ${row.reference} when starting the round.`);
    return submitQualityCheck(user, "drying_before", row.roundId, raw);
  }
  if (row.status === "cancelled") throw new ValidationError(`The Warehouse Incharge cancelled the drying form for ${row.reference}, so there is nothing to measure now.`);
  return submitQualityCheck(user, "drying_before", requestTargetId(id), raw);
}

/**
 * Round 1 was started from the form that asked (dryingBatches.startDrying / startBinDrying, in their transaction). A check
 * still waiting for approval becomes the round's; with no reading at all, the request stands for the round's check to do.
 * `enteredHere`: the form carried a quality reading (typed, or the approved one that filled it).
 */
export async function settleBeforeRequest(
  tx: Tx, requestId: number | undefined, scope: QualityRequestScope, round: { id: string; warehouseSite: string | null }, enteredHere: boolean,
): Promise<void> {
  if (requestId === undefined) return;
  const row = await tx.qualityRequest.findUnique({ where: { id: requestId } });
  if (!row || row.kind !== "drying_before" || row.scope !== scopeKey(scope)) throw new ValidationError("That quality request is for another drying form. Close the form and open it again.");
  if (!isLiveRequest(row.status)) return;
  const waiting = await tx.qualitySubmission.findFirst({ where: { kind: "drying_before", targetId: requestTargetId(requestId), status: "submitted" }, select: { id: true } });
  if (waiting && enteredHere) {
    throw new ValidationError("The QFS Officer's quality going onto the yard is waiting in Approvals. Approve or reject it there first, or leave the quality blank here and approve it on the round.");
  }
  if (waiting) await tx.qualitySubmission.update({ where: { id: waiting.id }, data: { targetId: round.id, warehouse: round.warehouseSite ?? row.warehouse } });
  await tx.qualityRequest.update({ where: { id: requestId }, data: { status: "used", roundId: enteredHere ? null : round.id, closedAt: new Date() } });
}

/** The round's check after drying is recorded, by the Incharge or by approving the QFS Officer's: its form is done. */
export async function settleAfterRequest(tx: Tx, roundId: string): Promise<void> {
  await tx.qualityRequest.updateMany({ where: { kind: "drying_after", scope: scopeKey({ kind: "round", roundId }), status: { in: LIVE } }, data: { status: "used", roundId, closedAt: new Date() } });
}

/**
 * The requests the QFS Officer's list needs at these warehouses: the forms still open, and the rounds started from a form
 * before their reading came (the request stands for the round's check until it is taken, so a QFS form open on it keeps
 * working).
 */
export async function listQualityRequests(sites: string[]): Promise<QualityRequestView[]> {
  const rows = await prisma.qualityRequest.findMany({
    where: { warehouse: { in: sites }, OR: [{ status: { in: LIVE } }, { kind: "drying_before", status: "used", roundId: { not: null } }] },
    include: INCLUDE, orderBy: { createdAt: "asc" },
  });
  return rows.map(toView);
}
