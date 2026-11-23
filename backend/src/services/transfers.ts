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
 * A truck is loaded Lot by Lot: the person picks the Lots that go on it, and each line keeps its Lot's Bin for reference
 * (team, 22 Nov 2026). Picking a Lot is the decision: one not answered yet is marked "Yes — transfers out" on its receipt
 * as it goes on the BKT. A line can also name only a Bin (addBinLine); the Transfers page doesn't offer that today, but
 * a BKT made that way keeps working.
 *
 * A Lot bigger than one truck goes on several BKTs, a piece on each (Nov 2026: 40 t on a 35 t truck, the
 * other 5 t on the next truck with another Lot). What is left of it is derived from its pieces (contract's
 * lotTransferProgress), and putting more on trucks than the Lot holds is refused.
 */
import { Prisma } from "@prisma/client";
import { yearOf } from "@anagroci/contract/domain/ids";
import type { ReceiptRecord, TransferRequest, TransferStatus } from "@anagroci/contract/types/receipt";
import { canTransferBetween, transferFieldProblem, formatLotPiece, lotPieceProblem, pieceChanged, suggestedPiece, TRANSFER_DIRECTION_MESSAGE, transferDestinationGroups, transferState, transferVariance, type TransferDestination, type TransferFacts, type TransferValueKind } from "@anagroci/contract/domain/transfers";
import { parseQty } from "@anagroci/contract/domain/receiptMath";
import { deriveStatus } from "@anagroci/contract/domain/receiptStatus";
import { prisma } from "../db.js";
import { binWithoutWarehouseMessage, ValidationError } from "../domain/validation.js";
import { toReceiptRecord } from "../serialize.js";
import { nextTransferId, siteOf, siteTypeOf } from "./ids.js";
import { applyBranch, loadReceiptRow, type WriteOpts } from "./receipts.js";
import { resolveSite } from "../domain/site.js";

type Tx = Prisma.TransactionClient;

/** A Bin line (binCode, no receiptId) — how a truck is loaded now — or a Lot line (receiptId), as BKTs were made before. */
export interface TransferLineInput {
  receiptId?: string | null;
  bags?: number | null;
  netWeightKg?: number | string | null;
  /** The Bin it is loaded from: required on a Bin line; on a Lot line, defaults to the Lot's Bin(s). */
  binCode?: string | null;
}

/** Which line of a BKT a per-line value is for: by its id, or — on a Lot line — by its receipt, as older clients send. */
interface LineRef {
  lineId?: number | null;
  receiptId?: string | null;
}
const refersTo = (g: LineRef, l: { id: number; receiptId: string | null }) =>
  (g.lineId !== undefined && g.lineId !== null && Number(g.lineId) === l.id) || (Boolean(g.receiptId) && g.receiptId === l.receiptId);

export interface TransferInput {
  transferDate?: string;
  fromWarehouse?: string;
  toWarehouse?: string;
  remarks?: string | null;
  lines?: TransferLineInput[];
}

