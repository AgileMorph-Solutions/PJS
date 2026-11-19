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
 * The decision comes first and is taken on the receipt: "Yes — transfers out" (n-xferdec = "transfer")
 * is what makes a Lot ready to go on a BKT, and "No — stays" keeps it off one.
 *
 * A Lot bigger than one truck goes on several BKTs, a piece on each (Nov 2026: 40 t on a 35 t truck, the
 * other 5 t on the next truck with another Lot). What is left of it is derived from its pieces (contract's
 * lotTransferProgress), and putting more on trucks than the Lot holds is refused.
 */
import { Prisma } from "@prisma/client";
import { yearOf } from "@anagroci/contract/domain/ids";
import type { ReceiptRecord, TransferRequest, TransferStatus } from "@anagroci/contract/types/receipt";
import { canTransferBetween, formatLotPiece, lotPieceProblem, pieceChanged, suggestedPiece, TRANSFER_DIRECTION_MESSAGE, transferDestinationGroups, transferState, transferVariance, type TransferDestination, type TransferFacts } from "@anagroci/contract/domain/transfers";
import { parseQty } from "@anagroci/contract/domain/receiptMath";
import { deriveStatus } from "@anagroci/contract/domain/receiptStatus";
import { prisma } from "../db.js";
import { ValidationError } from "../domain/validation.js";
import { toReceiptRecord } from "../serialize.js";
import { nextTransferId, siteOf, siteTypeOf } from "./ids.js";
import { loadReceiptRow, type WriteOpts } from "./receipts.js";
import { resolveSite } from "../domain/site.js";

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
  /**
   * Per Lot on the truck: the bin at the receiving site it was unloaded into (required), and the bags of it counted
   * off (required when the truck carries several Lots — the truck's net is shared by them).
   */
  lines?: { receiptId: string; binCode?: string | null; bagsReceived?: number | string | null }[];
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
    receivedBinCode: l.receivedBinCode,
    bagsReceived: l.bagsReceived,
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
    toStore: t.toStore,
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
    // Incoming to one store (toStore) belongs to that store's people only, never its siblings'.
    where: site ? { OR: [{ fromWarehouse: { in: site } }, { toWarehouse: { in: site }, OR: [{ toStore: null }, { toStore: { in: site } }] }] } : {},
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

/** Unit to Central only. Checked again at dispatch, so a BKT created before this rule can't leave either. */
async function assertTransferDirection(tx: Tx, from: string, to: string) {
  if (!canTransferBetween(await siteTypeOf(tx, from), await siteTypeOf(tx, to))) throw new ValidationError(TRANSFER_DIRECTION_MESSAGE);
}

