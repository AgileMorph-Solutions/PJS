/**
 * An Admin correcting a BKT after it was made (25 Nov 2026), and the Warehouse Incharge their own warehouse's half of it (26 Nov
 * 2026, editHalves). Before, a BKT
 * could only be created, have lots added before dispatch, be dispatched and be received: a wrong truck number or bag count
 * meant making a new BKT.
 *
 * Every value is checked as it was when first entered (the same refusals as creating and dispatching: a lot can't have more
 * bags on trucks than it holds, one truck and one driver on the road at a time…). What is worked out from the BKT — the Bins'
 * stock, a lot's "left to load", the variance and state — follows by itself. What another record COPIED from it follows too:
 * the truck number on each lot's reception at the receiving warehouse, unless that reception is closed (its GRN complete),
 * which refuses the change and names it. The change log records every field changed (db.ts's query hook).
 */
import { Prisma } from "@prisma/client";
import { yearOf } from "@anagroci/contract/domain/ids";
import { driverPhoneProblem, lotPieceProblem, normalizeName, normalizePhone, normalizeTruckNo } from "@anagroci/contract/domain/transfers";
import { lotLeft, lotNetKg, lotPieceProblem as transferLotPieceProblem, pieceNetKg, pieceWeightProblem, readNumber } from "@anagroci/contract/domain/transferLot";
import { parseQty } from "@anagroci/contract/domain/receiptMath";
import { prisma } from "../db.js";
import { ValidationError } from "../domain/validation.js";
import { siteOf } from "./ids.js";
import { applyStageFields, type WriteOpts } from "./receipts.js";
import {
  assertTransferDirection, assertTruckAndDriverFree, decimal, formCheck, INCLUDE, receivingBins, refersTo, text, timeline, toWire, whole,
  type LineRef,
} from "./transfers.js";

type Tx = Prisma.TransactionClient;

/** What may be changed on a BKT. Anything left out stays as it is. */
export interface TransferEdit {
  transferDate?: string;
  remarks?: string | null;
  /** The receiving warehouse (or one of its stores), while no lot on it has started its reception there. */
  toWarehouse?: string;
  /** The dispatch, once the truck has left. */
  truckNo?: string;
  transporter?: string | null;
  driver?: string | null;
  driverPhone?: string | null;
  dispatchedGrossKg?: number | string | null;
  dispatchWhReceiptNo?: string | null;
  /** Per line: what left on it, and — on a BKT received as a whole truck before receptions — what arrived. */
  lines?: (LineRef & {
    bags?: number | string | null;
    /** Blank on a lot's line: the weight goes back to its share of the lot's weighing. */
    netWeightKg?: number | string | null;
    moisture?: number | string | null;
    kor?: number | string | null;
    nutCount?: number | string | null;
    receivedBinCode?: string | null;
    bagsReceived?: number | string | null;
  })[];
  /** Lines taken off the truck: never one whose reception has started, and never the last one. */
  removeLines?: number[];
  /** The arrival of a BKT received as a whole truck (before receptions, 24 Nov 2026). */
  receiveWhReceiptNo?: string | null;
  damagedBags?: number | string | null;
  receivedGrossKg?: number | string | null;
  korReceived?: number | string | null;
  moistureReceived?: number | string | null;
  nutCountReceived?: number | string | null;
  receivedComment?: string | null;
}

const has = <K extends keyof TransferEdit>(input: TransferEdit, key: K) => Object.prototype.hasOwnProperty.call(input, key);

/** The arrival half of a BKT: what the receiving warehouse recorded. Everything else is the sending warehouse's. */
const RECEIVING_KEYS: readonly (keyof TransferEdit)[] = ["receiveWhReceiptNo", "damagedBags", "receivedGrossKg", "korReceived", "moistureReceived", "nutCountReceived", "receivedComment"];
const RECEIVING_LINE_KEYS = ["receivedBinCode", "bagsReceived"] as const;