/** A line's quality at dispatch: measured for a Bin line; for a Lot line, when re-measured rather than taken from its quality check. */
export interface DispatchLineQuality extends LineRef {
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
   * Per Lot on the truck: the bin at the receiving site it was unloaded into (required), and, optionally, the bags of
   * it counted off — without them the truck's net is shared by the bags each Lot was sent with.
   */
  lines?: (LineRef & { binCode?: string | null; bagsReceived?: number | string | null })[];
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
    id: l.id,
    receiptId: l.receiptId,
    lotNumber: l.receipt?.lot?.lotNumber ?? null,
    supplierName: l.receipt?.supplierName ?? "",
    vehicleNo: l.receipt?.vehicleNo ?? "",
    fiche: l.receipt?.verify?.fiche ?? null,
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

/** The form checks the dispatch and arrival forms show as they are typed (contract transferFieldProblem); numbers are decimal()/whole()'s. */
function formCheck(values: [TransferValueKind, string, string | null | undefined][]) {
  for (const [kind, label, value] of values) {
    const problem = transferFieldProblem(kind, value);
    if (problem) throw new ValidationError(`${label} "${value}": ${problem}`);
  }
}

/** Unit to Central only. Checked again at dispatch, so a BKT created before this rule can't leave either. */
async function assertTransferDirection(tx: Tx, from: string, to: string) {
  if (!canTransferBetween(await siteTypeOf(tx, from), await siteTypeOf(tx, to))) throw new ValidationError(TRANSFER_DIRECTION_MESSAGE);
}

/** "Bin BIN-012" / "Lot LOT-…": how a line is named in a message. */
const lineName = (l: { receiptId: string | null; binCode: string | null; receipt?: { lot: { lotNumber: string | null } | null } | null }) =>
  l.receiptId ? `Lot ${l.receipt?.lot?.lotNumber ?? l.receiptId}` : `Bin ${l.binCode ?? "?"}`;

/**
 * A Bin line: a Bin of the sending warehouse (Masters › Bins), once per BKT, with the bags and net kg taken from it — both
 * required, since they are what leaves the Bin's stock and what the arrival is compared with. Sending more than the Bin
 * shows isn't refused: its stock is worked out from records that may be incomplete, so the page warns instead.
 */
async function addBinLine(tx: Tx, transferId: string, from: string, line: TransferLineInput) {
  const code = text(line.binCode)?.toUpperCase();
  if (!code) throw new ValidationError("Choose the Bin the truck is loaded from.");
  const bin = await tx.bin.findUnique({ where: { code }, select: { code: true, warehouseName: true } });
  if (!bin) throw new ValidationError(`Bin "${code}" isn't in the Bin master — add it in Masters › Bins first.`);
  if (!bin.warehouseName) throw new ValidationError(binWithoutWarehouseMessage(code));
  if ((await siteOf(tx, bin.warehouseName)) !== from) throw new ValidationError(`Bin ${code} is in ${bin.warehouseName}, not at ${from}.`);
  if (await tx.transferRequestLine.findFirst({ where: { transferId, receiptId: null, binCode: code }, select: { id: true } })) {
    throw new ValidationError(`Bin ${code} is already on this transfer.`);
  }
  const bags = whole(line.bags ?? null, "Bags");
  const net = decimal(line.netWeightKg, "Net weight");
  if (bags === null || bags === 0) throw new ValidationError(`Enter the bags loaded from Bin ${code}.`);
  if (net === null || Number(net) <= 0) throw new ValidationError(`Enter the net kg loaded from Bin ${code}.`);
  await tx.transferRequestLine.create({ data: { transferId, receiptId: null, binCode: code, bags, netWeightKg: net } });
}

/**
 * Each line is a Lot, or a Bin (addBinLine). A Lot must be at the sending warehouse, actually have a Lot (passed quality),
 * not be rejected, be in a Bin with its GRN complete (picking it marks "Yes — transfers out" on its receipt) or already
 * marked so, and still have something left to send: a Lot can go on several BKTs, but never more of it than it holds
 * (lotPieceProblem).
 */
async function addLines(tx: Tx, transferId: string, from: string, lines: TransferLineInput[], opts: WriteOpts) {
  const ids = lines.flatMap((l) => (l.receiptId ? [l.receiptId] : []));
  if (new Set(ids).size !== ids.length) throw new ValidationError("The same Lot is listed twice on this transfer.");
  const bins = lines.flatMap((l) => (l.receiptId ? [] : [text(l.binCode)?.toUpperCase() ?? ""]));
  if (new Set(bins).size !== bins.length) throw new ValidationError("The same Bin is listed twice on this transfer.");
  for (const line of lines) {
    if (!line.receiptId) { await addBinLine(tx, transferId, from, line); continue; }
    const receiptId = line.receiptId;
    const receipt = await tx.receipt.findUnique({
      where: { id: receiptId },
      select: {
        warehouse: true, lot: { select: { lotNumber: true } }, bin: { select: { binNumber: true } },
        branches: { select: { stageId: true, branchId: true } },
        unload: { select: { sacs: true } }, netwt: { select: { netWtKgs: true } },
      },
    });
    if (!receipt) throw new ValidationError(`Receipt ${receiptId} doesn't exist.`);
    if ((await siteOf(tx, receipt.warehouse)) !== from) throw new ValidationError(`${receiptId} is at ${receipt.warehouse}, not ${from}.`);
    if (!receipt.lot?.lotNumber?.trim()) throw new ValidationError(`${receiptId} has no Lot yet — only a truck that passed quality can be transferred.`);
    if (receipt.branches.some((b) => b.stageId === "n-qfs" && b.branchId === "fail")) throw new ValidationError(`${receiptId} was rejected and can't be transferred.`);
    // Picking the Lot is the decision (contract readyForTransfer): an unanswered one is marked "Yes — transfers out" here,
    // through the same rules as answering it on the receipt (GRN complete, a Unit warehouse). An earlier "No" stands.
    const answer = receipt.branches.find((b) => b.stageId === "n-xferdec")?.branchId;
    if (answer && answer !== "transfer") {
      throw new ValidationError(`Lot ${receipt.lot.lotNumber} is marked to stay at this warehouse, so it can't go on a transfer.`);
    }
    // Already answered "Yes" or not, a Lot whose Bin isn't known can't be loaded onto a truck (contract readyForTransfer).
    if (!receipt.bin?.binNumber?.trim()) throw new ValidationError(`Lot ${receipt.lot.lotNumber} isn't in a Bin yet — record its Bin on the receipt, then it can go on a transfer.`);
    if (!answer) await applyBranch(tx, receiptId, "n-xferdec", "transfer", undefined, opts);
    if (line.bags !== undefined && line.bags !== null && (!Number.isInteger(line.bags) || line.bags < 0)) {
      throw new ValidationError(`Bags "${line.bags}" isn't a whole number.`);
    }
    const net = decimal(line.netWeightKg, "Net weight");
    const onBkts = await tx.transferRequestLine.findMany({ where: { receiptId, transferId: { not: transferId } }, select: { transferId: true, bags: true, netWeightKg: true }, orderBy: { id: "asc" } });
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
        transferId, receiptId, bags: line.bags ?? null, netWeightKg: net,
        binCode: text(line.binCode) ?? text(receipt.bin?.binNumber),
      },
    });
    await timeline(tx, receiptId, note, opts);
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
  if (!input.lines?.length) throw new ValidationError("A transfer needs at least one Bin.");

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
  if (!lines.length) throw new ValidationError("Add at least one Bin.");
  const row = await prisma.$transaction(async (tx) => {
    const t = await tx.transferRequest.findUnique({ where: { id } });
    if (!t) throw Object.assign(new Error("Transfer not found"), { code: "P2025" });
    if (t.status !== "requested") throw new ValidationError(`Transfer ${id} is already ${t.status} — nothing can be added now.`);
    await assertTransferDirection(tx, t.fromWarehouse, t.toWarehouse);
    await addLines(tx, id, t.fromWarehouse, lines, opts);
    return tx.transferRequest.findUniqueOrThrow({ where: { id }, include: INCLUDE });
  });
  return toWire(row);
}

