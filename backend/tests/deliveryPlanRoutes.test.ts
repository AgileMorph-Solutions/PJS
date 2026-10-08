/**
 * The Delivery Plan endpoints through the HTTP layer: who may plan, approve and link, that a
 * warehouse is kept to its own plans, and that the whole-warehouse plan view (which isn't filtered
 * per supplier) never reaches a Branch Manager or QFS Officer. The arithmetic itself is covered in
 * the contract's deliveryPlan.test.ts and systemIds.test.ts; this is the wiring around it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const P = "dprtest-";
const SITE = "DPRTEST-SITE";
const OTHER = "DPRTEST-OTHER";
const cookies: Record<string, string> = {};

async function mkUser(key: string, role: string, warehouse: string | null) {
  await prisma.user.create({ data: { username: P + key, displayName: key, role, warehouse, passwordHash: hashPassword(PW) } });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: P + key, password: PW } });
  expect(res.statusCode, `login ${key}`).toBe(200);
  cookies[key] = String(res.headers["set-cookie"]).split(";")[0]!;
}
const as = (u: string, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as any, headers: { cookie: cookies[u]! } });

async function cleanup() {
  await prisma.receipt.deleteMany({ where: { warehouse: { in: [SITE, OTHER] } } });
  await prisma.deliveryPlan.deleteMany({ where: { destinationWarehouse: { in: [SITE, OTHER] } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: P } } });
  await prisma.warehouse.deleteMany({ where: { name: { in: [SITE, OTHER] } } });
}

beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: SITE, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "DPR1" } });
  await prisma.warehouse.create({ data: { name: OTHER, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "DPR2" } });
  await mkUser("wi", "warehouse_incharge", SITE);
  await mkUser("wiOther", "warehouse_incharge", OTHER);
  await mkUser("bm", "branch_manager", SITE);
  await mkUser("qfs", "qfs_officer", SITE);
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("delivery plan routes", () => {
  let planId: string;
  let truck: string;

  it("an incharge plans a delivery into their own warehouse (named or not), never into another", async () => {
    const plan = {
      supplierName: "Route Supplier", supplierCode: "LBA-RT", expectedQuantityKg: 40000, expectedTrucks: 2,
      expectedArrivalDate: "2031-05-01", expectedDeliveryEnd: "2031-05-31",
    };
    expect((await as("wi", "POST", "/api/delivery-plans", { ...plan, destinationWarehouse: OTHER })).statusCode).toBe(403);
    const res = await as("wi", "POST", "/api/delivery-plans", plan); // no destination: their own
    expect(res.statusCode).toBe(201);
    planId = res.json().id;
    expect(res.json()).toMatchObject({ id: "DP-DPR1-2031-001", destinationWarehouse: SITE, status: "planned", progress: { arrivals: 0, remainingKg: 40000 } });
  });

  it("a warehouse can't read or change another warehouse's plan", async () => {
    expect((await as("wiOther", "GET", `/api/delivery-plans/${planId}`)).statusCode).toBe(403);
    expect((await as("wiOther", "PATCH", `/api/delivery-plans/${planId}`, { remarks: "x" })).statusCode).toBe(403);
    expect((await as("wiOther", "GET", "/api/delivery-plans")).json()).toEqual([]);
  });

  it("an unplanned truck can be linked to the plan afterwards, and the plan then counts it", async () => {
    truck = (await as("wi", "POST", "/api/receipts", { warehouse: SITE, arrivalDate: "2031-05-03" })).json().id;
    await as("wi", "PATCH", `/api/receipts/${truck}`, { lbaCode: "LBA-RT" });
    expect((await as("wi", "GET", `/api/receipts/${truck}/plan-info`)).json()).toMatchObject({ type: "unplanned", planLinkStatus: "not_planned", approval: "pending" });

    const linked = await as("wi", "POST", `/api/receipts/${truck}/delivery-plan`, { deliveryPlanId: planId });
    expect(linked.statusCode).toBe(200);
    expect(linked.json()).toMatchObject({ deliveryPlanId: planId, planLinkStatus: "linked_later", type: "planned" });
    expect((await as("wi", "GET", `/api/delivery-plans/${planId}`)).json()).toMatchObject({ status: "partially_received", receiptIds: [truck] });
  });

  it("refuses a second link with a 422 and a plain reason, and a missing plan id with a 400", async () => {
    const again = await as("wi", "POST", `/api/receipts/${truck}/delivery-plan`, { deliveryPlanId: planId });
    expect(again.statusCode).toBe(422);
    expect(again.json().error).toMatch(/already linked/);
    expect((await as("wi", "POST", `/api/receipts/${truck}/delivery-plan`, {})).statusCode).toBe(400);
  });

  it("approving an exception is recorded against the signed-in user; approving a planned truck is refused", async () => {
    const odd = (await as("wi", "POST", "/api/receipts", { warehouse: SITE, arrivalDate: "2031-05-04" })).json().id;
    const ok = await as("wi", "POST", `/api/receipts/${odd}/exception-approval`, { note: "Called the supplier" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ approval: "approved", approvedBy: "wi", approvalNote: "Called the supplier" });
    expect((await as("wi", "POST", `/api/receipts/${truck}/exception-approval`, {})).statusCode).toBe(422);
  });

  it("the whole-warehouse plan view is closed to Branch Manager and QFS Officer, whatever they could read otherwise", async () => {
    for (const u of ["bm", "qfs"]) {
      expect((await as(u, "GET", "/api/receipts/plan-info")).statusCode, `${u} plan-info`).toBe(403);
      expect((await as(u, "GET", `/api/receipts/${truck}/plan-info`)).statusCode, `${u} one plan-info`).toBe(403);
      expect((await as(u, "POST", `/api/receipts/${truck}/exception-approval`, {})).statusCode, `${u} approve`).toBe(403);
      expect((await as(u, "POST", "/api/delivery-plans", { supplierName: "x" })).statusCode, `${u} create plan`).toBe(403);
    }
    const list = await as("wi", "GET", `/api/receipts/plan-info?warehouse=${encodeURIComponent(SITE)}`);
    expect(list.statusCode).toBe(200);
    expect(list.json().map((r: any) => r.receiptId)).toContain(truck);
  });

  it("cancelling over HTTP needs a reason and records who did it", async () => {
    expect((await as("wi", "PATCH", `/api/delivery-plans/${planId}`, { cancelled: true })).statusCode).toBe(422);
    const res = await as("wi", "PATCH", `/api/delivery-plans/${planId}`, { cancelled: true, cancelReason: "Supplier withdrew" });
    expect(res.json()).toMatchObject({ status: "cancelled", cancelReason: "Supplier withdrew" });
    expect((await prisma.deliveryPlan.findUniqueOrThrow({ where: { id: planId }, include: { canceller: true } })).canceller?.username).toBe(`${P}wi`);
  });
});