/**
 * Each Lot must be at the sending warehouse, actually have a Lot (passed quality), not be rejected, be
 * marked "Yes — transfers out" on its receipt, and still have something left to send: a Lot can go on
 * several BKTs, but never more of it than it holds (lotPieceProblem).
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
        unload: { select: { sacs: true } }, netwt: { select: { netWtKgs: true } },
      },
    });
    if (!receipt) throw new ValidationError(`Receipt ${line.receiptId} doesn't exist.`);
    if ((await siteOf(tx, receipt.warehouse)) !== from) throw new ValidationError(`${line.receiptId} is at ${receipt.warehouse}, not ${from}.`);
    if (!receipt.lot?.lotNumber?.trim()) throw new ValidationError(`${line.receiptId} has no Lot yet — only a truck that passed quality can be transferred.`);
    if (receipt.branches.some((b) => b.stageId === "n-qfs" && b.branchId === "fail")) throw new ValidationError(`${line.receiptId} was rejected and can't be transferred.`);
    if (!receipt.branches.some((b) => b.stageId === "n-xferdec" && b.branchId === "transfer")) {
      throw new ValidationError(`Lot ${receipt.lot.lotNumber} isn't marked for transfer. Choose "Yes — transfers out" on its receipt first.`);
    }
    if (line.bags !== undefined && line.bags !== null && (!Number.isInteger(line.bags) || line.bags < 0)) {
      throw new ValidationError(`Bags "${line.bags}" isn't a whole number.`);
    }
    const net = decimal(line.netWeightKg, "Net weight");
    const onBkts = await tx.transferRequestLine.findMany({ where: { receiptId: line.receiptId, transferId: { not: transferId } }, select: { transferId: true, bags: true, netWeightKg: true }, orderBy: { id: "asc" } });
    // The Lot's size as its own receipt recorded it; a blank or unreadable one leaves nothing to subtract from.
    const size = { bags: parseQty(receipt.unload?.sacs) ?? null, netKg: parseQty(receipt.netwt?.netWtKgs) ?? null };
    const pieces = onBkts.map((p) => ({ transferId: p.transferId, bags: p.bags, netWeightKg: num(p.netWeightKg) }));
    const piece = { bags: line.bags ?? null, netWeightKg: num(net) };
    const problem = lotPieceProblem(receipt.lot.lotNumber, size, pieces, piece);
    if (problem) throw new ValidationError(problem);
    // A changed figure is allowed (it is how a Lot is split) but kept on the Lot's timeline, with who changed it.
    const suggested = suggestedPiece(size, pieces);
    const note = pieceChanged(suggested, piece)
      ? `Added to transfer ${transferId}: ${formatLotPiece(piece)}, changed from ${formatLotPiece(suggested)} (${pieces.length ? "what was left of the Lot" : "the whole Lot"})`
      : `Added to transfer ${transferId}`;

    await tx.transferRequestLine.create({
      data: {
        transferId, receiptId: line.receiptId, bags: line.bags ?? null, netWeightKg: net,
        binCode: text(line.binCode) ?? text(receipt.bin?.binNumber),
      },
    });
    await timeline(tx, line.receiptId, note, opts);
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
    await assertTransferDirection(tx, from, to);
    // Naming a store sends the BKT to its site, and the store is kept alongside.
    const named = await tx.warehouse.findUnique({ where: { name: input.toWarehouse!.trim() }, select: { name: true, site: true } });
    const toStore = named?.site ? named.name : null;

    const id = await nextTransferId(tx, date);
    await tx.transferRequest.create({
      data: { id, transferDate: date, fromWarehouse: from, toWarehouse: to, toStore, remarks: input.remarks?.trim() || null },
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
    await assertTransferDirection(tx, t.fromWarehouse, t.toWarehouse);
    await addLines(tx, id, t.fromWarehouse, lines, opts);
    return tx.transferRequest.findUniqueOrThrow({ where: { id }, include: INCLUDE });
  });
  return toWire(row);
}

/** "1796 GC 01 / 3922-BB-04" and "1796GC01/3922BB04" are the same rig. */
const rig = (truck: string) => truck.toUpperCase().replace(/[\s-]+/g, "");

