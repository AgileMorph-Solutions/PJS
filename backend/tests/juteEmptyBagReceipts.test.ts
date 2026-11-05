/**
 * Empty bags received from another warehouse (client observations list, point 8). What can go wrong without anyone noticing is
 * the direction: the reconciliation used to read every stock row naming a transfer as bags going OUT, so these tests pin that a
 * receipt comes in at the receiver, leaves the sender alone, and that a real sender's row still counts as going out.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { addLedgerRow, listLedgerRows } from "../src/services/ledgers.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const A = "JEB-A";
const B = "JEB-B";
const STORE_OF_A = "JEB-A-STORE";
const cookies: Record<string, string> = {};

async function cleanup() {
  await prisma.juteEmptyBagReceipt.deleteMany({ where: { fromWarehouse: { in: [A, B, STORE_OF_A] } } });
  await prisma.juteWarehouseMovement.deleteMany({ where: { whLocation: { in: [A, B] } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "jeb-" } } });
  await prisma.warehouse.deleteMany({ where: { name: STORE_OF_A } });
  await prisma.warehouse.deleteMany({ where: { name: { in: [A, B] } } });
}
async function login(key: string, role: string, warehouse: string) {
  await prisma.user.create({ data: { username: `jeb-${key}`, displayName: key, role, warehouse, passwordHash: hashPassword(PW) } });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `jeb-${key}`, password: PW } });
  cookies[key] = String(res.headers["set-cookie"]);
}
beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: A, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "JEA" } });
  await prisma.warehouse.create({ data: { name: B, kind: "FACTORY", type: "CENTRAL", code: "JEB" } });
  await prisma.warehouse.create({ data: { name: STORE_OF_A, site: A } });
  await login("wi", "warehouse_incharge", A);
  await login("other", "warehouse_incharge", B);
  await login("bm", "branch_manager", A);
  await login("qfs", "qfs_officer", A);
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

const post = (who: string, payload: object) =>
  app.inject({ method: "POST", url: "/api/jute-empty-bag-receipts", payload, headers: { cookie: cookies[who]! } });
const get = (who: string, query = "") =>
  app.inject({ method: "GET", url: `/api/jute-empty-bag-receipts${query}`, headers: { cookie: cookies[who]! } });
const GOOD = { fromWarehouse: B, date: "2026-03-09", truckNumber: "AA-558-PQ-01", warehouseReceiptNo: "426", bagsReceived: "1000", responsibleParty: "J. Kouassi" };
const balanceOf = async (warehouse: string) => (await listLedgerRows("warehouse-stock", [warehouse])).at(-1)?.["Balance"];
const reconciliation = async (warehouse: string) => {
  const rows = await prisma.$queryRawUnsafe<{ receipts: bigint | null; transfers_in: bigint | null; transfers_out: bigint | null; expected_closing: bigint }[]>(
    `SELECT receipts, transfers_in, transfers_out, expected_closing FROM "jute_reconciliation" WHERE warehouse_name = '${warehouse}'`
  );
  const n = (v: bigint | null) => Number(v ?? 0);
  return rows.reduce(
    (t, r) => ({ receipts: t.receipts + n(r.receipts), transfersIn: t.transfersIn + n(r.transfers_in), transfersOut: t.transfersOut + n(r.transfers_out), closing: t.closing + n(r.expected_closing) }),
    { receipts: 0, transfersIn: 0, transfersOut: 0, closing: 0 }
  );
};

describe("receiving empty bags from another warehouse", () => {
  it("adds the bags to the receiving warehouse's stock ledger, truck and receipt number included", async () => {
    const res = await post("wi", GOOD);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      warehouse: A, fromWarehouse: B, date: "2026-03-09", truckNumber: "AA-558-PQ-01", warehouseReceiptNo: "426",
      bagsReceived: 1000, responsibleParty: "J. Kouassi", createdBy: "wi",
    });
    const rows = await listLedgerRows("warehouse-stock", [A]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ "Activities type": "EMPTY BAGS TRANSFER RECEIVED", "WH location": A, "Truck number": "AA-558-PQ-01", "W/R No.": "426", "Bags received": "1000", Balance: "1000" });
  });

  it("counts as a transfer IN at the receiver, and never as a transfer out or a purchase", async () => {
    expect(await reconciliation(A)).toEqual({ receipts: 0, transfersIn: 1000, transfersOut: 0, closing: 1000 });
  });

  it("leaves the sending warehouse's stock alone, since it records its own side as bags issued", async () => {
    expect(await listLedgerRows("warehouse-stock", [B])).toEqual([]);
  });

  it("still reads a sender's real row as a transfer out, and the two sides together move the bags", async () => {
    await addLedgerRow("warehouse-stock", { "WH location": B, "Activities type": "TRANSFFER TO YAMOUSSOUKRO", "Bags issued": "1000", Date: "2026-03-09" });
    expect(await reconciliation(B)).toEqual({ receipts: 0, transfersIn: 0, transfersOut: 1000, closing: -1000 });
    expect(await balanceOf(B)).toBe("-1000");
    expect(await balanceOf(A)).toBe("1000");
  });

  it("needs no truck or receipt number", async () => {
    const res = await post("wi", { ...GOOD, truckNumber: "", warehouseReceiptNo: " " });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ truckNumber: null, warehouseReceiptNo: null });
    expect(await balanceOf(A)).toBe("2000");
  });

  it("shows a correction made on the ledger row, because the count is stored only there", async () => {
    const created = (await post("wi", GOOD)).json();
    const receipt = await prisma.juteEmptyBagReceipt.findUniqueOrThrow({ where: { id: created.id } });
    await prisma.juteWarehouseMovement.update({ where: { id: receipt.movementId }, data: { bagsReceived: 990 } });
    expect((await get("wi")).json().find((r: { id: string }) => r.id === created.id)).toMatchObject({ bagsReceived: 990 });
  });
});

describe("what it refuses", () => {
  it("writes nothing to the stock ledger when an entry is wrong", async () => {
    const before = (await listLedgerRows("warehouse-stock", [A])).length;
    for (const bad of [
      { fromWarehouse: "" }, { fromWarehouse: A }, { fromWarehouse: STORE_OF_A }, { fromWarehouse: "NO-SUCH-WAREHOUSE" },
      { date: "2026-02-31" }, { bagsReceived: "0" }, { bagsReceived: "1,000" }, { responsibleParty: " " },
    ]) {
      expect((await post("wi", { ...GOOD, ...bad })).statusCode, JSON.stringify(bad)).toBe(422);
    }
    expect(await listLedgerRows("warehouse-stock", [A])).toHaveLength(before);
  });

  it("keeps a warehouse to its own receipts", async () => {
    expect((await post("wi", { ...GOOD, warehouse: B, fromWarehouse: A })).statusCode).toBe(403);
    expect((await get("wi", `?warehouse=${B}`)).statusCode).toBe(403);
    expect((await get("other")).json()).toEqual([]);
  });

  it("is closed to the Branch Manager and the QFS Officer", async () => {
    for (const who of ["bm", "qfs"]) {
      expect((await post(who, GOOD)).statusCode).toBe(403);
      expect((await get(who)).statusCode).toBe(403);
    }
  });
});
