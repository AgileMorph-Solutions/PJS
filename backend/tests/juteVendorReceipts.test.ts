/**
 * Bags received from a vendor (trial observations, 02-11-2026, point 7). The point of the tab is that the bags can then be
 * issued, so what matters most is that the warehouse stock balance moves by what was RECEIVED, not what was invoiced, and
 * that a refused entry leaves the ledger untouched.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { listLedgerRows } from "../src/services/ledgers.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const A = "JVR-A";
const OTHER = "JVR-B";
const cookies: Record<string, string> = {};

async function cleanup() {
  await prisma.juteVendorReceipt.deleteMany({ where: { movement: { whLocation: { in: [A, OTHER] } } } });
  await prisma.juteWarehouseMovement.deleteMany({ where: { whLocation: { in: [A, OTHER] } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "jvr-" } } });
  await prisma.warehouse.deleteMany({ where: { name: { in: [A, OTHER] } } });
}
async function login(key: string, role: string, warehouse: string) {
  await prisma.user.create({ data: { username: `jvr-${key}`, displayName: key, role, warehouse, passwordHash: hashPassword(PW) } });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `jvr-${key}`, password: PW } });
  cookies[key] = String(res.headers["set-cookie"]);
}
beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: A, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "JVA" } });
  await prisma.warehouse.create({ data: { name: OTHER, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "JVB" } });
  await login("wi", "warehouse_incharge", A);
  await login("other", "warehouse_incharge", OTHER);
  await login("bm", "branch_manager", A);
  await login("qfs", "qfs_officer", A);
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

const post = (who: string, payload: object) =>
  app.inject({ method: "POST", url: "/api/jute-vendor-receipts", payload, headers: { cookie: cookies[who]! } });
const get = (who: string, query = "") =>
  app.inject({ method: "GET", url: `/api/jute-vendor-receipts${query}`, headers: { cookie: cookies[who]! } });
const GOOD = { vendorName: "ABC Traders", deliveryNoteNo: "DN-101", date: "2026-11-05", invoicedQty: "1000", receivedQty: "980", remarks: "20 bags missing" };
const balanceOf = async (warehouse: string) => (await listLedgerRows("warehouse-stock", [warehouse])).at(-1)?.["Balance"];

describe("recording bags received from a vendor", () => {
  it("adds what was received, not what was invoiced, to the warehouse stock balance", async () => {
    const res = await post("wi", GOOD);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      warehouse: A, vendorName: "ABC Traders", deliveryNoteNo: "DN-101", date: "2026-11-05",
      invoicedQty: 1000, receivedQty: 980, shortQty: 20, remarks: "20 bags missing", createdBy: "wi",
    });

    const rows = await listLedgerRows("warehouse-stock", [A]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ "Activities type": "JUTE BAGS PURCHASED/UNLOADINGS", "WH location": A, Date: "2026-11-05", "Bags received": "980", Balance: "980" });
  });

  it("counts as a receipt in the reconciliation, so the stock can then be issued against it", async () => {
    await post("wi", { ...GOOD, deliveryNoteNo: "DN-102", invoicedQty: "500", receivedQty: "505" });
    expect(await balanceOf(A)).toBe("1485");
    const rows = await prisma.$queryRawUnsafe<{ receipts: bigint }[]>(`SELECT receipts FROM "jute_reconciliation" WHERE warehouse_name = '${A}'`);
    expect(Number(rows[0]!.receipts)).toBe(1485);

    // An over-delivery is reported as one, never clamped to zero.
    const list = (await get("wi")).json();
    expect(list[0]).toMatchObject({ deliveryNoteNo: "DN-102", shortQty: -5 });
  });

  it("never stores the received count twice: a correction on the ledger row is what the tab shows", async () => {
    const created = (await post("wi", { ...GOOD, deliveryNoteNo: "DN-103" })).json();
    const receipt = await prisma.juteVendorReceipt.findUniqueOrThrow({ where: { id: created.id } });
    await prisma.juteWarehouseMovement.update({ where: { id: receipt.movementId }, data: { bagsReceived: 990 } });
    const shown = (await get("wi")).json().find((r: { id: string }) => r.id === created.id);
    expect(shown).toMatchObject({ receivedQty: 990, shortQty: 10 });
  });
});

describe("what it refuses", () => {
  it("writes nothing to the stock ledger when an entry is incomplete", async () => {
    const before = (await listLedgerRows("warehouse-stock", [A])).length;
    for (const bad of [{ vendorName: "" }, { deliveryNoteNo: " " }, { date: "2026-02-31" }, { invoicedQty: "1,000" }, { receivedQty: "0" }]) {
      const res = await post("wi", { ...GOOD, ...bad });
      expect(res.statusCode, JSON.stringify(bad)).toBe(422);
    }
    expect(await listLedgerRows("warehouse-stock", [A])).toHaveLength(before);
  });

  it("keeps a warehouse to its own stock", async () => {
    expect((await post("wi", { ...GOOD, warehouse: OTHER })).statusCode).toBe(403);
    expect((await get("wi", `?warehouse=${OTHER}`)).statusCode).toBe(403);
    expect((await get("other")).json()).toEqual([]);
    expect(await listLedgerRows("warehouse-stock", [OTHER])).toEqual([]);
  });

  it("is closed to the Branch Manager and the QFS Officer", async () => {
    for (const who of ["bm", "qfs"]) {
      expect((await post(who, GOOD)).statusCode).toBe(403);
      expect((await get(who)).statusCode).toBe(403);
    }
  });
});
