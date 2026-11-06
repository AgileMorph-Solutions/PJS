/**
 * "Bags still with supplier" is calculated unless someone types over it on a row, and later rows continue from what was
 * typed. The same bags can pass through two warehouses, so the guard here is also that narrowing the list to one warehouse
 * doesn't change the balance, or the supplier's current figure.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { addLedgerRow, listLedgerRows } from "../src/services/ledgers.js";

const prisma = new PrismaClient();
const CODE = "JSP-SUPPLIER";
const OTHER = "JSP-OTHER";
const PENDING = "Bags still with supplier";
const CURRENT = "Bags currently with supplier";

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

  it("stores nothing when the figure was left to be calculated, so it can't drift", async () => {
    await add({ "Bags issued to supplier": "10" });
    await add({ "Bags issued to supplier": "5", [PENDING]: "" });
    const stored = await prisma.juteSupplierMovement.findMany({ where: { supplierCode: CODE, activity: "JSP" } });
    expect(stored.map((r) => r.pendingWithSupplier)).toEqual([null, null]);
  });

  it("takes a typed figure, and later entries continue from it", async () => {
    await add({ "Bags issued to supplier": "1000" });
    expect((await add({ "Bags issued to supplier": "1000", "Returned through RCN deliveries": "200", [PENDING]: "1500" }))[PENDING]).toBe("1500");
    expect((await add({ "Returned through RCN deliveries": "100" }))[PENDING]).toBe("1400");
  });

  it("accepts a typed zero or minus, and refuses a typed figure that isn't a whole number", async () => {
    expect((await add({ "Bags issued to supplier": "10", [PENDING]: "0" }))[PENDING]).toBe("0");
    expect((await add({ [PENDING]: "-5" }))[PENDING]).toBe("-5");
    await expect(add({ [PENDING]: "abc" })).rejects.toThrow(/whole number/);
  });

  it("refuses a typed figure on a row with no supplier, where it would never be shown", async () => {
    await expect(add({ "Supplier code": "", [PENDING]: "50" })).rejects.toThrow(/Supplier code/);
  });

  it("gives every row the supplier's latest balance as the current figure", async () => {
    await add({ "Bags issued to supplier": "1000" });
    await add({ "Bags issued to supplier": "1000", "Returned through RCN deliveries": "200" });
    await add({ "Supplier code": OTHER, "Bags issued to supplier": "7" });
    const rows = await mine();
    expect(rows.map((r) => [r[PENDING], r[CURRENT]])).toEqual([["1000", "1800"], ["1800", "1800"], ["7", "7"]]);
  });

  it("shows the true current figure to a warehouse that doesn't hold the supplier's newest row", async () => {
    await add({ Warehouse: "JSP-WH-1", "Bags issued to supplier": "500" });
    await add({ Warehouse: "JSP-WH-2", "Returned through RCN deliveries": "100" });
    expect((await mine(["JSP-WH-1"])).map((r) => [r[PENDING], r[CURRENT]])).toEqual([["500", "400"]]);
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
