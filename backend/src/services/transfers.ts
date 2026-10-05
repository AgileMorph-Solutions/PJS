/**
 * Transfer Requests — moving Lots from one warehouse to another, numbered BKT-<year>-NNN (Oct 2026
 * team feedback: "Transfer Request → BKT Transfer ID"). Deliberately minimal: which Lots, from
 * where, to where, and whether they have left / arrived. The Lot, supplier and fiche of each line
 * are read from its receipt, never retyped.
 *
 * Putting a Lot on a transfer is the transfer decision for that truck, so it records the n-xferdec
 * branch as "transfer" in the same transaction — the receipt's status then derives to
 * "transferred out" exactly as if the decision had been taken on the receipt itself.
 */
import { Prisma } from "@prisma/client";
import { yearOf } from "@anagroci/contract/domain/ids";
import type { ReceiptRecord, TransferRequest, TransferStatus } from "@anagroci/contract/types/receipt";
import { TRANSFER_STATUSES } from "@anagroci/contract/data/transfers";
import { deriveStatus } from "@anagroci/contract/domain/receiptStatus";
import { prisma } from "../db.js";
import { ValidationError } from "../domain/validation.js";
import { toReceiptRecord } from "../serialize.js";
import { nextTransferId, siteOf } from "./ids.js";
import { applyBranch, loadReceiptRow, type WriteOpts } from "./receipts.js";

type Tx = Prisma.TransactionClient;

export interface TransferLineInput {
  receiptId: string;
  bags?: number | null;
  netWeightKg?: number | string | null;
}

export interface TransferInput {
  transferDate?: string;
  fromWarehouse?: string;
  toWarehouse?: string;
  remarks?: string | null;
  lines?: TransferLineInput[];
}

const INCLUDE = {
  lines: {
    orderBy: { id: "asc" },
    include: {
      receipt: {
        select: {
          id: true, supplierName: true, vehicleNo: true,
          lot: { select: { lotNumber: true } },
          verify: { select: { fiche: true } },
        },
      },
    },
  },
} as const;

type TransferRow = Prisma.TransferRequestGetPayload<{ include: typeof INCLUDE }>;

function toWire(t: TransferRow): TransferRequest {
  return {
    id: t.id,
    transferDate: t.transferDate,
    fromWarehouse: t.fromWarehouse,
    toWarehouse: t.toWarehouse,
    status: t.status as TransferStatus,
    remarks: t.remarks,
    lines: t.lines.map((l) => ({
      receiptId: l.receiptId,
      lotNumber: l.receipt.lot?.lotNumber ?? null,
      supplierName: l.receipt.supplierName,
      vehicleNo: l.receipt.vehicleNo,
      fiche: l.receipt.verify?.fiche ?? null,
      bags: l.bags,
      netWeightKg: l.netWeightKg === null ? null : Number(l.netWeightKg),
    })),
  };
}

/** Transfers out of OR into any of the given names (a resolved site — domain/site.ts). */
export async function listTransfers(site?: string[]) {
  const rows = await prisma.transferRequest.findMany({
    where: site ? { OR: [{ fromWarehouse: { in: site } }, { toWarehouse: { in: site } }] } : {},
    include: INCLUDE,
    orderBy: { id: "desc" },
  });
  return rows.map(toWire);
}

export async function getTransfer(id: string) {
  const row = await prisma.transferRequest.findUnique({ where: { id }, include: INCLUDE });
  return row ? toWire(row) : null;
}

function netWeight(v: TransferLineInput["netWeightKg"]): Prisma.Decimal | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) throw new ValidationError(`Net weight "${v}" isn't a number of kg.`);
  return new Prisma.Decimal(n);
}

/**
 * Each Lot must be at the sending warehouse, actually have a Lot (passed quality), not be rejected,
 * and not already be on another transfer — a Lot leaves a warehouse once.
 */
