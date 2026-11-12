/**
 * Warehouses come only from the master, and a non-admin sees only their own. Pins: /api/masters returns a non-admin
 * their own site, its stores and its Bins (never another site's); only an admin adds a warehouse, and nobody adds a
 * store (they aren't a concept any more); a non-admin adds Bins only at their own warehouse; and a Unit warehouse still learns where it may send a BKT without
 * being shown the rest of the master. Made-up site names, so nothing depends on a particular client site existing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const P = "wstest-";
const UNIT = "WST-UNIT";
const CENTRAL = "WST-CENTRAL";
const STORES = ["WST-U-001", "WST-C-001", "WST-U-NEW", "WST-X-NEW"];
const BINS = ["WST-U-001-BIN-1", "WST-C-001-BIN-1", "WST-C-001-BIN-2"];
const cookies: Record<string, string> = {};

async function cleanup() {
  await prisma.user.deleteMany({ where: { username: { startsWith: P } } });
  await prisma.bin.deleteMany({ where: { code: { in: BINS } } });
  await prisma.warehouse.deleteMany({ where: { name: { in: [...STORES, "WST-NEW-SITE"] } } });
  await prisma.warehouse.deleteMany({ where: { name: { in: [UNIT, CENTRAL] } } });
}

async function login(key: string, role: string, warehouse: string | null) {
  await prisma.user.create({ data: { username: P + key, displayName: key, role, warehouse, passwordHash: hashPassword(PW) } });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: P + key, password: PW } });
  expect(res.statusCode, `login ${key}`).toBe(200);
  cookies[key] = String(res.headers["set-cookie"]).split(";")[0]!;
}

const call = (who: string, method: "GET" | "POST", url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined, headers: { cookie: cookies[who]!, ...(payload ? { "content-type": "application/json" } : {}) } });

beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: UNIT, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "WSU" } });
  await prisma.warehouse.create({ data: { name: CENTRAL, kind: "FACTORY", type: "CENTRAL", code: "WSC" } });
  await prisma.warehouse.create({ data: { name: "WST-U-001", site: UNIT } });
  await prisma.warehouse.create({ data: { name: "WST-C-001", site: CENTRAL } });
  await prisma.bin.create({ data: { code: "WST-U-001-BIN-1", warehouseName: "WST-U-001" } });
  await prisma.bin.create({ data: { code: "WST-C-001-BIN-1", warehouseName: "WST-C-001" } });
  await login("admin", "admin", null);
  await login("wiUnit", "warehouse_incharge", UNIT);
  await login("bmUnit", "branch_manager", UNIT);
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

const names = (body: { warehouses: { name: string }[] }) => body.warehouses.map((w) => w.name);

describe("the warehouses master is scoped to the viewer", () => {
  it("shows a non-admin their own site, its stores and Bins — and nothing of another site", async () => {
    for (const who of ["wiUnit", "bmUnit"]) {
      const res = await call(who, "GET", "/api/masters");
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(names(body)).toEqual(expect.arrayContaining([UNIT, "WST-U-001"]));
      expect(names(body)).not.toContain(CENTRAL);
      expect(names(body)).not.toContain("WST-C-001");
      expect(body.bins).toContain("WST-U-001-BIN-1");
      expect(body.bins).not.toContain("WST-C-001-BIN-1");
    }
  });

  it("shows an admin every warehouse", async () => {
    const body = (await call("admin", "GET", "/api/masters")).json();
    expect(names(body)).toEqual(expect.arrayContaining([UNIT, CENTRAL, "WST-U-001", "WST-C-001"]));
    expect(body.bins).toEqual(expect.arrayContaining(["WST-U-001-BIN-1", "WST-C-001-BIN-1"]));
  });
});

describe("who adds warehouses", () => {
  it("lets only an admin add a new site", async () => {
    expect((await call("wiUnit", "POST", "/api/masters/warehouses", { name: "WST-NEW-SITE", kind: "VILLAGE" })).statusCode).toBe(403);
    expect(await prisma.warehouse.count({ where: { name: "WST-NEW-SITE" } })).toBe(0);
    expect((await call("admin", "POST", "/api/masters/warehouses", { name: "WST-NEW-SITE", kind: "VILLAGE" })).statusCode).toBe(201);
  });

  it("adds a warehouse with its category in one step, and refuses a store from anyone", async () => {
    const res = await call("admin", "POST", "/api/masters/warehouses", { name: "WST-X-NEW", kind: "FACTORY", type: "CENTRAL" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: "WST-X-NEW", site: null, type: "CENTRAL" });
    expect((await call("admin", "POST", "/api/masters/warehouses", { name: "WST-U-NEW", site: UNIT })).statusCode).toBe(422);
    expect((await call("wiUnit", "POST", "/api/masters/warehouses", { name: "WST-U-NEW", site: UNIT })).statusCode).toBe(403);
    expect(await prisma.warehouse.count({ where: { name: "WST-U-NEW" } })).toBe(0);
  });

  it("lets a non-admin add Bins only at their own warehouse", async () => {
    expect((await call("wiUnit", "POST", "/api/masters/bins", { code: "WST-C-001-BIN-2", warehouseName: "WST-C-001" })).statusCode).toBe(403);
    expect(await prisma.bin.count({ where: { code: "WST-C-001-BIN-2" } })).toBe(0);
  });
});

describe("BKT destinations", () => {
  it("tells a Unit warehouse which Central warehouses (and their stores) it may send to, without opening the rest of the master", async () => {
    const res = await call("wiUnit", "GET", "/api/transfers/destinations");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toContainEqual({ site: CENTRAL, stores: ["WST-C-001"] });
    expect(res.json().map((d: { site: string }) => d.site)).not.toContain(UNIT);
    // Another warehouse's destinations are not theirs to ask for.
    expect((await call("wiUnit", "GET", `/api/transfers/destinations?from=${encodeURIComponent(CENTRAL)}`)).statusCode).toBe(403);
    expect((await call("bmUnit", "GET", "/api/transfers/destinations")).statusCode).toBe(403);
  });
});
