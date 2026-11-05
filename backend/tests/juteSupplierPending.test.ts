/**
 * "Bags still with supplier" is calculated, so a typed number must never be able to reach it. The same bags can pass
 * through two warehouses, so the guard here is also that narrowing the list to one warehouse doesn't change the balance.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { addLedgerRow, listLedgerRows } from "../src/services/ledgers.js";

const prisma = new PrismaClient();
const CODE = "JSP-SUPPLIER";
const OTHER = "JSP-OTHER";
const PENDING = "Bags still with supplier";

const clean = () => prisma.juteSupplierMovement.deleteMany({ where: { supplierCode: { in: [CODE, OTHER, ""] }, activity: "JSP" } });
beforeAll(clean);
afterEach(clean);
afterAll(() => prisma.$disconnect());

const add = (row: Record<string, string>) => addLedgerRow("supplier-movement", { "Supplier code": CODE, Activity: "JSP", ...row });
const mine = async (site?: string[]) => (await listLedgerRows("supplier-movement", site)).filter((r) => r.Activity === "JSP");

describe("the supplier balance", () => {
  it("comes back already worked out on the row just saved", async () => {
    expect((await add({ "Bags issued to supplier": "1000" }))[PENDING]).toBe("1000");
    expect((await add({ "Returned through RCN deliveries": "800" }))[PENDING]).toBe("200");
  });

  it("goes negative when more came back than was issued", async () => {
    await add({ "Bags issued to supplier": "1000" });
    expect((await add({ "Returned through RCN deliveries": "1100" }))[PENDING]).toBe("-100");
  });

  it("ignores a typed number, and stores nothing that could drift", async () => {
    const row = await add({ "Bags issued to supplier": "10", [PENDING]: "99999" });
    expect(row[PENDING]).toBe("10");
    const stored = await prisma.juteSupplierMovement.findMany({ where: { supplierCode: CODE, activity: "JSP" } });
    expect(stored.map((r) => r.pendingWithSupplier)).toEqual([null]);
  });

  it("doesn't count damaged or reusable bags", async () => {
    await add({ "Bags issued to supplier": "1000" });
    expect((await add({ "Returned through RCN deliveries": "800", Damaged: "50", "Reusable/reconditionable": "30" }))[PENDING]).toBe("200");
  });

  it("keeps suppliers apart, and leaves a row with no supplier blank", async () => {
    await add({ "Bags issued to supplier": "100" });
    await add({ "Supplier code": OTHER, "Bags issued to supplier": "7" });
    expect((await add({ "Supplier code": "", "Bags issued to supplier": "5" }))[PENDING]).toBe("");
    expect((await add({ "Bags issued to supplier": "1" }))[PENDING]).toBe("101");
  });

  it("is the same whichever warehouse is looking: a filter narrows the list, not the sum", async () => {
    await add({ Warehouse: "JSP-WH-1", "Bags issued to supplier": "500" });
    await add({ Warehouse: "JSP-WH-2", "Bags issued to supplier": "300" });
    await add({ Warehouse: "JSP-WH-1", "Returned through RCN deliveries": "100" });

    expect((await mine()).map((r) => r[PENDING])).toEqual(["500", "800", "700"]);
    expect((await mine(["JSP-WH-1"])).map((r) => r[PENDING])).toEqual(["500", "700"]);
    expect((await mine(["JSP-WH-2"])).map((r) => r[PENDING])).toEqual(["800"]);
  });
});