/**
 * Which halves of a BKT an edit touches (26 Nov 2026): the Warehouse Incharge corrects only their own warehouse's half —
 * the sending one what left, the receiving one what arrived — and an Admin either. The route checks each against the caller.
 */
export function editHalves(input: TransferEdit): { sending: boolean; receiving: boolean } {
  const keys = Object.keys(input) as (keyof TransferEdit)[];
  const lineKeys = (input.lines ?? []).flatMap((l) => Object.keys(l).filter((k) => k !== "lineId" && k !== "receiptId"));
  return {
    sending: keys.some((k) => k !== "lines" && !RECEIVING_KEYS.includes(k)) || lineKeys.some((k) => !(RECEIVING_LINE_KEYS as readonly string[]).includes(k)),
    receiving: keys.some((k) => RECEIVING_KEYS.includes(k)) || lineKeys.some((k) => (RECEIVING_LINE_KEYS as readonly string[]).includes(k)),
  };
}

const EDIT_INCLUDE = {
  lines: {
    orderBy: { id: "asc" },
    include: {
      transferLot: { include: { bins: { select: { bags: true } }, lines: { select: { id: true, bags: true } }, returns: { select: { bags: true } } } },
      receipt: { select: { lot: { select: { lotNumber: true } }, unload: { select: { sacs: true } }, netwt: { select: { netWtKgs: true } } } },
      reception: { select: { id: true, lockedAt: true, vehicleNo: true } },
    },
  },
} as const;
type EditRow = Prisma.TransferRequestGetPayload<{ include: typeof EDIT_INCLUDE }>;
type EditLine = EditRow["lines"][number];

const lineName = (l: EditLine) =>
  l.transferLot ? `Lot ${l.transferLot.lotNo}` : l.receiptId ? `Lot ${l.receipt?.lot?.lotNumber ?? l.receiptId}` : `Bin ${l.binCode ?? "?"}`;

/** Quality as dispatch checks it (services/transfers.ts dispatchTransfer). */
function quality(l: EditLine, given: NonNullable<TransferEdit["lines"]>[number]): Prisma.TransferRequestLineUncheckedUpdateInput {
  const out: Prisma.TransferRequestLineUncheckedUpdateInput = {};
  const name = lineName(l);
  if (given.moisture !== undefined) {
    const m = decimal(given.moisture, `Moisture of ${name}`);
    if (m === null || Number(m) < 0 || Number(m) > 100) throw new ValidationError(`${name}: moisture must be between 0 and 100.`);
    out.moisture = m;
  }
  if (given.kor !== undefined) {
    const k = decimal(given.kor, `KOR of ${name}`);
    if (k === null || Number(k) < 0 || Number(k) > 80) throw new ValidationError(`${name}: KOR must be between 0 and 80.`);
    out.kor = k;
  }
  if (given.nutCount !== undefined) {
    const n = whole(given.nutCount, `Nut count of ${name}`);
    if (n === null || n <= 0) throw new ValidationError(`${name}: nut count must be more than 0.`);
    out.nutCount = n;
  }
  return out;
}

