/**
 * Production is the factory's (Central warehouse's) work. A Unit warehouse's Incharge or QFS Officer has a role
 * that works in Production elsewhere, so policy.ts alone lets them through — this pins that the warehouse check
 * (auth/productionAccess.ts) refuses them on every /api/production/* route, reads and writes alike, before any
 * service runs. A new production route is covered by the prefix; that's the regression this guards.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const P = "patest-";
const UNIT = "PAT-UNIT";
const FACTORY = "PAT-FACTORY";
/** A site nobody gave a Central type — like BKE-04, added in Masters as a "Factory" and left without a type. */
const UNTYPED = "PAT-UNTYPED";
const cookies: Record<string, string> = {};

async function cleanup() {
  await prisma.user.deleteMany({ where: { username: { startsWith: P } } });
  await prisma.warehouse.deleteMany({ where: { name: { in: [UNIT, FACTORY, UNTYPED] } } });
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
  await prisma.warehouse.create({ data: { name: UNIT, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "PAU" } });
  await prisma.warehouse.create({ data: { name: FACTORY, kind: "FACTORY", type: "CENTRAL", code: "PAF" } });
  await prisma.warehouse.create({ data: { name: UNTYPED, kind: "FACTORY" } });
  await login("admin", "admin", null);
  await login("wiUnit", "warehouse_incharge", UNIT);
  await login("qfsUnit", "qfs_officer", UNIT);
  await login("wiFactory", "warehouse_incharge", FACTORY);
  await login("qfsFactory", "qfs_officer", FACTORY);
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

describe("production access by warehouse", () => {
  it("refuses a Unit warehouse's Incharge and QFS Officer on every production route, before anything runs", async () => {
    const routes: [string, "GET" | "POST", string, unknown?][] = [
      ["wiUnit", "GET", "/api/production/batches"],
      ["wiUnit", "GET", "/api/production/batch-bins"],
      ["wiUnit", "POST", "/api/production/batches", { code: "PAT-X", startDate: "2026-07-19", bins: ["X"] }],
      ["wiUnit", "GET", "/api/production/bin-batch/X"],
      ["wiUnit", "GET", "/api/production/btm"],
      ["qfsUnit", "GET", "/api/production/batches"],
      ["qfsUnit", "GET", "/api/production/rcn-receipts"],
      ["qfsUnit", "POST", "/api/production/sizing-checks", {}],
    ];
    for (const [who, method, url, body] of routes) {
      const res = await call(who, method, url, body);
      expect(res.statusCode, `${who} ${method} ${url}`).toBe(403);
      expect(res.json().error).toMatch(/factory/i);
    }
    expect(await prisma.productionBatch.count({ where: { code: "PAT-X" } })).toBe(0);
  });

  it("still lets the Unit Incharge do their own warehouse's work", async () => {
    expect((await call("wiUnit", "GET", "/api/receipts")).statusCode).toBe(200);
  });

  it("lets the factory's Incharge and QFS Officer, and admin, in", async () => {
    expect((await call("wiFactory", "GET", "/api/production/batches")).statusCode).toBe(200);
    expect((await call("qfsFactory", "GET", "/api/production/batches")).statusCode).toBe(200);
    expect((await call("admin", "GET", `/api/production/batches?warehouse=${FACTORY}`)).statusCode).toBe(200);
  });

  it("runs only at a Central warehouse: an admin can't open production at a site with no Central type, whatever its kind", async () => {
    const res = await call("admin", "GET", `/api/production/batches?warehouse=${UNTYPED}`);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/Production runs at a Central warehouse/);
  });

  it("keeps the role rules too: a factory QFS Officer still can't create a batch", async () => {
    expect((await call("qfsFactory", "GET", "/api/production/batch-bins")).statusCode).toBe(403);
  });
});
