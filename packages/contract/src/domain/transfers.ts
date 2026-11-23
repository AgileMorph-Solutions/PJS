/**
 * What a BKT says once the truck has arrived: variance and status. Pure, so the backend serves it and
 * the frontend shows it from the same arithmetic.
 *
 * One BKT is one truck / voyage. Bouaké records what it SENDS (bags, and the loaded weight at the
 * dispatch scale); Yamoussoukro records what ARRIVES (bags and gross weight at its scale), and only
 * then is anything compared. Nothing about the receiving side is ever pre-filled at dispatch.
 *
 * The weight rule is the receipt's own: net = gross − 1 kg per jute bag (receiptMath's BAG_WEIGHT_KG),
 * which the client's Stock Transfers sheet follows on both sides — BKT001: 48,880 − 590 bags =
 * 48,290 dispatched, 48,820 − 574 bags = 48,246 at arrival, weight variance −44 kg.
 */
import { BAG_WEIGHT_KG, parseQty } from "./receiptMath.js";
import { isUsableSite } from "./siteType.js";
import { isGrnComplete } from "./recordLock.js";
import type { ReceiptRecord, TransferRequest, TransferStatus, WarehouseMaster } from "../types/receipt.js";

/**
 * How far apart dispatch and arrival may be before a transfer reads as a discrepancy. Zero is the
 * client's own rule (their Transfer Status formula flags ANY difference); a tolerance is a business
 * decision they have not made, so it is one named constant here rather than a number buried in a query.
 */
export const TRANSFER_TOLERANCE = { bags: 0, kg: 0 } as const;

/**
 * How far the loaded weight at dispatch may be from the Lots' own net weights (plus their bags) before it is refused as a
 * typing mistake: an extra digit, or a truck's tare keyed in. It is NOT the client's discrepancy rule above (that compares
 * dispatch with arrival); no tolerance has been given for this, so 10% is a working default, kept in one place to change.
 */
export const DISPATCH_WEIGHT_TOLERANCE = 0.1;

/**
 * Why a loaded weight can't be right for the Lots on the BKT, or null. The truck carries the Lots' net plus 1 kg per bag
 * (BAG_WEIGHT_KG), so a weight far from that is a slip, and recording it would put the wrong stock into the receiving
 * warehouse. Not checked when any Lot has no planned net or bags to compare with.
 */
export function dispatchWeightProblem(grossKg: number, lines: readonly { bags: number | null; netWeightKg: number | null }[]): string | null {
  if (!lines.length || lines.some((l) => l.bags === null || l.netWeightKg === null)) return null;
  const expected = lines.reduce((a, l) => a + l.netWeightKg! + l.bags! * BAG_WEIGHT_KG, 0);
  if (expected <= 0 || Math.abs(grossKg - expected) / expected <= DISPATCH_WEIGHT_TOLERANCE) return null;
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
  return `The loaded weight ${fmt(grossKg)} kg doesn't fit the Lots on this BKT: their net weight and bags come to ${fmt(expected)} kg (more than ${DISPATCH_WEIGHT_TOLERANCE * 100}% apart). Check the loaded weight, or change the Lots' weight on the BKT first.`;
}

/**
 * Whether a Lot can be picked for a BKT on the Transfers page. The truck is loaded Lot by Lot (team, 22 Nov 2026: the person
 * picks the Lots that go on the truck), so picking it IS the decision: a Lot that passed quality, has its GRN complete and
 * sits in a Bin is offered without a separate "transfers out?" answer, and putting it on a BKT records "Yes — transfers out"
 * on its receipt. A Lot already answered the old way keeps that answer: "Yes" is offered as before, while "No — stays" and
 * "Ready for production" keep it off the page. Being on a BKT already isn't on the receipt, so the page checks that too.
 *
 * Every Lot needs its Bin, the "Yes" ones too: the truck is loaded from where the RCN is stored, so a Lot whose Bin isn't
 * known can't be sent (team, 23 Nov 2026). Older Lots answered "Yes" before they had a Bin wait for one (transferNeedsBin).
 */
export function readyForTransfer(r: Pick<ReceiptRecord, "lotNo" | "branches" | "stageData" | "binNo">): boolean {
  return readyButForBin(r) && Boolean(lotBinOf(r));
}

/** A Lot that would be offered for a BKT but has no Bin yet: shown, not pickable, with a way to record its Bin. */
export function transferNeedsBin(r: Pick<ReceiptRecord, "lotNo" | "branches" | "stageData" | "binNo">): boolean {
  return readyButForBin(r) && !lotBinOf(r);
}

/** The Bin a Lot was put in, as its Bin stage (or the older receipt-level field) recorded it; "" when none. */
export const lotBinOf = (r: Pick<ReceiptRecord, "stageData" | "binNo">): string =>
  (r.stageData["n-bin"]?.["Bin Number"] || r.binNo || "").trim();