/**
 * The sending warehouse sends the truck. One BKT is one truck / voyage, so the truck is required and
 * can't already be out on another BKT that hasn't arrived yet. Every dispatch field is required (team
 * decision, Nov 2026): the truck, who drives it, the loaded weight, and each Lot's moisture, KOR and nut count.
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
    await assertTransferDirection(tx, t.fromWarehouse, t.toWarehouse);
    if (!t.lines.length) throw new ValidationError(`Transfer ${id} has no Lots to send.`);
    const missing = [
      !text(input.transporter) && "transporter", !text(input.driver) && "driver", !text(input.driverPhone) && "driver phone", gross === null && "loaded weight",
    ].filter(Boolean);
    if (missing.length) throw new ValidationError(`Fill in the ${missing.join(", ")} to dispatch the truck.`);

    // Every Lot leaves with its quality on the record: re-measured here when given, else its own quality check's result.
    const quality = new Map<number, { moisture: Prisma.Decimal; kor: Prisma.Decimal; nutCount: number | null }>();
    for (const l of t.lines) {
      const given = input.lines?.find((x) => x.receiptId === l.receiptId);
      const r = await tx.receipt.findUnique({
        where: { id: l.receiptId },
        select: { lot: { select: { lotNumber: true } }, qfs: { select: { finalMoistureNum: true, korNum: true, finalKorNum: true, finalNutCountNum: true } } },
      });
      const lot = r?.lot?.lotNumber ?? l.receiptId;
      const moisture = decimal(given?.moisture, "Moisture") ?? r?.qfs?.finalMoistureNum ?? null;
      const kor = decimal(given?.kor, "KOR") ?? r?.qfs?.finalKorNum ?? r?.qfs?.korNum ?? null;
      const nutCount = whole(given?.nutCount, "Nut count") ?? (r?.qfs?.finalNutCountNum === null || r?.qfs?.finalNutCountNum === undefined ? null : Math.round(Number(r.qfs.finalNutCountNum)));
      const absent = moisture === null ? "moisture" : kor === null ? "KOR" : nutCount === null ? "nut count" : null;
      if (absent) throw new ValidationError(`Lot ${lot} has no ${absent} on record from its quality check. Enter the ${absent} for the dispatch.`);
      if (Number(moisture) < 0 || Number(moisture) > 100) throw new ValidationError(`Lot ${lot}: moisture must be between 0 and 100.`);
      if (Number(kor) < 0 || Number(kor) > 80) throw new ValidationError(`Lot ${lot}: KOR must be between 0 and 80.`);
      quality.set(l.id, { moisture: moisture!, kor: kor!, nutCount });
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
 * The bin each Lot was unloaded into at the receiving site. Every Lot needs one — without it the Lot is
 * in no bin and production can't reach it — and it must be a bin in Masters (a production batch is made
 * of master bins) that isn't in another site's store. Bins imported without a store are accepted, as
 * they are everywhere else.
 */
async function receivingBins(
  tx: Tx, toWarehouse: string,
  lines: { receiptId: string; receipt: { lot: { lotNumber: string | null } | null } }[],
  given: { receiptId: string; binCode?: string | null }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const l of lines) {
    const code = text(given.find((g) => g.receiptId === l.receiptId)?.binCode)?.toUpperCase();
    if (!code) throw new ValidationError(`Choose the bin Lot ${l.receipt.lot?.lotNumber ?? l.receiptId} was unloaded into.`);
    out.set(l.receiptId, code);
  }
  const codes = [...new Set(out.values())];
  const [bins, site] = await Promise.all([tx.bin.findMany({ where: { code: { in: codes } }, select: { code: true, warehouseName: true } }), resolveSite(toWarehouse)]);
  const missing = codes.filter((c) => !bins.some((b) => b.code === c));
  if (missing.length) throw new ValidationError(`Not in Masters › Bins: ${missing.join(", ")}. Add the bin there first.`);
  const elsewhere = bins.filter((b) => b.warehouseName && !site.includes(b.warehouseName));
  if (elsewhere.length) throw new ValidationError(elsewhere.map((b) => `${b.code} is in ${b.warehouseName}, not at ${toWarehouse}`).join("; ") + ".");
  return out;
}

const NO_BAGS = "Enter the bags received — it is what the transfer is checked against.";

/**
 * The bags of each Lot counted off the truck, and the truck's total. Counted per Lot, the total is their sum (one
 * figure, typed once); a truck with one Lot may give just the total. With several Lots every count is needed: the
 * truck is weighed once, and its net is shared by them (contract's lineNetAtArrival).
 */
