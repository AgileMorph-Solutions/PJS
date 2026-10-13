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
  /** GRN quantity; undefined until recorded. */
  grnKg?: number;
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
  /** All accepted trucks' GRN kg, planned or not. */
  volumeDeliveredKg: number;
  achievementPct: number | null;
  /** Weighted by delivered kg, over accepted trucks that have both a reading and a GRN quantity. */
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
  /** Bags given to the supplier minus bags back with deliveries. Null when no supplier jute movement is recorded. */
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
    if (t.rejected || v === undefined || Number.isNaN(v) || !t.grnKg) continue;
    kg += t.grnKg;
    sum += v * t.grnKg;
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
    achievementPct: targetKg ? round((receivedOnPlansKg / targetKg) * 100, 1) : null,
    averageKor: kor.value, korTrucks: kor.count,
    averageMoisture: moisture.value, moistureTrucks: moisture.count,
    trucksArrived: trucks.length,
    rejectedTrucks,
    rejectionRatePct: trucks.length ? round((rejectedTrucks / trucks.length) * 100, 1) : null,
    lastDeliveryDate: last,
    juteBagBalance: jute.movements ? jute.issued - jute.returned : null,
    fundingExposure: null,
    outstandingAmount: null,
  };
}