function readyButForBin(r: Pick<ReceiptRecord, "lotNo" | "branches" | "stageData" | "binNo">): boolean {
  if (!r.lotNo?.trim() || r.branches["n-qfs"] === "fail") return false;
  const answer = r.branches["n-xferdec"];
  if (answer === "transfer") return true;
  if (answer) return false;
  return r.branches["n-qfs"] === "pass" && isGrnComplete(r.stageData);
}

/**
 * RCN moves one way: from a Unit warehouse to a Central one. At Central a Lot stays in its bin or goes
 * to production, and never goes back. The client's sheets only ever record Bouaké → Yakro.
 */
export const canTransferBetween = (fromType: string | null, toType: string | null): boolean => fromType === "UNIT" && toType === "CENTRAL";

export const TRANSFER_DIRECTION_MESSAGE = "RCN can only be transferred from a Unit warehouse to a Central warehouse.";

/**
 * Where a BKT can go: the Central sites of the master (isUsableSite). The site decides who receives the truck; the
 * sender may also name one of its stores (transferDestinationGroups), and each Lot's bin is recorded on arrival.
 * A row with no type or no ID code (BKE-04) can't have anyone working there, so nobody could record the truck arriving.
 */
export function transferDestinations(warehouses: WarehouseMaster[], from: string): string[] {
  return warehouses
    .filter((w) => isUsableSite(w) && w.type === "CENTRAL" && w.name !== from)
    .map((w) => w.name)
    .sort((a, b) => a.localeCompare(b));
}

/** A Central site a BKT may go to, with the stores (the actual warehouses: ANAGROCI-01, YAKRO…) a truck can be sent to. */
export interface TransferDestination {
  site: string;
  stores: string[];
}

/**
 * transferDestinations(), each with its stores, for the sender to pick the warehouse the truck goes to. Naming a store
 * files the BKT at its site with that store kept (backend createTransfer), so the site's people still see and receive
 * it, and only that store's people among them (backend domain/site.ts resolveScope).
 */
export function transferDestinationGroups(warehouses: WarehouseMaster[], from: string): TransferDestination[] {
  return transferDestinations(warehouses, from).map((site) => ({
    site,
    stores: warehouses.filter((w) => w.site === site).map((w) => w.name).sort((a, b) => a.localeCompare(b)),
  }));
}

/** How a BKT's destination reads: the site, plus the store when one was chosen. */
export function transferDestinationLabel(t: Pick<TransferRequest, "toWarehouse" | "toStore">): string {
  return t.toStore ? `${t.toWarehouse} · ${t.toStore}` : t.toWarehouse;
}

/**
 * Why a dispatch was refused when its truck is still out on another BKT (one BKT = one truck = one voyage), sent as the
 * 422's `detail` — only to someone allowed to open that BKT. `sites` are the site names whose Transfers list holds it
 * (sender's and destination's), so the page can link to it under a section the person may open.
 */
export interface TruckOnTheRoadDetail {
  kind: "truck_on_the_road";
  transferId: string;
  sites: string[];
}
export const isTruckOnTheRoad = (d: unknown): d is TruckOnTheRoadDetail =>
  typeof d === "object" && d !== null && (d as { kind?: unknown }).kind === "truck_on_the_road"
  && typeof (d as { transferId?: unknown }).transferId === "string" && Array.isArray((d as { sites?: unknown }).sites);

/** The client's four states. `status` (requested / dispatched / received) is the step; this is what a person reads. */
export type TransferState = "requested" | "in_transit" | "closed" | "discrepancy";

export const TRANSFER_STATE_LABELS: Record<TransferState, string> = {
  requested: "Requested",
  in_transit: "In transit",
  closed: "Closed",
  discrepancy: "Discrepancy",
};

export interface TransferFacts {
  status: TransferStatus;
  /** Bags and planned net weight per Lot on the BKT, as dispatched. */
  lines: { bags: number | null; netWeightKg: number | null }[];
  /** The loaded truck's weight at Bouaké's scale — RCN plus bags. */
  dispatchedGrossKg: number | null;
  /** Entered by the receiving warehouse, on arrival only. */
  bagsReceived: number | null;
  receivedGrossKg: number | null;
}

export interface TransferVariance {
  bagsDispatched: number | null;
  bagsReceived: number | null;
  /** received − dispatched: negative means bags went missing on the road. Null until the truck has arrived. */
  bagVariance: number | null;
  netDispatchedKg: number | null;
  netAtArrivalKg: number | null;
  /** net at arrival − net dispatched. Null until both are known. */
  weightVarianceKg: number | null;
}