function bagsPerLot(
  lines: { receiptId: string; receipt: { lot: { lotNumber: string | null } | null } }[],
  given: ReadonlyMap<string, number | null>,
  total: number | null,
): { perLot: Map<string, number>; total: number } {
  const counts = lines.map((l) => given.get(l.receiptId) ?? null);
  if (counts.every((c) => c !== null)) {
    const sum = counts.reduce<number>((a, c) => a + c!, 0);
    if (total !== null && total !== sum) throw new ValidationError(`The bags of each Lot add up to ${sum}, but ${total} bags received was entered.`);
    return { perLot: new Map(lines.map((l, i) => [l.receiptId, counts[i]!])), total: sum };
  }
  if (total === null) throw new ValidationError(NO_BAGS);
  if (lines.length === 1) return { perLot: new Map([[lines[0]!.receiptId, total]]), total };
  const missing = lines.filter((_, i) => counts[i] === null).map((l) => l.receipt.lot?.lotNumber ?? l.receiptId);
  throw new ValidationError(`Enter the bags of each Lot counted off the truck (missing: ${missing.join(", ")}). The truck is weighed once, and its weight is shared by them.`);
}

/**
 * The receiving warehouse records what actually arrived — bags (per Lot) and gross weight are required, since
 * they are what the variance is. Only a dispatched truck can be received, and only once.
 */
export async function receiveTransfer(id: string, input: ReceiveInput, opts: WriteOpts = {}) {
  const givenTotal = whole(input.bagsReceived, "Bags received");
  const givenPerLot = new Map((input.lines ?? []).map((l) => [l.receiptId, whole(l.bagsReceived, "Bags received")] as const));
  if (givenTotal === null && ![...givenPerLot.values()].some((b) => b !== null)) throw new ValidationError(NO_BAGS);
  const gross = decimal(input.receivedGrossKg, "Gross weight received");
  if (gross === null) throw new ValidationError("Enter the gross weight received at your scale — it is what the transfer is checked against.");
  const damaged = whole(input.damagedBags, "Damaged bags");
  const nutCount = whole(input.nutCountReceived, "Nut count");
  const whReceiptNo = text(input.whReceiptNo);
  if (!whReceiptNo) throw new ValidationError("Enter the warehouse receipt number of this arrival.");

  const row = await prisma.$transaction(async (tx) => {
    const t = await tx.transferRequest.findUnique({
      where: { id },
      include: { lines: { select: { id: true, receiptId: true, bags: true, netWeightKg: true, receipt: { select: { lot: { select: { lotNumber: true } } } } } } },
    });
    if (!t) throw Object.assign(new Error("Transfer not found"), { code: "P2025" });
    if (t.status === "requested") throw new ValidationError(`Transfer ${id} hasn't been dispatched yet — there is nothing to receive.`);
    if (t.status === "received") throw new ValidationError(`Transfer ${id} was already received.`);
    const binOf = await receivingBins(tx, t.toWarehouse, t.lines, input.lines ?? []);
    const { perLot, total: bags } = bagsPerLot(t.lines, givenPerLot, givenTotal);
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
    for (const l of t.lines) {
      await tx.transferRequestLine.update({ where: { id: l.id }, data: { receivedBinCode: binOf.get(l.receiptId)!, bagsReceived: perLot.get(l.receiptId)! } });
      await timeline(tx, l.receiptId, `Received at ${t.toWarehouse} on ${id}, into ${binOf.get(l.receiptId)}`, opts);
    }
    return tx.transferRequest.findUniqueOrThrow({ where: { id }, include: INCLUDE });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return toWire(row);
}

/**
 * Where a BKT from `from` may go: every Central site (or its stores) in the master but `from` itself — contract's
 * transferDestinationGroups(). Its own read because /api/masters shows a non-admin only their own warehouse, yet a Unit
 * warehouse must still name the Central one (and which of its stores) it is sending to. Names only: nothing else
 * about the other site leaks.
 */
export async function listTransferDestinations(from: string | undefined): Promise<TransferDestination[]> {
  if (!from) return [];
  const rows = await prisma.warehouse.findMany({ select: { name: true, kind: true, type: true, site: true, code: true } });
  // A BKT is sent site to site: from a store, that is its site (never a destination to itself).
  return transferDestinationGroups(rows, (await siteOf(prisma, from)) ?? from);
}