/** What left on one line: its bags (never more than its lot has left) and its net weight. */
async function whatLeft(tx: Tx, l: EditLine, given: NonNullable<TransferEdit["lines"]>[number]): Promise<Prisma.TransferRequestLineUncheckedUpdateInput> {
  const out: Prisma.TransferRequestLineUncheckedUpdateInput = {};
  const name = lineName(l);
  const lot = l.transferLot;
  const bags = given.bags === undefined ? l.bags : readNumber(given.bags);
  if (given.bags !== undefined) {
    if (lot) {
      // What the lot holds less what its OTHER lines took: this line may have up to that.
      const others = lot.lines.filter((x) => x.id !== l.id).map((x) => ({ bags: x.bags ?? 0 }));
      const { leftBags } = lotLeft(lot.bins.reduce((a, b) => a + b.bags, 0), null, others, lot.returns);
      const problem = transferLotPieceProblem(given.bags ?? "", leftBags);
      if (problem) throw new ValidationError(`Bags of ${name}: ${problem.message}`);
      out.bags = readNumber(given.bags)!;
    } else {
      const n = whole(given.bags, `Bags of ${name}`);
      if (n === null || n === 0) throw new ValidationError(`Enter the bags of ${name}.`);
      out.bags = n;
    }
  }
  if (given.netWeightKg !== undefined) {
    const blank = given.netWeightKg === null || String(given.netWeightKg).trim() === "";
    if (lot) {
      // Left blank, the weight is the lot's share by bags again: it follows the lot rather than freezing a copy.
      if (blank) out.netWeightKg = null;
      else {
        const lotBags = lot.bins.reduce((a, b) => a + b.bags, 0);
        const problem = pieceWeightProblem(given.netWeightKg!, pieceNetKg(lotNetKg(lot.grossWeightKg === null ? null : Number(lot.grossWeightKg), lotBags), lotBags, bags ?? 0));
        if (problem && !problem.soft) throw new ValidationError(`Weight of ${name}: ${problem.message}`);
        out.netWeightKg = new Prisma.Decimal(readNumber(given.netWeightKg)!);
      }
    } else {
      const net = decimal(given.netWeightKg, `Net weight of ${name}`);
      if (net === null || Number(net) <= 0) throw new ValidationError(`Enter the net kg of ${name}.`);
      out.netWeightKg = net;
    }
  }
  // A Lot line (BKTs made per Lot): never more of the Lot on trucks than it holds, counting its pieces on other BKTs.
  if (l.receiptId && (given.bags !== undefined || given.netWeightKg !== undefined)) {
    const onBkts = await tx.transferRequestLine.findMany({ where: { receiptId: l.receiptId, id: { not: l.id } }, select: { transferId: true, bags: true, netWeightKg: true } });
    const size = { bags: parseQty(l.receipt?.unload?.sacs) ?? null, netKg: parseQty(l.receipt?.netwt?.netWtKgs) ?? null };
    const piece = {
      bags: (out.bags as number | undefined) ?? l.bags,
      netWeightKg: out.netWeightKg !== undefined ? Number(out.netWeightKg) : l.netWeightKg === null ? null : Number(l.netWeightKg),
    };
    const problem = lotPieceProblem(l.receipt?.lot?.lotNumber ?? l.receiptId, size, onBkts.map((p) => ({ transferId: p.transferId, bags: p.bags, netWeightKg: p.netWeightKg === null ? null : Number(p.netWeightKg) })), piece);
    if (problem) throw new ValidationError(problem);
  }
  return out;
}

