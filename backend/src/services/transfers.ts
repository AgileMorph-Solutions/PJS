/**
 * Transfer Requests — moving Lots from one warehouse to another on ONE truck, numbered BKT-<year>-NNN
 * (Oct 2026 team feedback: "Transfer Request → BKT Transfer ID", then the client's workbook: "one BKT
 * should represent one truck/voyage"). The Lot, supplier and fiche of each line are read from its
 * receipt, never retyped.
 *
 * Two warehouses write two halves of the record and neither writes the other's:
 *   - dispatch (the SENDING site): the truck, who drives it, and the loaded weight at its scale;
 *   - receive (the DESTINATION site): bags, gross weight, KOR, moisture and nut count at ITS scale.
 * The receiving fields stay blank until the truck arrives, so a bag count can never be "received"
 * at dispatch; the variance and the in-transit / closed / discrepancy state are derived from the two
 * halves (contract domain/transfers.ts), never stored.
 *
 * Putting a Lot on a transfer is the transfer decision for that truck, so it records the n-xferdec
 * branch as "transfer" in the same transaction — the receipt's status then derives to
 * "transferred out" exactly as if the decision had been taken on the receipt itself.
 */
import { Prisma } from "@prisma/client";
import { yearOf } from "@anagroci/contract/domain/ids";
import type { ReceiptRecord, TransferRequest, TransferStatus } from "@anagroci/contract/types/receipt";
import { transferState, transferVariance, type TransferFacts } from "@anagroci/contract/domain/transfers";
import { parseQty } from "@anagroci/contract/domain/receiptMath";
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
  /** Defaults to the Lot's Bin(s) at the moment it is added. */
  binCode?: string | null;
}

export interface TransferInput {
  transferDate?: string;
  fromWarehouse?: string;
  toWarehouse?: string;
  remarks?: string | null;
  lines?: TransferLineInput[];
}

/** A Lot's quality at dispatch, when it is measured again rather than taken from its quality check. */
export interface DispatchLineQuality {
  receiptId: string;
  moisture?: number | string | null;
  kor?: number | string | null;
  nutCount?: number | string | null;
}

export interface DispatchInput {
  /** The warehouse receipt number this dispatch is recorded against (required). */
  whReceiptNo?: string | null;
  /** Quality per Lot. A Lot left out here takes its own quality check's moisture, KOR and nut count. */
  lines?: DispatchLineQuality[];
  truckNo?: string;
  transporter?: string | null;
  driver?: string | null;
  driverPhone?: string | null;
  dispatchedGrossKg?: number | string | null;
}

export interface ReceiveInput {
  /** The receiving warehouse's own receipt number for this arrival (required). */
  whReceiptNo?: string | null;
  bagsReceived?: number | string;
  damagedBags?: number | string | null;
  receivedGrossKg?: number | string;
  korReceived?: number | string | null;
  moistureReceived?: number | string | null;
  nutCountReceived?: number | string | null;
  receivedComment?: string | null;
  receivedLotNoRaw?: string | null;
}

const INCLUDE = {
  dispatcher: { select: { displayName: true } },
  receiver: { select: { displayName: true } },
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

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

function toWire(t: TransferRow): TransferRequest {
  const lines = t.lines.map((l) => ({
    receiptId: l.receiptId,
    lotNumber: l.receipt.lot?.lotNumber ?? null,
    supplierName: l.receipt.supplierName,
    vehicleNo: l.receipt.vehicleNo,
    fiche: l.receipt.verify?.fiche ?? null,
    bags: l.bags,
    netWeightKg: num(l.netWeightKg),
    moisture: num(l.moisture),
    kor: num(l.kor),
    nutCount: l.nutCount,
    binCode: l.binCode,
  }));
  const facts = {
    status: t.status as TransferStatus,
    lines,
    dispatchedGrossKg: num(t.dispatchedGrossKg),
    bagsReceived: t.bagsReceived,
    receivedGrossKg: num(t.receivedGrossKg),
  };
  return {
    id: t.id,
    transferDate: t.transferDate,
    fromWarehouse: t.fromWarehouse,
    toWarehouse: t.toWarehouse,
    status: facts.status,
    remarks: t.remarks,
    lines,
    dispatchWhReceiptNo: t.dispatchWhReceiptNo,
    receiveWhReceiptNo: t.receiveWhReceiptNo,
    truckNo: t.truckNo,
    transporter: t.transporter,
    driver: t.driver,
    driverPhone: t.driverPhone,
    dispatchedGrossKg: facts.dispatchedGrossKg,
    dispatchedAt: t.dispatchedAt?.toISOString() ?? null,
    dispatchedBy: t.dispatcher?.displayName ?? null,
    bagsReceived: t.bagsReceived,
    damagedBags: t.damagedBags,
    receivedGrossKg: facts.receivedGrossKg,
    korReceived: num(t.korReceived),
    moistureReceived: num(t.moistureReceived),
    nutCountReceived: t.nutCountReceived,
    receivedComment: t.receivedComment,
    receivedLotNoRaw: t.receivedLotNoRaw,
    receivedAt: t.receivedAt?.toISOString() ?? null,
    receivedBy: t.receiver?.displayName ?? null,
    state: transferState(facts),
    variance: transferVariance(facts),
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

function decimal(v: string | number | null | undefined, what: string): Prisma.Decimal | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = parseQty(v);
  if (n === undefined || n < 0) throw new ValidationError(`${what} "${v}" isn't a number.`);
  return new Prisma.Decimal(n);
}

function whole(v: string | number | null | undefined, what: string): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).trim());
  if (!Number.isInteger(n) || n < 0) throw new ValidationError(`${what} "${v}" isn't a whole number.`);
  return n;
}

