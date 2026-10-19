/**
 * The figures an LBA record shows but nobody types: all worked out from the supplier's own trucks, delivery plans
 * and jute movements, so they can't drift from the records they describe.
 *
 * Nothing here is invented when the records are missing: a supplier with no plans has no target (null, shown as
 * "-"), not 0; Funding Exposure and Outstanding Amount stay null because the app records no advances or payments.
 */
export interface SupplierTruckFacts {
  arrivalDate: string;
  rejected: boolean;
  /** GRN quantity (the quantity officially recognised into stock); undefined until recorded. */
  grnKg?: number;
  /** Net weight from weighing the truck on arrival: a different figure from the GRN, never blended with it. */
  netKg?: number;
  kor?: number;
  moisture?: number;
}

export interface SupplierPlanFacts {
  expectedKg: number | null;
  /** GRN kg received on the trucks linked to this plan. */
  receivedKg: number;
  cancelled: boolean;
}

export interface SupplierPerformance {
  /** Total kg planned for this supplier (cancelled plans left out). Null when there is no plan with a quantity. */
  targetKg: number | null;
  /** GRN kg received on those plans' trucks: what Achievement % is measured on. */
  receivedOnPlansKg: number;
  /** All accepted trucks' GRN kg, planned or not: the officially recognised volume. */
  volumeDeliveredKg: number;
  /** Net kg weighed on arrival on accepted trucks. Larger than the GRN volume while GRN quantities are still being recorded. */
  weighedOnArrivalKg: number;
  /** Accepted trucks with no GRN quantity yet: weighed and in, but not in the delivered volume. */
  trucksAwaitingGrn: number;
  achievementPct: number | null;
  /** Weighted by each truck's GRN kg, or its net weight while no GRN is recorded; over accepted trucks with a reading and a weight. */
  averageKor: number | null;
  korTrucks: number;
  averageMoisture: number | null;
  moistureTrucks: number;
  trucksArrived: number;
  rejectedTrucks: number;
  /** Rejected / arrived, as a percentage. Null when nothing has arrived. */
  rejectionRatePct: number | null;
  /** Arrival date of the last accepted truck. */
  lastDeliveryDate: string | null;
  /** Jute bags given to the supplier, and those recorded back from it. */
  juteBagsIssued: number;
  juteBagsReturned: number;
  /** Issued minus returned: the bags still with the supplier. Null when no jute movement names this supplier. */
  juteBagBalance: number | null;
  /** No advances or payments are recorded in the app, so these are not calculated (client decision, Oct 2026). */
  fundingExposure: null;
  outstandingAmount: null;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function weightedAverage(trucks: SupplierTruckFacts[], pick: (t: SupplierTruckFacts) => number | undefined) {
  let kg = 0;
  let sum = 0;
  let count = 0;
  for (const t of trucks) {
    const v = pick(t);
    // GRN kg when it is recorded, else the weighed net kg: most trucks are weighed long before their GRN is entered.
    const w = t.grnKg || t.netKg;
    if (t.rejected || v === undefined || Number.isNaN(v) || !w) continue;
    kg += w;
    sum += v * w;
    count++;
  }
  return { value: kg > 0 ? round(sum / kg) : null, count };
}

export function supplierPerformance(
  trucks: SupplierTruckFacts[],
  plans: SupplierPlanFacts[],
  jute: { issued: number; returned: number; movements: number },
): SupplierPerformance {
  const live = plans.filter((p) => !p.cancelled);
  const withQty = live.filter((p) => p.expectedKg !== null);
  const targetKg = withQty.length ? withQty.reduce((n, p) => n + (p.expectedKg ?? 0), 0) : null;
  const receivedOnPlansKg = live.reduce((n, p) => n + p.receivedKg, 0);
  const accepted = trucks.filter((t) => !t.rejected);
  const rejectedTrucks = trucks.length - accepted.length;
  const kor = weightedAverage(trucks, (t) => t.kor);
  const moisture = weightedAverage(trucks, (t) => t.moisture);
  const last = accepted.map((t) => t.arrivalDate).filter(Boolean).sort().at(-1) ?? null;
  return {
    targetKg,
    receivedOnPlansKg,
    volumeDeliveredKg: accepted.reduce((n, t) => n + (t.grnKg ?? 0), 0),
    weighedOnArrivalKg: accepted.reduce((n, t) => n + (t.netKg ?? 0), 0),
    trucksAwaitingGrn: accepted.filter((t) => t.grnKg === undefined).length,
    achievementPct: targetKg ? round((receivedOnPlansKg / targetKg) * 100, 1) : null,
    averageKor: kor.value, korTrucks: kor.count,
    averageMoisture: moisture.value, moistureTrucks: moisture.count,
    trucksArrived: trucks.length,
    rejectedTrucks,
    rejectionRatePct: trucks.length ? round((rejectedTrucks / trucks.length) * 100, 1) : null,
    lastDeliveryDate: last,
    juteBagsIssued: jute.issued,
    juteBagsReturned: jute.returned,
    juteBagBalance: jute.movements ? jute.issued - jute.returned : null,
    fundingExposure: null,
    outstandingAmount: null,
  };
}