/**
 * The truck is still out on another BKT that hasn't been received. Carries that BKT so the route can say which one — but
 * only to someone allowed to see it (routes/transfers.ts); the message here is the full one, for an admin or a script.
 */
export class TruckOnTheRoadError extends ValidationError {
  constructor(readonly truckNo: string, readonly clash: { id: string; fromWarehouse: string; toWarehouse: string; toStore: string | null }) {
    super(truckOnTheRoadMessage(truckNo, clash));
  }
}

export function truckOnTheRoadMessage(truckNo: string, clash?: { id: string; toWarehouse: string; toStore: string | null }): string {
  return clash
    ? `Truck ${truckNo} can't be dispatched yet: it is still on ${clash.id}, which hasn't been received at ${clash.toStore ?? clash.toWarehouse}. ` +
        `A truck carries one BKT at a time. Record the arrival on ${clash.id} first, or check the truck number.`
    : `Truck ${truckNo} can't be dispatched yet: it is still on another warehouse's BKT, which hasn't been received. ` +
        "A truck carries one BKT at a time. Check the truck number, or ask that warehouse to record the arrival.";
}

/** The site names whose Transfers list holds this BKT: the sender's and the destination's (a store reads as its site). */
export async function transferSites(t: { fromWarehouse: string; toWarehouse: string }): Promise<string[]> {
  const sites = await Promise.all([siteOf(prisma, t.fromWarehouse), siteOf(prisma, t.toWarehouse)]);
  return [...new Set(sites.filter((s): s is string => Boolean(s)))];
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
  formCheck([["receiptNo", "Warehouse receipt no.", whReceiptNo], ["name", "Transporter", input.transporter]]);
  const gross = decimal(input.dispatchedGrossKg, "Loaded weight");

  const row = await prisma.$transaction(async (tx) => {
    const t = await tx.transferRequest.findUnique({ where: { id }, include: { lines: { select: { id: true, receiptId: true, binCode: true } } } });
    if (!t) throw Object.assign(new Error("Transfer not found"), { code: "P2025" });
    if (t.status !== "requested") throw new ValidationError(`Transfer ${id} is already ${t.status}.`);
    await assertTransferDirection(tx, t.fromWarehouse, t.toWarehouse);
    if (!t.lines.length) throw new ValidationError(`Transfer ${id} has nothing on it to send.`);
    const missing = [
      !text(input.transporter) && "transporter", !text(input.driver) && "driver", !text(input.driverPhone) && "driver phone", gross === null && "loaded weight",
    ].filter(Boolean);
    if (missing.length) throw new ValidationError(`Fill in the ${missing.join(", ")} to dispatch the truck.`);

    // Everything leaves with its quality on the record. A Bin's is measured at dispatch: the Bin mixes Lots, so no one quality
    // check speaks for it. A Lot line takes its own quality check's result unless re-measured here.
    const quality = new Map<number, { moisture: Prisma.Decimal; kor: Prisma.Decimal; nutCount: number | null }>();
    for (const l of t.lines) {
      const given = input.lines?.find((x) => refersTo(x, l));
      const r = l.receiptId
        ? await tx.receipt.findUnique({
          where: { id: l.receiptId },
          select: { lot: { select: { lotNumber: true } }, qfs: { select: { finalMoistureNum: true, korNum: true, finalKorNum: true, finalNutCountNum: true } } },
        })
        : null;
      const name = l.receiptId ? `Lot ${r?.lot?.lotNumber ?? l.receiptId}` : `Bin ${l.binCode}`;
      const moisture = decimal(given?.moisture, "Moisture") ?? r?.qfs?.finalMoistureNum ?? null;
      const kor = decimal(given?.kor, "KOR") ?? r?.qfs?.finalKorNum ?? r?.qfs?.korNum ?? null;
      const nutCount = whole(given?.nutCount, "Nut count") ?? (r?.qfs?.finalNutCountNum === null || r?.qfs?.finalNutCountNum === undefined ? null : Math.round(Number(r.qfs.finalNutCountNum)));
      const absent = moisture === null ? "moisture" : kor === null ? "KOR" : nutCount === null ? "nut count" : null;
      if (absent) {
        throw new ValidationError(l.receiptId
          ? `${name} has no ${absent} on record from its quality check. Enter the ${absent} for the dispatch.`
          : `Enter the ${absent} of ${name} for the dispatch.`);
      }
      if (Number(moisture) < 0 || Number(moisture) > 100) throw new ValidationError(`${name}: moisture must be between 0 and 100.`);
      if (Number(kor) < 0 || Number(kor) > 80) throw new ValidationError(`${name}: KOR must be between 0 and 80.`);
      quality.set(l.id, { moisture: moisture!, kor: kor!, nutCount });
    }

    const out = await tx.transferRequest.findMany({
      where: { status: "dispatched", id: { not: id } }, select: { id: true, truckNo: true, fromWarehouse: true, toWarehouse: true, toStore: true },
    });
    const clash = out.find((o) => o.truckNo && rig(o.truckNo) === rig(truckNo));
    if (clash) throw new TruckOnTheRoadError(truckNo, clash);

    await tx.transferRequest.update({
      where: { id },
      data: {
        status: "dispatched", truckNo, transporter: text(input.transporter), driver: text(input.driver), driverPhone: text(input.driverPhone),
        dispatchedGrossKg: gross, dispatchWhReceiptNo: whReceiptNo, dispatchedAt: new Date(), dispatchedBy: opts.actor?.id ?? null,
      },
    });
    for (const [lineId, q] of quality) await tx.transferRequestLine.update({ where: { id: lineId }, data: q });
    for (const l of t.lines) if (l.receiptId) await timeline(tx, l.receiptId, `Dispatched on ${id} (truck ${truckNo})`, opts);
    return tx.transferRequest.findUniqueOrThrow({ where: { id }, include: INCLUDE });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return toWire(row);
}

/**
 * The bin each Lot was unloaded into at the receiving site. Every Lot needs one — without it the Lot is
 * in no bin and production can't reach it — and it must be a bin in Masters (a production batch is made
 * of master bins) of the receiving site. A bin with no warehouse yet is refused until an admin sets one: Bouaké's and
 * Yakro's bins are separate sets, and accepting unowned ones let a truck at Yakro be put in a Bouaké bin.
 */
type ReceivedLine = { id: number; receiptId: string | null; binCode: string | null; receipt: { lot: { lotNumber: string | null } | null } | null };

async function receivingBins(
  tx: Tx, toWarehouse: string,
  lines: ReceivedLine[],
  given: (LineRef & { binCode?: string | null })[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (const l of lines) {
    const code = text(given.find((g) => refersTo(g, l))?.binCode)?.toUpperCase();
    if (!code) throw new ValidationError(`Choose the bin ${l.receiptId ? lineName(l) : `the RCN from ${lineName(l)}`} was unloaded into.`);
    out.set(l.id, code);
  }
  const codes = [...new Set(out.values())];
  const [bins, site] = await Promise.all([tx.bin.findMany({ where: { code: { in: codes } }, select: { code: true, warehouseName: true } }), resolveSite(toWarehouse)]);
  const missing = codes.filter((c) => !bins.some((b) => b.code === c));
  if (missing.length) throw new ValidationError(`Not in Masters › Bins: ${missing.join(", ")}. Add the bin there first.`);
  const unowned = bins.filter((b) => !b.warehouseName);
  if (unowned.length) throw new ValidationError(unowned.map((b) => binWithoutWarehouseMessage(b.code)).join(" "));
  const elsewhere = bins.filter((b) => b.warehouseName && !site.includes(b.warehouseName));
  if (elsewhere.length) throw new ValidationError(elsewhere.map((b) => `${b.code} is in ${b.warehouseName}, not at ${toWarehouse}`).join("; ") + ".");
  return out;
}

const NO_BAGS = "Enter the bags received — it is what the transfer is checked against.";

/**
 * The bags of each Lot counted off the truck, and the truck's total. Counted per Lot, the total is their sum (one
 * figure, typed once). Or just the truck's total, as the client's receiving sheet records it (one row per truck): the
 * Lots then have no count of their own (null), and the truck's net is shared by the bags each was sent with
 * (contract's lineNetAtArrival). A Lot alone on its truck takes the total.
 */
function bagsPerLot(
  lines: ReceivedLine[],
  given: readonly (LineRef & { bags: number | null })[],
  total: number | null,
): { perLot: Map<number, number | null>; total: number } {
  const counts = lines.map((l) => given.find((g) => refersTo(g, l))?.bags ?? null);
  if (counts.every((c) => c !== null)) {
    const sum = counts.reduce<number>((a, c) => a + c!, 0);
    if (total !== null && total !== sum) throw new ValidationError(`The bags of each line add up to ${sum}, but ${total} bags received was entered.`);
    return { perLot: new Map(lines.map((l, i) => [l.id, counts[i]!])), total: sum };
  }
  if (total === null) throw new ValidationError(NO_BAGS);
  if (lines.length === 1) return { perLot: new Map([[lines[0]!.id, total]]), total };
  return { perLot: new Map(lines.map((l) => [l.id, null])), total };
}

/**
 * The receiving warehouse records what actually arrived — bags (per Lot) and gross weight are required, since
 * they are what the variance is. Only a dispatched truck can be received, and only once.
 */
export async function receiveTransfer(id: string, input: ReceiveInput, opts: WriteOpts = {}) {
  const givenTotal = whole(input.bagsReceived, "Bags received");
  const givenPerLot = (input.lines ?? []).map((l) => ({ lineId: l.lineId, receiptId: l.receiptId, bags: whole(l.bagsReceived, "Bags received") }));
  if (givenTotal === null && !givenPerLot.some((b) => b.bags !== null)) throw new ValidationError(NO_BAGS);
  const gross = decimal(input.receivedGrossKg, "Gross weight received");
  if (gross === null) throw new ValidationError("Enter the gross weight received at your scale — it is what the transfer is checked against.");
  const damaged = whole(input.damagedBags, "Damaged bags");
  const nutCount = whole(input.nutCountReceived, "Nut count");
  const whReceiptNo = text(input.whReceiptNo);
  if (!whReceiptNo) throw new ValidationError("Enter the warehouse receipt number of this arrival.");
  formCheck([["receiptNo", "Warehouse receipt no.", whReceiptNo]]);

  const row = await prisma.$transaction(async (tx) => {
    const t = await tx.transferRequest.findUnique({
      where: { id },
      include: { lines: { select: { id: true, receiptId: true, binCode: true, bags: true, netWeightKg: true, receipt: { select: { lot: { select: { lotNumber: true } } } } } } },
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
      await tx.transferRequestLine.update({ where: { id: l.id }, data: { receivedBinCode: binOf.get(l.id)!, bagsReceived: perLot.get(l.id) ?? null } });
      if (l.receiptId) await timeline(tx, l.receiptId, `Received at ${t.toWarehouse} on ${id}, into ${binOf.get(l.id)}`, opts);
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
