/**
 * Users work at a STORE (BKE-001), not at the site above it (BOUAKE). Pins the rule in domain/site.ts resolveScope,
 * through the HTTP layer: a store-bound user sees their own store's records and what is filed under the site's own
 * name, never a sibling store's; the masters list shows them their site and their store only; they land in their
 * site's section (`site` + its Unit/Central type on /me); and new accounts can only be put on a store of a ready site.
 * The failure this guards against is silent: a sibling store's trucks quietly showing up in someone's list.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const P = "sstest-";
const SITE = "SSTEST-SITE";
const A = "SSTEST-A";
const B = "SSTEST-B";
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
  await prisma.receipt.deleteMany({ where: { warehouse: { in: [SITE, A, B] } } });
  await prisma.deliveryPlan.deleteMany({ where: { destinationWarehouse: SITE } });
  await prisma.user.deleteMany({ where: { username: { startsWith: P } } });
  await prisma.warehouse.deleteMany({ where: { name: { in: [A, B] } } });
  await prisma.warehouse.deleteMany({ where: { name: SITE } });
}

const ids: Record<string, string> = {};
beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: SITE, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "SST" } });
  await prisma.warehouse.create({ data: { name: A, site: SITE } });
  await prisma.warehouse.create({ data: { name: B, site: SITE } });
  await mkUser("admin", "admin", null);
  await mkUser("wiA", "warehouse_incharge", A);
  await mkUser("wiSite", "warehouse_incharge", SITE); // an account from before stores were assignable
  for (const wh of [SITE, A, B]) ids[wh] = (await as("admin", "POST", "/api/receipts", { warehouse: wh, arrivalDate: "2031-06-01" })).json().id;
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

describe("a user assigned to a store", () => {
  it("lands in their site's section: /me names the store, its site and the site's type", async () => {
    expect((await as("wiA", "GET", "/api/auth/me")).json()).toMatchObject({ warehouse: A, site: SITE, warehouseType: "UNIT" });
  });

  it("sees their store's and the site's own receipts, never a sibling store's — asking by site or by store", async () => {
    for (const q of ["", `?warehouse=${SITE}`, `?warehouse=${A}`]) {
      const mine = (await as("wiA", "GET", `/api/receipts${q}`)).json().map((r: { id: string }) => r.id);
      expect(mine, q).toEqual(expect.arrayContaining([ids[A], ids[SITE]]));
      expect(mine, q).not.toContain(ids[B]);
    }
    expect((await as("wiA", "GET", `/api/receipts?warehouse=${B}`)).statusCode).toBe(403);
    expect((await as("wiA", "GET", `/api/receipts/${ids[B]}`)).statusCode).toBe(403);
  });

  it("files a new receipt at their store, numbered with the site's code", async () => {
    const res = await as("wiA", "POST", "/api/receipts", { warehouse: SITE, arrivalDate: "2031-06-02" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ warehouse: A });
    expect(res.json().id).toMatch(/^REC-SST-/);
  });

  it("is shown their site and their store in the master, not the sibling", async () => {
    const names = (await as("wiA", "GET", "/api/masters")).json().warehouses.map((w: { name: string }) => w.name);
    expect(names).toEqual(expect.arrayContaining([SITE, A]));
    expect(names).not.toContain(B);
  });

  it("plans for their own store, and never sees a plan for the sibling store", async () => {
    const plan = { supplierName: "SS Supplier", expectedArrivalDate: "2031-06-01", expectedDeliveryEnd: "2031-06-30" };
    const mine = await as("wiA", "POST", "/api/delivery-plans", plan);
    expect(mine.statusCode).toBe(201);
    expect(mine.json()).toMatchObject({ destinationWarehouse: SITE, destinationStore: A });
    const other = (await as("admin", "POST", "/api/delivery-plans", { ...plan, destinationWarehouse: SITE, destinationStore: B })).json();
    const seen = (await as("wiA", "GET", "/api/delivery-plans")).json().map((p: { id: string }) => p.id);
    expect(seen).toContain(mine.json().id);
    expect(seen).not.toContain(other.id);
    expect((await as("wiA", "GET", `/api/delivery-plans/${other.id}`)).statusCode).toBe(403);
  });
});

describe("Reception is per store: a truck and its delivery plan", () => {
  const plan = { supplierName: "SS Supplier", expectedArrivalDate: "2031-07-01", expectedDeliveryEnd: "2031-07-30" };

  it("opening a truck from a store's plan files it at that store", async () => {
    const p = (await as("admin", "POST", "/api/delivery-plans", { ...plan, destinationWarehouse: SITE, destinationStore: A })).json();
    const res = await as("admin", "POST", "/api/receipts", { deliveryPlanId: p.id, arrivalDate: "2031-07-02" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ warehouse: A, deliveryPlanId: p.id });
  });

  it("refuses a plan for one store on a truck at the sibling store — opening, batch entry and linking alike", async () => {
    const p = (await as("admin", "POST", "/api/delivery-plans", { ...plan, destinationWarehouse: SITE, destinationStore: A })).json();
    expect((await as("admin", "POST", "/api/receipts", { warehouse: B, deliveryPlanId: p.id, arrivalDate: "2031-07-02" })).statusCode).toBe(422);
    const batch = await as("admin", "POST", "/api/receipts/batch", { warehouse: B, rows: [{ "n-gate": { "VEHICLE NO.": "SS-1" } }], deliveryPlanIds: [p.id] });
    expect(batch.statusCode).toBe(422);
    expect(batch.json().error).toContain(`is for ${A}, not ${B}`);
    expect((await as("admin", "POST", `/api/receipts/${ids[B]}/delivery-plan`, { deliveryPlanId: p.id })).statusCode).toBe(422);
  });

  it("still lets a plan with no store take a truck at any store of its site", async () => {
    const p = (await as("admin", "POST", "/api/delivery-plans", { ...plan, destinationWarehouse: SITE })).json();
    expect((await as("admin", "POST", "/api/receipts", { warehouse: B, deliveryPlanId: p.id, arrivalDate: "2031-07-02" })).statusCode).toBe(201);
  });
});

describe("assigning users", () => {
  const body = { password: PW, role: "warehouse_incharge" };

  it("puts a new user on a store, and refuses the site itself", async () => {
    const ok = await as("admin", "POST", "/api/users", { ...body, username: P + "new", warehouse: B });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ warehouse: B, site: SITE, warehouseType: "UNIT" });
    expect((await as("admin", "POST", "/api/users", { ...body, username: P + "onsite", warehouse: SITE })).statusCode).toBe(422);
  });

  it("keeps an account already on a whole site working: it still sees every store, and a password reset isn't refused", async () => {
    const all = (await as("wiSite", "GET", "/api/receipts")).json().map((r: { id: string }) => r.id);
    expect(all).toEqual(expect.arrayContaining([ids[SITE], ids[A], ids[B]]));
    const user = await prisma.user.findUniqueOrThrow({ where: { username: P + "wiSite" } });
    expect((await as("admin", "PATCH", `/api/users/${user.id}`, { displayName: "Renamed" })).statusCode).toBe(200);
  });
});
