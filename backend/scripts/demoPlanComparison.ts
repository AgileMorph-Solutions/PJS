/**
 * One-off for an EXISTING demo database: re-links the demo trucks to the delivery plans and gives
 * them GRN weights, so the plan view has planned-vs-received to show. A fresh SEED_MODE=demo database
 * gets the same shape from prisma/demoData.ts; this exists because the seeder skips a database that
 * already has receipts. Goes through the same services as the API, and is safe to re-run.
 */
import { prisma } from "../src/db.js";
import { setStageFields } from "../src/services/receipts.js";
import { linkReceiptToPlan } from "../src/services/receiptPlanInfo.js";
import { updateDeliveryPlan } from "../src/services/deliveryPlans.js";

const GRN_LABEL = "GRN Weight (kept separate from Gross/Net/Paid)";
const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n)).toISOString().slice(0, 10);
const SUPPLIER_OF_PLAN = [1, 2, 5, 0];
const WINDOW: [number, number][] = [[14, 14], [15, 21], [6, 19], [7, 20]];
// Bouaké truck index i has vehicle `${1200 + i*37}KT..`; Yakro direct truck k has `${3100 + k*41}AB..`.
const BKE: [number, number, number?][] = [[13, 0, 24350], [14, 1, 14200], [20, 1, 8900], [5, 2], [17, 2, 29100], [6, 3], [18, 3, 26800]];
const YAK: [number, number, number][] = [[0, 0, 29400], [1, 1, 33200]];

// Receipt.source is "entered" on these rows (the demo seeder writes through the API's own path), so the
// truck is found by its vehicle number alone; the KT / AB suffix keeps Bouaké and Yakro apart.
async function receiptByVehicle(prefix: number, suffix: "KT" | "AB") {
  const r = await prisma.receipt.findFirst({ where: { vehicleNo: { startsWith: `${prefix}${suffix}` } } });
  if (!r) throw new Error(`No receipt with vehicle ${prefix}${suffix}…`);
  return r;
}

async function main() {
  const suppliers = await prisma.supplier.findMany({ where: { source: "demo" }, orderBy: { code: "asc" } });
  const plansOf = async (site: string) =>
    (await prisma.deliveryPlan.findMany({ where: { destinationWarehouse: site }, orderBy: { id: "asc" } })).map((p) => p.id);
  const bke = await plansOf("BOUAKE");
  const yak = await plansOf("YAKRO FACTORY");

  // A plan only accepts trucks of its own supplier, so the plan follows the trucks (one row each).
  for (let i = 0; i < 4; i++) {
    const s = suppliers[SUPPLIER_OF_PLAN[i]];
    await updateDeliveryPlan(bke[i], {
      supplierName: s.name, supplierCode: s.code, expectedArrivalDate: day(WINDOW[i][0]), plannedDeliveryDate: day(WINDOW[i][0]),
      expectedDeliveryEnd: WINDOW[i][1] > WINDOW[i][0] ? day(WINDOW[i][1]) : null,
    });
  }
  // Un-link whatever the old seed linked to Bouaké plans, then link the intended trucks.
  await prisma.receipt.updateMany({ where: { deliveryPlanId: { in: bke } }, data: { deliveryPlanId: null, deliveryPlanLinkedAt: null } });

  const place = async (vehiclePrefix: number, suffix: "KT" | "AB", planId: string, grn?: number) => {
    const r = await receiptByVehicle(vehiclePrefix, suffix);
    if (r.deliveryPlanId !== planId) {
      if (r.deliveryPlanId) await prisma.receipt.update({ where: { id: r.id }, data: { deliveryPlanId: null, deliveryPlanLinkedAt: null } });
      await linkReceiptToPlan(r.id, planId);
    }
    if (grn !== undefined) await setStageFields(r.id, "n-grn", { [GRN_LABEL]: String(grn) });
    console.log(`${r.id} -> ${planId}${grn !== undefined ? ` (GRN ${grn} kg)` : " (no GRN)"}`);
  };
  for (const [i, p, grn] of BKE) await place(1200 + i * 37, "KT", bke[p], grn);
  for (const [k, p, grn] of YAK) await place(3100 + k * 41, "AB", yak[p], grn);
}

main().then(() => prisma.$disconnect(), (e) => { console.error(e); process.exit(1); });