const text = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);

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
      select: {
        warehouse: true, lot: { select: { lotNumber: true } }, bin: { select: { binNumber: true } },
        branches: { select: { stageId: true, branchId: true } },
      },
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
      data: {
        transferId, receiptId: line.receiptId, bags: line.bags ?? null, netWeightKg: decimal(line.netWeightKg, "Net weight"),
        binCode: text(line.binCode) ?? text(receipt.bin?.binNumber),
      },
    });
    await applyBranch(tx, line.receiptId, "n-xferdec", "transfer", undefined, opts);
    await timeline(tx, line.receiptId, `Added to transfer ${transferId}`, opts);
  }
}

async function timeline(tx: Tx, receiptId: string, note: string, opts: WriteOpts) {
  const fresh = await loadReceiptRow(receiptId, tx);
  await tx.timelineEntry.create({
    data: { receiptId, status: deriveStatus(toReceiptRecord(fresh!) as ReceiptRecord), at: new Date().toISOString(), actorId: opts.actor?.id, note },
  });
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

/** "1796 GC 01 / 3922-BB-04" and "1796GC01/3922BB04" are the same rig. */
const rig = (truck: string) => truck.toUpperCase().replace(/[\s-]+/g, "");

/**
 * The sending warehouse sends the truck. One BKT is one truck / voyage, so the truck is required and
 * can't already be out on another BKT that hasn't arrived yet.
 */
export async function dispatchTransfer(id: string, input: DispatchInput, opts: WriteOpts = {}) {
  const truckNo = text(input.truckNo);
  if (!truckNo) throw new ValidationError("A transfer needs its truck number to be dispatched — one BKT is one truck.");
  const whReceiptNo = text(input.whReceiptNo);
  if (!whReceiptNo) throw new ValidationError("Enter the warehouse receipt number: a dispatch is recorded against it.");
  const gross = decimal(input.dispatchedGrossKg, "Loaded weight");

  const row = await prisma.$transaction(async (tx) => {
    const t = await tx.transferRequest.findUnique({ where: { id }, include: { lines: { select: { id: true, receiptId: true } } } });
    if (!t) throw Object.assign(new Error("Transfer not found"), { code: "P2025" });
    if (t.status !== "requested") throw new ValidationError(`Transfer ${id} is already ${t.status}.`);
    if (!t.lines.length) throw new ValidationError(`Transfer ${id} has no Lots to send.`);

    // Every Lot leaves with its quality on the record: re-measured here when given, else its own quality check's result.
    const quality = new Map<number, { moisture: Prisma.Decimal; kor: Prisma.Decimal; nutCount: number | null }>();
    for (const l of t.lines) {
      const given = input.lines?.find((x) => x.receiptId === l.receiptId);
      const r = await tx.receipt.findUnique({
        where: { id: l.receiptId },
        select: { lot: { select: { lotNumber: true } }, qfs: { select: { moistureNum: true, korNum: true, finalKorNum: true, nutCountNum: true } } },
      });
      const lot = r?.lot?.lotNumber ?? l.receiptId;
      const moisture = decimal(given?.moisture, "Moisture") ?? r?.qfs?.moistureNum ?? null;
      const kor = decimal(given?.kor, "KOR") ?? r?.qfs?.finalKorNum ?? r?.qfs?.korNum ?? null;
      const nutCount = whole(given?.nutCount, "Nut count") ?? (r?.qfs?.nutCountNum === null || r?.qfs?.nutCountNum === undefined ? null : Math.round(Number(r.qfs.nutCountNum)));
      if (moisture === null || kor === null) {
        throw new ValidationError(`Lot ${lot} has no ${moisture === null ? "moisture" : "KOR"} on record from its quality check. Enter the ${moisture === null ? "moisture" : "KOR"} for the dispatch.`);
      }
      if (Number(moisture) < 0 || Number(moisture) > 100) throw new ValidationError(`Lot ${lot}: moisture must be between 0 and 100.`);
      if (Number(kor) < 0 || Number(kor) > 80) throw new ValidationError(`Lot ${lot}: KOR must be between 0 and 80.`);
      quality.set(l.id, { moisture, kor, nutCount });
    }

    const out = await tx.transferRequest.findMany({ where: { status: "dispatched", id: { not: id } }, select: { id: true, truckNo: true } });
    const clash = out.find((o) => o.truckNo && rig(o.truckNo) === rig(truckNo));
    if (clash) throw new ValidationError(`Truck ${truckNo} is still on ${clash.id}, which hasn't arrived — one BKT is one voyage.`);

    await tx.transferRequest.update({
      where: { id },
      data: {
        status: "dispatched", truckNo, transporter: text(input.transporter), driver: text(input.driver), driverPhone: text(input.driverPhone),
        dispatchedGrossKg: gross, dispatchWhReceiptNo: whReceiptNo, dispatchedAt: new Date(), dispatchedBy: opts.actor?.id ?? null,
      },
    });
    for (const [lineId, q] of quality) await tx.transferRequestLine.update({ where: { id: lineId }, data: q });
    for (const l of t.lines) await timeline(tx, l.receiptId, `Dispatched on ${id} (truck ${truckNo})`, opts);
    return tx.transferRequest.findUniqueOrThrow({ where: { id }, include: INCLUDE });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return toWire(row);
}

/**
 * The receiving warehouse records what actually arrived — bags and gross weight are required, since
 * they are what the variance is. Only a dispatched truck can be received, and only once.
 */
export async function receiveTransfer(id: string, input: ReceiveInput, opts: WriteOpts = {}) {
  const bags = whole(input.bagsReceived, "Bags received");
  if (bags === null) throw new ValidationError("Enter the bags received — it is what the transfer is checked against.");
  const gross = decimal(input.receivedGrossKg, "Gross weight received");
  if (gross === null) throw new ValidationError("Enter the gross weight received at your scale — it is what the transfer is checked against.");
  const damaged = whole(input.damagedBags, "Damaged bags");
  const nutCount = whole(input.nutCountReceived, "Nut count");
  const whReceiptNo = text(input.whReceiptNo);
  if (!whReceiptNo) throw new ValidationError("Enter the warehouse receipt number of this arrival.");

  const row = await prisma.$transaction(async (tx) => {
    const t = await tx.transferRequest.findUnique({ where: { id }, include: { lines: { select: { receiptId: true, bags: true, netWeightKg: true } } } });
    if (!t) throw Object.assign(new Error("Transfer not found"), { code: "P2025" });
    if (t.status === "requested") throw new ValidationError(`Transfer ${id} hasn't been dispatched yet — there is nothing to receive.`);
    if (t.status === "received") throw new ValidationError(`Transfer ${id} was already received.`);
    if (damaged !== null && damaged > bags) throw new ValidationError("More damaged bags than bags received.");
    // What arrived has to match what left, or the receiving warehouse says why: the reason is what a discrepancy is reviewed by.
    const arrival: TransferFacts = {
      status: "received", lines: t.lines.map((l) => ({ bags: l.bags, netWeightKg: num(l.netWeightKg) })),
      dispatchedGrossKg: num(t.dispatchedGrossKg), bagsReceived: bags, receivedGrossKg: Number(gross),
    };
    if (transferState(arrival) === "discrepancy" && !text(input.receivedComment)) {
      const v = transferVariance(arrival);
      const parts = [v.bagVariance ? `${v.bagVariance > 0 ? "+" : ""}${v.bagVariance} bags` : null, v.weightVarianceKg ? `${v.weightVarianceKg > 0 ? "+" : ""}${v.weightVarianceKg} kg` : null].filter(Boolean);
      throw new ValidationError(`What arrived differs from what was sent (${parts.join(", ")}). Say why in the comment: damaged bags, a short load, a weighing difference…`);
    }

    await tx.transferRequest.update({
      where: { id },
      data: {
        status: "received", receiveWhReceiptNo: whReceiptNo, bagsReceived: bags, damagedBags: damaged, receivedGrossKg: gross,
        korReceived: decimal(input.korReceived, "KOR"), moistureReceived: decimal(input.moistureReceived, "Moisture"),
        nutCountReceived: nutCount, receivedComment: text(input.receivedComment), receivedLotNoRaw: text(input.receivedLotNoRaw),
        receivedAt: new Date(), receivedBy: opts.actor?.id ?? null,
      },
    });
    for (const l of t.lines) await timeline(tx, l.receiptId, `Received at ${t.toWarehouse} on ${id}`, opts);
    return tx.transferRequest.findUniqueOrThrow({ where: { id }, include: INCLUDE });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return toWire(row);
}
