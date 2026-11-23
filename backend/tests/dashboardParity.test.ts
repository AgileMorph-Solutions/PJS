/**
 * The dashboard endpoint counts from a slimmed-down query, the screens count from whole receipts. Both go through
 * computeDashboardCounts, so they only agree if the slim query loads everything deriveStatus reads. It once didn't: it left
 * out the GRN quantity and where the truck came from, so every truck entered in the app that had completed its GRN was
 * counted as merely "unloaded" (43 GRNs reported against 463 real ones). Runs on a throwaway site.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { computeDashboardCounts } from "@anagroci/contract/domain/receiptStatus";
import { createReceipt, listReceipts, setStageFields } from "../src/services/receipts.js";
import { dashboardCounts } from "../src/services/dashboard.js";

const prisma = new PrismaClient();
const SITE = "DASHPAR-SITE";
const D = "2032-05-05";
const GRN_WEIGHT = "GRN Weight (kept separate from Gross/Net/Paid)";

async function cleanup() {
  await prisma.receipt.deleteMany({ where: { warehouse: SITE } });
  await prisma.warehouse.deleteMany({ where: { name: SITE } });
}
beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: SITE, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "DSP1" } });
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("dashboard counts", () => {
  it("count a truck entered in the app as GRN completed once its GRN quantity is recorded, and not before", async () => {
    const unloadedOnly = (await createReceipt(SITE, D)).id;
    await setStageFields(unloadedOnly, "n-unload", { "DATE OF OFFLOADING": D });

    const grnStarted = (await createReceipt(SITE, D)).id;
    await setStageFields(grnStarted, "n-unload", { "DATE OF OFFLOADING": D });
    await setStageFields(grnStarted, "n-grn", { PRICE: "470" }); // a GRN stage with no quantity yet is not a completed GRN

    const grnDone = (await createReceipt(SITE, D)).id;
    await setStageFields(grnDone, "n-grn", { [GRN_WEIGHT]: "11750" });

    const imported = (await createReceipt(SITE, D)).id;
    await setStageFields(imported, "n-grn", { PRICE: "470" });
    await prisma.receipt.update({ where: { id: imported }, data: { source: "imported" } }); // imported rows never had the quantity

    const counts = await dashboardCounts({ site: [SITE] });
    expect(counts).toMatchObject({ totalReceived: 4, acceptedUnloaded: 4, grnCompleted: 2 });
  });

  it("are exactly what the whole receipts give, whatever mix of trucks there is", async () => {
    const fromWholeRecords = computeDashboardCounts(await listReceipts([SITE]));
    const { period: _period, ...served } = await dashboardCounts({ site: [SITE] });
    expect(served).toEqual(fromWholeRecords);
  });
});