const sum = (xs: (number | null)[]): number | null => (xs.some((x) => x === null) || xs.length === 0 ? null : xs.reduce<number>((a, b) => a + (b as number), 0));

export function transferVariance(t: TransferFacts): TransferVariance {
  const bagsDispatched = sum(t.lines.map((l) => l.bags));
  // The dispatch weighing, when there is one, is what was actually sent; otherwise the Lots' own net weights are the plan.
  const netDispatchedKg =
    t.dispatchedGrossKg !== null && bagsDispatched !== null
      ? t.dispatchedGrossKg - bagsDispatched * BAG_WEIGHT_KG
      : sum(t.lines.map((l) => l.netWeightKg));
  const arrived = t.status === "received";
  const netAtArrivalKg = arrived && t.receivedGrossKg !== null && t.bagsReceived !== null ? t.receivedGrossKg - t.bagsReceived * BAG_WEIGHT_KG : null;
  return {
    bagsDispatched,
    bagsReceived: arrived ? t.bagsReceived : null,
    bagVariance: arrived && t.bagsReceived !== null && bagsDispatched !== null ? t.bagsReceived - bagsDispatched : null,
    netDispatchedKg,
    netAtArrivalKg,
    weightVarianceKg: netAtArrivalKg !== null && netDispatchedKg !== null ? netAtArrivalKg - netDispatchedKg : null,
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Each Lot's share of the truck's net at arrival. The truck is weighed once, so a Lot alone on it gets the
 * whole net; with several Lots the net is shared by the bags of each Lot counted off at arrival, or — when only the
 * truck's total was counted, as the client's receiving sheet records it (one row per truck; 20 Nov 2026) — by the bags
 * each Lot was sent with. `shared` marks a figure worked out that way, so it is never shown as if it were weighed.
 * Undefined while the truck hasn't arrived, or when neither count is known for every Lot.
 */
export function lineNetAtArrival(
  t: Omit<TransferFacts, "lines"> & { lines: (TransferFacts["lines"][number] & { bagsReceived?: number | null })[] },
): ({ kg: number; shared: boolean } | undefined)[] {
  const net = transferVariance(t).netAtArrivalKg;
  if (net === null) return t.lines.map(() => undefined);
  if (t.lines.length === 1) return [{ kg: net, shared: false }];
  const received = t.lines.map((l) => l.bagsReceived ?? null);
  const counts = received.every((c) => c !== null) ? received : t.lines.map((l) => l.bags);
  const total = counts.reduce<number>((a, b) => a + (b ?? 0), 0);
  if (counts.some((c) => c === null) || total === 0) return t.lines.map(() => undefined);
  return counts.map((c) => ({ kg: round2((net * c!) / total), shared: true }));
}

/** How big a Lot is, from its own receipt: bags unloaded and net weight. Null when the receipt never recorded it. */
export interface LotSize {
  bags: number | null;
  netKg: number | null;
}

/** One piece of a Lot already put on a BKT. */
export interface LotOnBkt {
  transferId: string;
  bags: number | null;
  netWeightKg: number | null;
}

export interface LotTransferProgress {
  sentBags: number;
  sentKg: number;
  /** What is still to go. Null when the Lot's own size isn't on record, or a BKT took a piece with no figure. */
  leftBags: number | null;
  leftKg: number | null;
  /** Nothing more of this Lot can go on a BKT. */
  fullySent: boolean;
}

/**
 * How much of a Lot is on BKTs and how much is left. A Lot bigger than one truck goes on several (Nov 2026:
 * 40 t on a 35 t truck, the other 5 t on the next one with another Lot). Kg is the measure when the Lot's net
 * and every piece's net are known, otherwise bags. A piece with neither figure, or a Lot whose size was never
 * recorded, can't be subtracted from, so once it is on a BKT it counts as sent in full (as every BKT before
 * splitting existed did).
 */
export function lotTransferProgress(size: LotSize, pieces: readonly LotOnBkt[]): LotTransferProgress {
  const sentKg = round2(pieces.reduce((a, p) => a + (p.netWeightKg ?? 0), 0));
  const sentBags = pieces.reduce((a, p) => a + (p.bags ?? 0), 0);
  const leftKg = size.netKg !== null && pieces.every((p) => p.netWeightKg !== null) ? round2(size.netKg - sentKg) : null;
  const leftBags = size.bags !== null && pieces.every((p) => p.bags !== null) ? size.bags - sentBags : null;
  const left = leftKg ?? leftBags;
  return { sentBags, sentKg, leftBags, leftKg, fullySent: pieces.length > 0 && (left === null || left <= 0) };
}

const kg = (x: number) => `${x.toLocaleString("en-US")} kg`;

/** "150 bags · 30,000 kg" — a piece of a Lot as a person reads it; either half is left out when unknown. */
export function formatLotPiece(p: { bags: number | null; netWeightKg: number | null }): string {
  return [p.bags !== null ? `${p.bags.toLocaleString("en-US")} bags` : null, p.netWeightKg !== null ? kg(p.netWeightKg) : null].filter(Boolean).join(" · ");
}

/**
 * What a BKT line starts from for this Lot: what is left of it when part is already on a BKT, otherwise the whole Lot
 * as its receipt recorded it. Typing something else is allowed — that is how a Lot is split — and pieceChanged says so.
 */
export function suggestedPiece(size: LotSize, onBkts: readonly LotOnBkt[]): { bags: number | null; netWeightKg: number | null } {
  if (!onBkts.length) return { bags: size.bags, netWeightKg: size.netKg };
  const p = lotTransferProgress(size, onBkts);
  return { bags: p.leftBags, netWeightKg: p.leftKg };
}

/**
 * Whether the person sent something other than what the line started from (suggestedPiece). Compared only where both
 * figures exist: a box left blank isn't a change. The page warns on it and the Lot's timeline records it.
 */
export function pieceChanged(suggested: { bags: number | null; netWeightKg: number | null }, piece: { bags: number | null; netWeightKg: number | null }): boolean {
  const differs = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) > 1e-9;
  return differs(suggested.bags, piece.bags) || differs(suggested.netWeightKg, piece.netWeightKg);
}

/**
 * Why `piece` can't go on a BKT next to `onBkts` (the Lot's pieces already on other BKTs), or null when it can.
 * Putting more of a Lot on trucks than it holds would show stock that doesn't exist, so it is refused, not warned.
 */
export function lotPieceProblem(lotNo: string, size: LotSize, onBkts: readonly LotOnBkt[], piece: Omit<LotOnBkt, "transferId">): string | null {
  const before = lotTransferProgress(size, onBkts);
  const where = [...new Set(onBkts.map((p) => p.transferId))].join(", ");
  if (before.fullySent) return `Lot ${lotNo} is already on ${where} in full — nothing of it is left to send.`;
  if (onBkts.length && piece.netWeightKg === null && piece.bags === null) {
    return `Part of Lot ${lotNo} is already on ${where}. Enter how much of it goes on this truck.`;
  }
  const after = lotTransferProgress(size, [...onBkts, { transferId: "", ...piece }]);
  if (after.leftKg !== null && after.leftKg < 0) {
    return `Lot ${lotNo} has ${kg(before.leftKg ?? size.netKg!)} left to send (of ${kg(size.netKg!)}); this truck can take at most that much of it.`;
  }
  if (after.leftKg === null && after.leftBags !== null && after.leftBags < 0) {
    return `Lot ${lotNo} has ${before.leftBags ?? size.bags} bags left to send (of ${size.bags}); this truck can take at most that many.`;
  }
  return null;
}

/**
 * Requested until it leaves, in transit until the destination records the arrival, then closed when
 * what arrived matches what left and a discrepancy when it doesn't. A difference is judged only on
 * what both sides have recorded: a missing weight never makes a transfer a discrepancy by itself.
 */
export function transferState(t: TransferFacts): TransferState {
  if (t.status === "requested") return "requested";
  if (t.status === "dispatched") return "in_transit";
  const v = transferVariance(t);
  const off =
    (v.bagVariance !== null && Math.abs(v.bagVariance) > TRANSFER_TOLERANCE.bags) ||
    (v.weightVarianceKg !== null && Math.abs(v.weightVarianceKg) > TRANSFER_TOLERANCE.kg);
  return off ? "discrepancy" : "closed";
}

/**
 * The kinds of value a BKT's dispatch and arrival forms take: a warehouse receipt no. (digits, as the client's sheets write
 * the W/R No.: 453, 544), a name (the transporter: it needs letters), a number (weights, moisture, KOR; French decimals
 * allowed) or a whole number (bags, nut count).
 */
export type TransferValueKind = "receiptNo" | "name" | "number" | "wholeNumber";

/**
 * What is wrong with how a value is written, or null. Only the form: a blank is the "required" rule's business, and how
 * high a reading may go is the server's range check. The forms show this as the value is typed; the server refuses the same,
 * so a value that slips past the page can't be saved either.
 */
export function transferFieldProblem(kind: TransferValueKind, value: string | number | null | undefined): string | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  switch (kind) {
    case "receiptNo":
      return /^\d+$/.test(v) ? null : "Numbers only.";
    case "name":
      return /\p{L}/u.test(v) ? null : "Enter a name, not a number.";
    case "wholeNumber":
      return /^\d+$/.test(v) ? null : "Whole numbers only.";
    case "number": {
      const n = parseQty(v);
      return n !== undefined && n >= 0 ? null : "Numbers only.";
    }
  }
}
