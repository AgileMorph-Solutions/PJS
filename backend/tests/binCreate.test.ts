/** Creating a Bin from Masters: needs a store, a clean unique code, and says why when it refuses. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const SITE = "BINC-SITE";
const STORE = "BINC-STORE";
let cookie = "";

async function cleanup() {
  await prisma.bin.deleteMany({ where: { code: { startsWith: "BINC" } } });
  await prisma.user.deleteMany({ where: { username: "binc-wi" } });
  await prisma.warehouse.deleteMany({ where: { name: STORE } });
  await prisma.warehouse.deleteMany({ where: { name: SITE } });
}
beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: SITE, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "BNC" } });
  await prisma.warehouse.create({ data: { name: STORE, site: SITE } });
  await prisma.user.create({ data: { username: "binc-wi", displayName: "Ama", role: "warehouse_incharge", warehouse: SITE, passwordHash: hashPassword(PW) } });
  cookie = String((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "binc-wi", password: PW } })).headers["set-cookie"]).split(";")[0]!;
});
afterAll(async () => { await cleanup(); await prisma.$disconnect(); await app.close(); });

const post = (payload: unknown) => app.inject({ method: "POST", url: "/api/masters/bins", payload: payload as object, headers: { cookie, "content-type": "application/json" } });

describe("creating a Bin", () => {
  it("stores it upper-cased in its store, stamped with when it was made, and the masters list says which store it is in", async () => {
    const res = await post({ code: " binc-001 ", warehouseName: STORE });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ code: "BINC-001", warehouseName: STORE, source: "entered" });
    expect(res.json().createdAt).toBeTruthy();
    const info = (await app.inject({ method: "GET", url: "/api/masters", headers: { cookie } })).json().binInfo;
    expect(info).toContainEqual({ code: "BINC-001", store: STORE });
  });

  it("refuses a duplicate instead of merging it, a missing or unknown store, a store's own code, and a code with spaces or slashes", async () => {
    const cases: [object, RegExp][] = [
      [{ code: "BINC-001", warehouseName: STORE }, /already exists/],
      [{ code: "BINC-002" }, /Choose the store/],
      [{ code: "BINC-002", warehouseName: "NOWHERE" }, /isn't a store/],
      [{ code: STORE, warehouseName: STORE }, /is a store/],
      [{ code: "BINC 3", warehouseName: STORE }, /can only use letters, digits/],
      [{ code: "BINC/4", warehouseName: STORE }, /can only use letters, digits/],
      [{ code: "", warehouseName: STORE }, /needs a code/],
    ];
    for (const [body, message] of cases) {
      const res = await post(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(422);
      expect(res.json().error).toMatch(message);
    }
    expect(await prisma.bin.count({ where: { code: { startsWith: "BINC" } } })).toBe(1);
  });
});