/** Correct a BKT. Admin only (routes/transfers.ts). One transaction: all of it is saved, or none. */
export async function editTransfer(id: string, input: TransferEdit, opts: WriteOpts = {}) {
  const row = await prisma.$transaction(async (tx) => {
    const t = await tx.transferRequest.findUnique({ where: { id }, include: EDIT_INCLUDE });
    if (!t) throw Object.assign(new Error("Transfer not found"), { code: "P2025" });
    const started = t.lines.some((l) => l.reception);
    const data: Prisma.TransferRequestUncheckedUpdateInput = {};

    if (has(input, "transferDate")) {
      const date = (input.transferDate ?? "").trim();
      if (yearOf(date) === undefined) throw new ValidationError("Date: enter the date (YYYY-MM-DD).");
      // The year is in the BKT's number: a date in another year would make the number say something else.
      if (yearOf(date) !== yearOf(t.transferDate)) throw new ValidationError(`The year is part of the number ${id}: keep the date in ${yearOf(t.transferDate)}, or make a new BKT.`);
      data.transferDate = date;
    }
    if (has(input, "remarks")) data.remarks = text(input.remarks);

    if (has(input, "toWarehouse")) {
      const name = (input.toWarehouse ?? "").trim();
      const to = name ? await siteOf(tx, name) : null;
      if (!to) throw new ValidationError(`Warehouse "${name}" isn't in the warehouse master.`);
      if (to !== t.toWarehouse || name !== (t.toStore ?? t.toWarehouse)) {
        if (started || t.status === "received") throw new ValidationError(`${id} has already arrived at ${t.toStore ?? t.toWarehouse}, so where it goes can't be changed now.`);
        if (to === t.fromWarehouse) throw new ValidationError("A transfer must go to a different warehouse.");
        await assertTransferDirection(tx, t.fromWarehouse, to);
        const named = await tx.warehouse.findUnique({ where: { name }, select: { site: true } });
        data.toWarehouse = to;
        data.toStore = named?.site ? name : null;
      }
    }

    // The dispatch half: only once the truck has left (before that, Dispatch records it).
    const DISPATCH = ["truckNo", "transporter", "driver", "driverPhone", "dispatchedGrossKg", "dispatchWhReceiptNo"] as const;
    const oldTruck = t.truckNo;
    let newTruck: string | null = null;
    if (DISPATCH.some((k) => has(input, k))) {
      if (t.status === "requested") throw new ValidationError(`${id} hasn't been dispatched yet: record the truck by dispatching it.`);
      if (has(input, "truckNo")) {
        const truck = normalizeTruckNo(input.truckNo);
        if (!truck) throw new ValidationError("A BKT is one truck: its truck number can't be empty.");
        if (truck !== t.truckNo) { data.truckNo = truck; newTruck = truck; }
      }
      if (has(input, "dispatchWhReceiptNo")) {
        const wr = text(input.dispatchWhReceiptNo);
        if (!wr) throw new ValidationError("A dispatch is recorded against a warehouse receipt number: it can't be empty.");
        formCheck([["receiptNo", "Warehouse receipt no.", wr]]);
        data.dispatchWhReceiptNo = wr;
      }
      if (has(input, "transporter")) {
        if (!text(input.transporter)) throw new ValidationError("The transporter can't be empty.");
        formCheck([["name", "Transporter", input.transporter]]);
        data.transporter = normalizeName(input.transporter) || null;
      }
      if (has(input, "driver")) {
        if (!text(input.driver)) throw new ValidationError("The driver can't be empty.");
        data.driver = normalizeName(input.driver) || null;
      }
      if (has(input, "driverPhone")) {
        if (!text(input.driverPhone)) throw new ValidationError("The driver's phone can't be empty.");
        const p = driverPhoneProblem(input.driverPhone);
        if (p && !p.soft) throw new ValidationError(`Driver phone: ${p.message}`);
        data.driverPhone = normalizePhone(input.driverPhone) || null;
      }
      if (has(input, "dispatchedGrossKg")) {
        const g = decimal(input.dispatchedGrossKg, "Loaded weight");
        if (g === null || Number(g) <= 0) throw new ValidationError("Loaded weight: Should be more than 0.");
        data.dispatchedGrossKg = g;
      }
      // Still on the road with another truck or driver now: the same rule as dispatching.
      if ((data.truckNo || data.driver || data.driverPhone) && t.status === "dispatched" && !started) {
        await assertTruckAndDriverFree(tx, id, t.fromWarehouse, (data.truckNo as string | undefined) ?? t.truckNo ?? "", {
          driver: (data.driver as string | null | undefined) ?? t.driver, driverPhone: (data.driverPhone as string | null | undefined) ?? t.driverPhone,
        });
      }
    }

    // The arrival of a BKT received as a whole truck. One received lot by lot is corrected on each lot's reception record.
    const ARRIVAL = ["receiveWhReceiptNo", "damagedBags", "receivedGrossKg", "korReceived", "moistureReceived", "nutCountReceived", "receivedComment"] as const;
    const arrivalLines = (input.lines ?? []).some((g) => g.receivedBinCode !== undefined || g.bagsReceived !== undefined);
    if (ARRIVAL.some((k) => has(input, k)) || arrivalLines) {
      if (started) throw new ValidationError(`${id} is received lot by lot: correct what arrived on each lot's reception record at ${t.toStore ?? t.toWarehouse}.`);
      if (t.status !== "received") throw new ValidationError(`${id} hasn't arrived yet: there is no arrival to correct.`);
      if (has(input, "receiveWhReceiptNo")) {
        const wr = text(input.receiveWhReceiptNo);
        if (!wr) throw new ValidationError("The arrival's warehouse receipt number can't be empty.");
        formCheck([["receiptNo", "Warehouse receipt no.", wr]]);
        data.receiveWhReceiptNo = wr;
      }
      if (has(input, "receivedGrossKg")) {
        const g = decimal(input.receivedGrossKg, "Gross weight received");
        if (g === null) throw new ValidationError("The gross weight received can't be empty: it is what the transfer is checked against.");
        data.receivedGrossKg = g;
      }
      if (has(input, "damagedBags")) data.damagedBags = whole(input.damagedBags, "Damaged bags");
      if (has(input, "korReceived")) data.korReceived = decimal(input.korReceived, "KOR");
      if (has(input, "moistureReceived")) data.moistureReceived = decimal(input.moistureReceived, "Moisture");
      if (has(input, "nutCountReceived")) data.nutCountReceived = whole(input.nutCountReceived, "Nut count");
      if (has(input, "receivedComment")) data.receivedComment = text(input.receivedComment);
    }

    // Lines: what left on each, and (whole-truck arrivals) what arrived of it.
    const lineUpdates = new Map<number, Prisma.TransferRequestLineUncheckedUpdateInput>();
    for (const given of input.lines ?? []) {
      const l = t.lines.find((x) => refersTo(given, x));
      if (!l) throw new ValidationError(`That line isn't on ${id}.`);
      const update = { ...(await whatLeft(tx, l, given)), ...quality(l, given) };
      if (given.receivedBinCode !== undefined) {
        const bin = (await receivingBins(tx, t.toWarehouse, [l], [{ lineId: l.id, binCode: given.receivedBinCode }])).get(l.id)!;
        update.receivedBinCode = bin;
      }
      if (given.bagsReceived !== undefined) update.bagsReceived = whole(given.bagsReceived, `Bags received of ${lineName(l)}`);
      if (Object.keys(update).length) lineUpdates.set(l.id, update);
    }

    const removing = [...new Set(input.removeLines ?? [])];
    for (const lineId of removing) {
      const l = t.lines.find((x) => x.id === Number(lineId));
      if (!l) throw new ValidationError(`That line isn't on ${id}.`);
      if (l.reception) throw new ValidationError(`${lineName(l)} has started its reception at ${t.toStore ?? t.toWarehouse} (${l.reception.id}), so it can't be taken off ${id}.`);
      if (t.status === "received") throw new ValidationError(`${id} has arrived: ${lineName(l)} can't be taken off it now.`);
    }
    if (removing.length && removing.length >= t.lines.length) throw new ValidationError(`${id} needs at least one lot on the truck. To cancel the whole BKT, take it up with the team.`);

    if (Object.keys(data).length) await tx.transferRequest.update({ where: { id }, data });
    for (const [lineId, update] of lineUpdates) await tx.transferRequestLine.update({ where: { id: lineId }, data: update });
    for (const lineId of removing) {
      const l = t.lines.find((x) => x.id === Number(lineId))!;
      await tx.transferRequestLine.delete({ where: { id: l.id } });
      if (l.receiptId) await timeline(tx, l.receiptId, `Taken off transfer ${id}`, opts);
    }

    // The truck number each lot's reception copied when it arrived follows the correction — unless that reception was
    // already closed, or someone there wrote a different number (theirs stands: it is what they saw at their gate).
    if (newTruck) {
      for (const l of t.lines) {
        const r = l.reception;
        if (!r || r.vehicleNo !== (oldTruck ?? "")) continue;
        if (r.lockedAt) throw new ValidationError(`${r.id} at ${t.toStore ?? t.toWarehouse} took truck ${oldTruck} and its GRN is complete. Reopen it first, then change the truck.`);
        await applyStageFields(tx, r.id, "n-gate", { "VEHICLE NO.": newTruck }, opts);
      }
    }
    return tx.transferRequest.findUniqueOrThrow({ where: { id }, include: INCLUDE });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return toWire(row);
}
