/**
 * Origin comes from Masters › Origins only (Nov 2026): typed in the app — a truck's step or a delivery plan — a town the
 * master doesn't have is refused. An upload still adds its sheet's own town (receiptSheet.ts), which other tests cover.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createReceipt, setStageFields, getReceipt } from "../src/services/receipts.js";
import { createDeliveryPlan, updateDeliveryPlan } from "../src/services/deliveryPlans.js";

const prisma = new PrismaClient();
const SITE = "ORIGTEST-SITE";
const TOWN = "ORIGTEST-DIANRA";
const D = "2035-05-05";
let userId = "";

beforeAll(async () => {
  await prisma.warehouse.create({ data: { name: SITE, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "ORG1" } });
  await prisma.origin.create({ data: { name: TOWN, source: "test" } });
  userId = (await prisma.user.create({ data: { username: `origtest-${Date.now()}`, displayName: "orig", role: "admin", passwordHash: "x" } })).id;
});
afterAll(async () => {
  await prisma.deliveryPlan.deleteMany({ where: { destinationWarehouse: SITE } });
  await prisma.receipt.deleteMany({ where: { warehouse: SITE } });
  await prisma.stageFieldChange.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.origin.deleteMany({ where: { name: TOWN } });
  await prisma.warehouse.deleteMany({ where: { name: SITE } });
  await prisma.$disconnect();
});

describe("a truck's origin, typed in the app", () => {
  const asPerson = () => ({ actor: { id: userId, via: "direct" as const } });

  it("is refused when the town isn't in Masters › Origins, and saved when it is", async () => {
    const id = (await createReceipt(SITE, D)).id;
    await expect(setStageFields(id, "n-verify", { ORIGIN: "NO-SUCH-TOWN-XYZ" }, asPerson())).rejects.toThrow(/"NO-SUCH-TOWN-XYZ" isn't in Masters › Origins/);
    await setStageFields(id, "n-verify", { ORIGIN: TOWN }, asPerson());
    expect((await getReceipt(id))!.stageData["n-verify"]["ORIGIN"]).toBe(TOWN);
    // Blank is allowed: origin is optional.
    await setStageFields(id, "n-verify", { ORIGIN: "" }, asPerson());
  });
});

describe("a delivery plan's expected origin", () => {
  const plan = (expectedOrigin?: string) =>
    createDeliveryPlan({ supplierName: "ORIGTEST SUPPLIER", expectedArrivalDate: D, destinationWarehouse: SITE, expectedOrigin });

  it("is refused when the town isn't in Masters › Origins, on create and on edit", async () => {
    await expect(plan("NO-SUCH-TOWN-XYZ")).rejects.toThrow(/Expected origin "NO-SUCH-TOWN-XYZ" isn't in Masters › Origins/);
    const ok = await plan(TOWN);
    await expect(updateDeliveryPlan(ok.id, { expectedOrigin: "NO-SUCH-TOWN-XYZ" }, userId)).rejects.toThrow(/isn't in Masters › Origins/);
  });

  it("lets an older plan keep a town the master lacks while the rest of it is edited", async () => {
    const ok = await plan(TOWN);
    await prisma.deliveryPlan.update({ where: { id: ok.id }, data: { expectedOrigin: "OLD SHEET TOWN" } });
    await expect(updateDeliveryPlan(ok.id, { expectedOrigin: "OLD SHEET TOWN", remarks: "edited" }, userId)).resolves.toBeDefined();
  });
});
