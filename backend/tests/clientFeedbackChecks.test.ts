/**
 * The audit checks added for the client's Oct 2026 feedback, on fixture rows: the ones whose real-data
 * count depends on how a database was seeded (REMARKS were only stored from Sept 28 on) or on the
 * client's workbook having been applied. Each check must find exactly what is planted and name it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { scanAll } from "../src/domain/dataQuality/index.js";
import { createReceipt, setStageFields, setBranch } from "../src/services/receipts.js";
import { createDeliveryPlan } from "../src/services/deliveryPlans.js";

const prisma = new PrismaClient();
const SITE = "CFCHK-SITE";
const STORE = "CFCHK-STORE";

async function cleanup() {
  await prisma.receipt.deleteMany({ where: { warehouse: SITE } });
  await prisma.deliveryPlan.deleteMany({ where: { destinationWarehouse: SITE } });
  await prisma.warehouseDispatchLine.deleteMany({ where: { source: "cfchk" } });
  await prisma.bin.deleteMany({ where: { code: STORE } });
  await prisma.warehouse.deleteMany({ where: { site: SITE } });
  await prisma.warehouse.deleteMany({ where: { name: SITE } });
}
const finding = async (id: string) => (await scanAll()).checks.find((c) => c.id === id);

beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: SITE, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "CFC1" } });
  await prisma.warehouse.create({ data: { name: STORE, site: SITE } });
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("client feedback audit checks", () => {
  it("reject_remark_not_rejected finds a truck whose remarks say REJECT but isn't marked, and stops once it is", async () => {
    const before = (await finding("reject_remark_not_rejected"))?.affectedCount ?? 0;
    const id = (await createReceipt(SITE, "2034-01-02")).id;
    await setStageFields(id, "n-gate", { REMARKS: " reject " }); // case and spaces don't matter
    const f = (await finding("reject_remark_not_rejected"))!;
    expect(f.affectedCount).toBe(before + 1);
    expect(f.severity).toBe("critical");
    await setBranch(id, "n-qfs", "fail", "Mouldy");
    expect((await finding("reject_remark_not_rejected"))?.affectedCount ?? 0).toBe(before);
  });

  it("rejection_reason_is_placeholder finds a reason that is only the word REJECT, not a real one", async () => {
    const real = (await createReceipt(SITE, "2034-01-03")).id;
    await setBranch(real, "n-qfs", "fail", "Too humid");
    expect(await finding("rejection_reason_is_placeholder")).toBeUndefined();

    const marker = (await createReceipt(SITE, "2034-01-04")).id;
    await setBranch(marker, "n-qfs", "fail", "REJECT");
    const f = (await finding("rejection_reason_is_placeholder"))!;
    expect(f.affectedCount).toBe(1);
    expect(f.sampleIds).toEqual([marker]);
  });

  it("delivery_plan_missing_store finds a plan with no store, not one that has one or was cancelled", async () => {
    await createDeliveryPlan({ supplierName: "S", expectedArrivalDate: "2034-02-01", destinationWarehouse: SITE, destinationStore: STORE });
    expect(await finding("delivery_plan_missing_store")).toBeUndefined();
    const bare = await createDeliveryPlan({ supplierName: "S", expectedArrivalDate: "2034-02-02", destinationWarehouse: SITE });
    expect((await finding("delivery_plan_missing_store"))!.sampleIds).toEqual([bare.id]);
  });

  it("bin_code_is_store_code counts a store sitting in the Bin master and one allocated to a Lot", async () => {
    const before = (await finding("bin_code_is_store_code"))?.affectedCount ?? 0;
    await prisma.bin.create({ data: { code: STORE, source: "test" } });
    const id = (await createReceipt(SITE, "2034-01-05")).id;
    await setBranch(id, "n-qfs", "pass");
    await setStageFields(id, "n-bin", { "Bin Number": STORE }, { bypassValidation: true }); // history is kept as written
    const f = (await finding("bin_code_is_store_code"))!;
    expect(f.affectedCount).toBe(before + 2); // the master row and the allocation
    expect(f.sampleIds.join(" ")).toContain(STORE);
  });

  it("transfer_voyage_multiple_trucks sees one BKT on two trucks, however the plates are spaced", async () => {
    const before = (await finding("transfer_voyage_multiple_trucks"))?.affectedCount ?? 0;
    const line = (truckNo: string, row: number) =>
      prisma.warehouseDispatchLine.create({ data: { warehouseSite: SITE, vyogeNumber: "BKT-2099-001", truckNo, source: "cfchk", sheetRow: row } });
    await line("1796 GC 01", 1);
    await line("1796-GC-01", 2); // the same truck written two ways: not a second truck
    expect((await finding("transfer_voyage_multiple_trucks"))?.affectedCount ?? 0).toBe(before);
    await line("7957GN01", 3);
    expect((await finding("transfer_voyage_multiple_trucks"))!.affectedCount).toBe(before + 1);
  });
});
