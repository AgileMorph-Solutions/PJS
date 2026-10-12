/**
 * Supplier create / edit / switch off / delete, and the "no RCN" rule. A request carries a JSON
 * content-type only when it has a body, exactly as the browser client sends it (frontend request()):
 * a body-less one that claims to be JSON gets a 500 from Fastify, which is why the client doesn't.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt } from "../src/services/receipts.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const A = "SUPC-A";
let cookie = "";

async function cleanup() {
  await prisma.receipt.deleteMany({ where: { warehouse: A } });
  await prisma.supplier.deleteMany({ where: { OR: [{ code: { startsWith: "SUPC" } }, { name: { startsWith: "SUPC" } }, { code: { startsWith: "LBA-9" } }] } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "supc-" } } });
  await prisma.warehouse.deleteMany({ where: { name: A } });
}
beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: A, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "SCA" } });
  await prisma.user.create({ data: { username: "supc-a", displayName: "Ama", role: "warehouse_incharge", warehouse: A, passwordHash: hashPassword(PW) } });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "supc-a", password: PW } });
  cookie = String(res.headers["set-cookie"]).split(";")[0]!;
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined, headers: { cookie, ...(payload ? { "content-type": "application/json" } : {}) } });

describe("supplier names lose the RCN prefix", () => {
  it("stores the name without RCN and keeps the original", async () => {
    const res = await call("POST", "/api/masters/suppliers", { code: "SUPC-001", name: "RCN SUPC ALPHA" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ code: "SUPC-001", name: "SUPC ALPHA", formerName: "RCN SUPC ALPHA", active: true });
  });

  it("a name typed without RCN has no former name", async () => {
    const res = await call("POST", "/api/masters/suppliers", { code: "SUPC-002", name: "SUPC BETA" });
    expect(res.json()).toMatchObject({ name: "SUPC BETA", formerName: null });
  });
});

describe("LBA code", () => {
  it("is suggested from the name as the next free LBA-NNN-XXX", async () => {
    await prisma.supplier.create({ data: { code: "LBA-900-OLD", name: "SUPC OLD" } });
    const res = await call("GET", "/api/masters/suppliers/suggest-code?name=RCN%20SCOOPS%20SUPCGAMMA");
    expect(res.json()).toEqual({ code: "LBA-901-SUP" });
  });

  it("is filled in when the person leaves it blank, and can be overwritten when they don't", async () => {
    const auto = (await call("POST", "/api/masters/suppliers", { name: "SUPC DELTA" })).json();
    expect(auto.code).toMatch(/^LBA-\d{3}-SUP$/);
    const own = (await call("POST", "/api/masters/suppliers", { code: "SUPC-OWN", name: "SUPC EPSILON" })).json();
    expect(own.code).toBe("SUPC-OWN");
  });

  it("an existing code is refused, not silently overwritten", async () => {
    const res = await call("POST", "/api/masters/suppliers", { code: "SUPC-001", name: "SUPC SOMEONE ELSE" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/already exists/);
    expect((await prisma.supplier.findUniqueOrThrow({ where: { code: "SUPC-001" } })).name).toBe("SUPC ALPHA");
  });
});

describe("edit, switch off, delete", () => {
  it("renames, and refuses to change a code that records already carry", async () => {
    expect((await call("PATCH", "/api/masters/suppliers/SUPC-002", { name: "RCN SUPC BETA TWO" })).json()).toMatchObject({ name: "SUPC BETA TWO" });
    // Unused: the code may change.
    expect((await call("PATCH", "/api/masters/suppliers/SUPC-002", { code: "SUPC-002B" })).json().code).toBe("SUPC-002B");

    const r = await createReceipt(A, "2026-06-01");
    await prisma.receipt.update({ where: { id: r.id }, data: { lbaCode: "SUPC-001" } });
    const refused = await call("PATCH", "/api/masters/suppliers/SUPC-001", { code: "SUPC-001X" });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error).toMatch(/can't be changed/);
  });

  it("deleting a supplier that is used switches it off instead, and says so; history is untouched", async () => {
    const res = await call("DELETE", "/api/masters/suppliers/SUPC-001");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ deleted: false, deactivated: true, references: { receipts: 1, total: 1 } });
    expect(await prisma.supplier.findUnique({ where: { code: "SUPC-001" } })).toMatchObject({ active: false });
    expect(await prisma.receipt.count({ where: { lbaCode: "SUPC-001" } })).toBe(1);
  });

  it("can be switched back on", async () => {
    expect((await call("POST", "/api/masters/suppliers/SUPC-001/active", { active: true })).json().active).toBe(true);
  });

  it("deleting an unused supplier really deletes it", async () => {
    const res = await call("DELETE", "/api/masters/suppliers/SUPC-OWN");
    expect(res.json()).toMatchObject({ deleted: true, deactivated: false });
    expect(await prisma.supplier.findUnique({ where: { code: "SUPC-OWN" } })).toBeNull();
  });

  it("an unknown supplier is a 404", async () => {
    expect((await call("DELETE", "/api/masters/suppliers/NOPE-NOPE")).statusCode).toBe(404);
  });
});
