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
import { BAG_WEIGHT_KG } from "./receiptMath.js";
import type { TransferStatus } from "../types/receipt.js";

/**
 * How far apart dispatch and arrival may be before a transfer reads as a discrepancy. Zero is the
 * client's own rule (their Transfer Status formula flags ANY difference); a tolerance is a business
 * decision they have not made, so it is one named constant here rather than a number buried in a query.
 */
export const TRANSFER_TOLERANCE = { bags: 0, kg: 0 } as const;

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
