/**
 * The dashboard's supplier-wise analytics: one line per supplier for a period (and site), plus totals. Every line is
 * the contract's supplierPerformance() over that supplier's own trucks, plans and jute, exactly as the supplier page
 * computes it, so nothing is calculated twice in two different ways. Trucks that carry no LBA code are kept as their own
 * line rather than dropped, so the lines always add up to every truck in the period.
 */
import { planProgress } from "@anagroci/contract/domain/deliveryPlan";
import { normalizeSupplierName } from "@anagroci/contract/domain/supplierCode";
import type { SupplierStatus } from "@anagroci/contract/domain/supplierProfile";
import { supplierPerformance, type SupplierPlanFacts, type SupplierTruckFacts } from "@anagroci/contract/domain/supplierPerformance";
import type { SupplierAnalytics, SupplierAnalyticsRow } from "@anagroci/contract/types/receipt";
import { prisma } from "../db.js";
import { PLAN_FACTS_SELECT, toFacts, toTerms } from "./planFacts.js";
import { juteBySupplier, NO_JUTE, SUPPLIER_TRUCK_SELECT, toSupplierTruckFacts } from "./supplierFacts.js";

export interface SupplierAnalyticsScope { from?: string; to?: string; site?: string[] }

const NO_CODE_NAME = "No supplier code";

export async function supplierAnalytics({ from, to, site }: SupplierAnalyticsScope): Promise<SupplierAnalytics> {
  // arrivalDate and expectedArrivalDate are YYYY-MM-DD strings, so lexicographic comparison is chronological.
  const within = (field: "arrivalDate" | "expectedArrivalDate") =>
    from || to ? { [field]: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {};

  const [receipts, plans, jute, register] = await Promise.all([
    prisma.receipt.findMany({ where: { ...within("arrivalDate"), ...(site ? { warehouse: { in: site } } : {}) }, select: SUPPLIER_TRUCK_SELECT }),
    // A plan belongs to the period it was expected in, and to the site it was expected at; its trucks are all the trucks linked to it.
    prisma.deliveryPlan.findMany({
      where: { ...within("expectedArrivalDate"), ...(site ? { destinationWarehouse: { in: site } } : {}) },
      include: { receipts: { select: PLAN_FACTS_SELECT } },
    }),
    juteBySupplier({ from, to, site }),
    prisma.supplier.findMany({ select: { code: true, name: true, status: true } }),
  ]);

  const trucksOf = new Map<string, SupplierTruckFacts[]>();
  const nameSeen = new Map<string, string>();
  const noCodeTrucks: SupplierTruckFacts[] = [];
  const allTrucks: SupplierTruckFacts[] = [];
  for (const r of receipts) {
    const facts = toSupplierTruckFacts(r);
    allTrucks.push(facts);
    const code = r.lbaCode.trim();
    if (!code) { noCodeTrucks.push(facts); continue; }
    trucksOf.set(code, [...(trucksOf.get(code) ?? []), facts]);
    if (!nameSeen.has(code)) nameSeen.set(code, r.supplierName);
  }

  const plansOf = new Map<string, SupplierPlanFacts[]>();
  const allPlans: SupplierPlanFacts[] = [];
  for (const p of plans) {
    const terms = toTerms(p);
    const facts: SupplierPlanFacts = { expectedKg: terms.expectedQuantityKg, receivedKg: planProgress(terms, p.receipts.map(toFacts)).actualKg, cancelled: terms.cancelled };
    allPlans.push(facts);
    if (p.supplierCode) plansOf.set(p.supplierCode, [...(plansOf.get(p.supplierCode) ?? []), facts]);
  }

  const known = new Map(register.map((s) => [s.code, s]));
  const codes = new Set([...trucksOf.keys(), ...plansOf.keys(), ...jute.keys()]);
  const rows: SupplierAnalyticsRow[] = [...codes].map((code) => {
    const s = known.get(code);
    return {
      code,
      name: s?.name ?? (normalizeSupplierName(nameSeen.get(code) ?? "") || code),
      status: (s?.status as SupplierStatus | undefined) ?? null,
      performance: supplierPerformance(trucksOf.get(code) ?? [], plansOf.get(code) ?? [], jute.get(code) ?? NO_JUTE),
    };
  });
  // Biggest first by the officially recognised quantity; ties (and the many with none recorded yet) by weighed kg, then name.
  rows.sort((a, b) =>
    b.performance.volumeDeliveredKg - a.performance.volumeDeliveredKg
    || b.performance.weighedOnArrivalKg - a.performance.weighedOnArrivalKg
    || a.name.localeCompare(b.name));

  const juteAll = [...jute.values()].reduce((n, j) => ({ issued: n.issued + j.issued, returned: n.returned + j.returned, movements: n.movements + j.movements }), { ...NO_JUTE });
  return {
    rows,
    noCode: noCodeTrucks.length
      ? { code: "", name: NO_CODE_NAME, status: null, performance: supplierPerformance(noCodeTrucks, [], NO_JUTE) }
      : null,
    totals: supplierPerformance(allTrucks, allPlans, juteAll),
    period: { from: from ?? null, to: to ?? null },
  };
}