async function addLines(tx: Tx, transferId: string, from: string, lines: TransferLineInput[], opts: WriteOpts) {
  const ids = lines.map((l) => l.receiptId);
  if (new Set(ids).size !== ids.length) throw new ValidationError("The same Lot is listed twice on this transfer.");
  for (const line of lines) {
    const receipt = await tx.receipt.findUnique({
      where: { id: line.receiptId },
      select: { warehouse: true, lot: { select: { lotNumber: true } }, branches: { select: { stageId: true, branchId: true } } },
    });
    if (!receipt) throw new ValidationError(`Receipt ${line.receiptId} doesn't exist.`);
    if ((await siteOf(tx, receipt.warehouse)) !== from) throw new ValidationError(`${line.receiptId} is at ${receipt.warehouse}, not ${from}.`);
    if (!receipt.lot?.lotNumber?.trim()) throw new ValidationError(`${line.receiptId} has no Lot yet — only a truck that passed quality can be transferred.`);
    if (receipt.branches.some((b) => b.stageId === "n-qfs" && b.branchId === "fail")) throw new ValidationError(`${line.receiptId} was rejected and can't be transferred.`);
    const other = await tx.transferRequestLine.findFirst({ where: { receiptId: line.receiptId, transferId: { not: transferId } }, select: { transferId: true } });
    if (other) throw new ValidationError(`Lot ${receipt.lot.lotNumber} is already on transfer ${other.transferId}.`);
    if (line.bags !== undefined && line.bags !== null && (!Number.isInteger(line.bags) || line.bags < 0)) {
      throw new ValidationError(`Bags "${line.bags}" isn't a whole number.`);
    }

    await tx.transferRequestLine.create({
      data: { transferId, receiptId: line.receiptId, bags: line.bags ?? null, netWeightKg: netWeight(line.netWeightKg) },
    });
    await applyBranch(tx, line.receiptId, "n-xferdec", "transfer", undefined, opts);
    const fresh = await loadReceiptRow(line.receiptId, tx);
    await tx.timelineEntry.create({
      data: {
        receiptId: line.receiptId, status: deriveStatus(toReceiptRecord(fresh!) as ReceiptRecord),
        at: new Date().toISOString(), actorId: opts.actor?.id, note: `Added to transfer ${transferId}`,
      },
    });
  }
}

export async function createTransfer(input: TransferInput, opts: WriteOpts = {}) {
  const date = input.transferDate?.trim();
  if (!date || yearOf(date) === undefined) throw new ValidationError("A transfer needs a date (YYYY-MM-DD).");
  if (!input.fromWarehouse?.trim() || !input.toWarehouse?.trim()) throw new ValidationError("A transfer needs a sending and a receiving warehouse.");
  if (!input.lines?.length) throw new ValidationError("A transfer needs at least one Lot.");

  const row = await prisma.$transaction(async (tx) => {
    const from = await siteOf(tx, input.fromWarehouse!.trim());
    const to = await siteOf(tx, input.toWarehouse!.trim());
    if (!from) throw new ValidationError(`Warehouse "${input.fromWarehouse}" isn't in the warehouse master.`);
    if (!to) throw new ValidationError(`Warehouse "${input.toWarehouse}" isn't in the warehouse master.`);
    if (from === to) throw new ValidationError("A transfer must go to a different warehouse.");

    const id = await nextTransferId(tx, date);
    await tx.transferRequest.create({
      data: { id, transferDate: date, fromWarehouse: from, toWarehouse: to, remarks: input.remarks?.trim() || null },
    });
    await addLines(tx, id, from, input.lines!, opts);
    return tx.transferRequest.findUniqueOrThrow({ where: { id }, include: INCLUDE });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return toWire(row);
}

/** More Lots can be added only while the request hasn't left yet. */
export async function addTransferLines(id: string, lines: TransferLineInput[], opts: WriteOpts = {}) {
  if (!lines.length) throw new ValidationError("Add at least one Lot.");
  const row = await prisma.$transaction(async (tx) => {
    const t = await tx.transferRequest.findUnique({ where: { id } });
    if (!t) throw Object.assign(new Error("Transfer not found"), { code: "P2025" });
    if (t.status !== "requested") throw new ValidationError(`Transfer ${id} is already ${t.status} — Lots can't be added now.`);
    await addLines(tx, id, t.fromWarehouse, lines, opts);
    return tx.transferRequest.findUniqueOrThrow({ where: { id }, include: INCLUDE });
  });
  return toWire(row);
}

/** requested → dispatched → received, one step at a time and never backwards. */
export async function setTransferStatus(id: string, status: string) {
  if (!TRANSFER_STATUSES.includes(status as TransferStatus)) {
    throw new ValidationError(`Unknown transfer status "${status}" (use ${TRANSFER_STATUSES.join(", ")}).`);
  }
  const t = await prisma.transferRequest.findUnique({ where: { id } });
  if (!t) throw Object.assign(new Error("Transfer not found"), { code: "P2025" });
  const from = TRANSFER_STATUSES.indexOf(t.status as TransferStatus);
  const to = TRANSFER_STATUSES.indexOf(status as TransferStatus);
  if (to !== from + 1) throw new ValidationError(`Transfer ${id} is ${t.status}; it can only move to ${TRANSFER_STATUSES[from + 1] ?? "nothing further"}.`);
  const row = await prisma.transferRequest.update({ where: { id }, data: { status }, include: INCLUDE });
  return toWire(row);
}
