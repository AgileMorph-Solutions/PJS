/**
 * What the supplier figures are read from: one truck's facts and a supplier's jute movements, shared by the supplier
 * page (services/suppliers.ts) and the dashboard's supplier analytics (services/supplierAnalytics.ts). Both feed the
 * same contract calculation (domain/supplierPerformance.ts), so a supplier's row on the dashboard and its own page
 * cannot disagree: they are made from the same rows by the same function.
 */
import type { Prisma } from "@prisma/client";
import type { SupplierTruckFacts } from "@anagroci/contract/domain/supplierPerformance";
import { prisma } from "../db.js";

const num = (v: Prisma.Decimal | null | undefined) => (v === null || v === undefined ? undefined : Number(v));

/** The receipt columns and stage rows a supplier's figures read, and nothing else. */
export const SUPPLIER_TRUCK_SELECT = {
  arrivalDate: true,
  lbaCode: true,
  supplierName: true,
  branches: { where: { stageId: "n-qfs" }, select: { branchId: true } },
  grn: { select: { grnWeightNum: true } },
  netwt: { select: { netWtKgsNum: true, paidWtNum: true } },
  qfs: { select: { finalKorNum: true, korNum: true, moistureNum: true } },
  unload: { select: { sacsNum: true, bonSacsNum: true, humidSacsNum: true, sacsDechiresNum: true } },
} as const satisfies Prisma.ReceiptSelect;

export type SupplierTruckRow = Prisma.ReceiptGetPayload<{ select: typeof SUPPLIER_TRUCK_SELECT }>;

export function toSupplierTruckFacts(r: SupplierTruckRow): SupplierTruckFacts {
  return {
    arrivalDate: r.arrivalDate,
    rejected: r.branches.some((b) => b.branchId === "fail"),
    grnKg: num(r.grn?.grnWeightNum),
    netKg: num(r.netwt?.netWtKgsNum),
    paidKg: num(r.netwt?.paidWtNum),
    // The final KOR when the cut test was repeated, otherwise the first one.
    kor: num(r.qfs?.finalKorNum) ?? num(r.qfs?.korNum),
    moisture: num(r.qfs?.moistureNum),
    bags: num(r.unload?.sacsNum),
    goodBags: num(r.unload?.bonSacsNum),
    dampBags: num(r.unload?.humidSacsNum),
    tornBags: num(r.unload?.sacsDechiresNum),
  };
}

export interface JuteTotals { issued: number; returned: number; movements: number }

/**
 * Jute comes from two ledgers: the warehouse "Jute Bags movement" sheet (rows naming a supplier are bags issued to it)
 * and the supplier movement ledger (issued, and returned via deliveries). Together they are the bags given and the bags back.
 * Narrowed by movement date and warehouse when asked: a row with no real date is then left out, as there is nothing to place it by.
 */
export async function juteBySupplier(scope: { code?: string; from?: string; to?: string; site?: string[] } = {}): Promise<Map<string, JuteTotals>> {
  const dated = scope.from || scope.to
    ? { movementDate: { ...(scope.from ? { gte: new Date(`${scope.from}T00:00:00.000Z`) } : {}), ...(scope.to ? { lte: new Date(`${scope.to}T23:59:59.999Z`) } : {}) } }
    : {};
  const [warehouse, supplier] = await Promise.all([
    prisma.juteWarehouseMovement.groupBy({
      by: ["supplierCode"],
      where: { supplierCode: scope.code ?? { not: null }, ...dated, ...(scope.site ? { whLocation: { in: scope.site } } : {}) },
      _sum: { bagsIssued: true, bagsReceived: true },
      _count: true,
    }),
    prisma.juteSupplierMovement.groupBy({
      by: ["supplierCode"],
      where: { ...(scope.code ? { supplierCode: scope.code } : {}), ...dated, ...(scope.site ? { whLocation: { in: scope.site } } : {}) },
      _sum: { bagsIssuedToSupplier: true, returnedViaDeliveries: true },
      _count: true,
    }),
  ]);
  const out = new Map<string, JuteTotals>();
  const at = (code: string) => out.get(code) ?? out.set(code, { issued: 0, returned: 0, movements: 0 }).get(code)!;
  for (const g of warehouse) if (g.supplierCode) { const t = at(g.supplierCode); t.issued += g._sum.bagsIssued ?? 0; t.returned += g._sum.bagsReceived ?? 0; t.movements += g._count; }
  for (const g of supplier) { const t = at(g.supplierCode); t.issued += g._sum.bagsIssuedToSupplier ?? 0; t.returned += g._sum.returnedViaDeliveries ?? 0; t.movements += g._count; }
  return out;
}

export const NO_JUTE: JuteTotals = { issued: 0, returned: 0, movements: 0 };
