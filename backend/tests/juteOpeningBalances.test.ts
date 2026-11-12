/**
 * A warehouse's opening jute bag count (trial observations, 02-11-2026, point 7). The balance only stays right if the opening
 * sorts first however late it is entered, so that is what these guard, along with the one-per-warehouse rule.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { addLedgerRow, listLedgerRows } from "../src/services/ledgers.js";
import { negativeBalanceRows } from "../src/domain/juteBalance.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const A = "JOB-A";
const OTHER = "JOB-B";
const cookies: Record<string, string> = {};

async function cleanup() {
  await prisma.juteOpeningBalance.deleteMany({ where: { movement: { whLocation: { in: [A, OTHER] } } } });
  await prisma.juteWarehouseMovement.deleteMany({ where: { whLocation: { in: [A, OTHER] } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "job-" } } });
  await prisma.warehouse.deleteMany({ where: { name: { in: [A, OTHER] } } });
}
async function login(key: string, role: string, warehouse: string | null) {
  await prisma.user.create({ data: { username: `job-${key}`, displayName: key, role, warehouse, passwordHash: hashPassword(PW) } });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `job-${key}`, password: PW } });
  cookies[key] = String(res.headers["set-cookie"]);
}
beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: A, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "JOA" } });
  await prisma.warehouse.create({ data: { name: OTHER, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "JOB" } });
  await login("wi", "warehouse_incharge", A);
  await login("other", "warehouse_incharge", OTHER);
  await login("admin", "admin", null);
  await login("bm", "branch_manager", A);
  await login("qfs", "qfs_officer", A);
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

const put = (who: string, payload: object) =>
  app.inject({ method: "PUT", url: "/api/jute-opening-balances", payload, headers: { cookie: cookies[who]! } });
const get = (who: string, query = "") =>
  app.inject({ method: "GET", url: `/api/jute-opening-balances${query}`, headers: { cookie: cookies[who]! } });
const issue = (bags: string) => addLedgerRow("warehouse-stock", { "Activities type": "SUPPLIER X", "WH location": A, Date: "2026-10-01", "Bags issued": bags });
const balances = async (warehouse: string) => (await listLedgerRows("warehouse-stock", [warehouse])).map((r) => r["Balance"]);

describe("the opening balance", () => {
  it("sorts first even when rows already exist, so a balance that was negative is worked out from it", async () => {
    await issue("300");
    expect(await balances(A)).toEqual(["-300"]);
    expect((await negativeBalanceRows()).some((r) => r.whLocation === A)).toBe(true);

    const res = await put("wi", { bags: "5000", date: "2026-09-01", remarks: "Physical count" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ warehouse: A, bags: 5000, date: "2026-09-01", remarks: "Physical count", createdBy: "wi", updatedBy: null });

    expect(await balances(A)).toEqual(["5000", "4700"]);
    expect((await negativeBalanceRows()).some((r) => r.whLocation === A)).toBe(false);
    expect((await listLedgerRows("warehouse-stock", [A]))[0]).toMatchObject({ "Activities type": "OPENING BALANCE", "Bags received": "5000", Date: "2026-09-01" });
  });

  it("stays first when later rows are added, however many warehouses have one", async () => {
    await put("other", { bags: "0", date: "2026-09-01" }); // A warehouse can genuinely start with no bags.
    await issue("200");
    expect(await balances(A)).toEqual(["5000", "4700", "4500"]);
    expect(await balances(OTHER)).toEqual(["0"]);
  });

  it("fills the reconciliation's opening, and counts as neither a receipt nor an issue", async () => {
    const rows = await prisma.$queryRawUnsafe<{ period: string; opening: bigint | null; receipts: bigint | null }[]>(
      `SELECT period, opening, receipts FROM "jute_reconciliation" WHERE warehouse_name = '${A}' AND period = '2026-09'`
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.opening)).toBe(5000);
    expect(rows[0]!.receipts).toBeNull();
  });

  it("can't be typed in as an ordinary ledger row, where it would sort last", async () => {
    await expect(addLedgerRow("warehouse-stock", { "Activities type": "opening balance", "WH location": OTHER, Date: "2026-10-01", "Bags received": "9" }))
      .rejects.toThrow(/Opening stock/);
  });
});

describe("changing it", () => {
  it("is allowed to the Warehouse Incharge for their own warehouse: the same row changes, every balance follows, and it records who", async () => {
    const res = await put("wi", { bags: "9000", date: "2026-09-01" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ bags: 9000, createdBy: "wi", updatedBy: "wi" });
    expect(await balances(A)).toEqual(["9000", "8700", "8500"]);
    expect((await get("wi")).json()).toHaveLength(1);
  });

  it("is allowed to an Admin too, and records who changed it last", async () => {
    const res = await put("admin", { warehouse: A, bags: "6000", date: "2026-09-02", remarks: "Recount" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ bags: 6000, date: "2026-09-02", remarks: "Recount", createdBy: "wi", updatedBy: "admin" });
    expect(await balances(A)).toEqual(["6000", "5700", "5500"]);
    expect((await get("wi")).json()).toHaveLength(1);
  });

  it("is still refused to another warehouse's Incharge", async () => {
    expect((await put("other", { warehouse: A, bags: "1", date: "2026-09-01" })).statusCode).toBe(403);
    expect(await balances(A)).toEqual(["6000", "5700", "5500"]);
  });

  it("holds one per warehouse in the database itself, not only in the service", async () => {
    await expect(prisma.juteWarehouseMovement.create({ data: { seq: -9999, activitiesType: "OPENING BALANCE", whLocation: A, bagsReceived: 1 } })).rejects.toThrow();
  });
});

describe("what it refuses", () => {
  it("won't save a count that isn't one", async () => {
    for (const bad of [{ bags: "" }, { bags: "1,000" }, { bags: "-5" }, { date: "2026-02-31" }]) {
      const res = await put("admin", { warehouse: A, bags: "1", date: "2026-09-01", ...bad });
      expect(res.statusCode, JSON.stringify(bad)).toBe(422);
    }
    expect(await balances(A)).toEqual(["6000", "5700", "5500"]);
  });

  it("keeps a warehouse to its own, and is closed to the Branch Manager and the QFS Officer", async () => {
    expect((await put("wi", { warehouse: OTHER, bags: "1", date: "2026-09-01" })).statusCode).toBe(403);
    expect((await get("wi", `?warehouse=${OTHER}`)).statusCode).toBe(403);
    for (const who of ["bm", "qfs"]) {
      expect((await put(who, { bags: "1", date: "2026-09-01" })).statusCode).toBe(403);
      expect((await get(who)).statusCode).toBe(403);
    }
  });
});

describe("the Excel workbook", () => {
  async function exportWorkbook() {
    const res = await app.inject({ method: "GET", url: "/api/workbook", headers: { cookie: cookies.wi! } });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.rawPayload as unknown as ArrayBuffer);
    return wb;
  }
  async function preview(wb: ExcelJS.Workbook) {
    const boundary = "----job" + Math.random().toString(16).slice(2);
    const file = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="workbook.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
      file, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({ method: "POST", url: "/api/workbook/preview", payload, headers: { cookie: cookies.wi!, "content-type": `multipart/form-data; boundary=${boundary}` } });
    return res.json().sheets.find((x: { name: string }) => x.name === "Jute Bags");
  }
  const openingRow = (ws: ExcelJS.Worksheet) => {
    for (let r = 2; r <= ws.rowCount; r++) {
      if ((ws.getRow(r).values as unknown[]).includes("OPENING BALANCE")) return r;
    }
    throw new Error("the opening balance isn't in the file");
  };

  it("exports the opening row, and uploading the file back unchanged writes nothing", async () => {
    const sheet = await preview(await exportWorkbook());
    expect(sheet).toMatchObject({ changed: 0, errorCount: 0 });
  });

  it("won't let an upload change it, which would skip its validation and its record of who changed it", async () => {
    const wb = await exportWorkbook();
    const ws = wb.getWorksheet("Jute Bags")!;
    const heads = (ws.getRow(1).values as unknown[]).map(String);
    const col = heads.findIndex((h) => /bags received/i.test(h));
    expect(col).toBeGreaterThan(0);
    ws.getRow(openingRow(ws)).getCell(col).value = 999999;
    const sheet = await preview(wb);
    expect(sheet.errorCount).toBe(1);
    expect(sheet.errors[0].message).toMatch(/Opening stock/);
  });
});

describe("different warehouses", () => {
  it("won't save for an Admin who hasn't said which warehouse, and lists every warehouse's own figure", async () => {
    const res = await put("admin", { bags: "1", date: "2026-09-01" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/warehouse is required/);

    const all = (await get("admin")).json() as { warehouse: string; bags: number }[];
    expect(all.find((o) => o.warehouse === A)?.bags).toBe(6000);
    expect(all.find((o) => o.warehouse === OTHER)?.bags).toBe(0);
    expect((await get("wi")).json().map((o: { warehouse: string }) => o.warehouse)).toEqual([A]);
  });

  it("keeps each warehouse's balance apart: one warehouse's opening never moves another's", async () => {
    expect(await balances(A)).toEqual(["6000", "5700", "5500"]);
    expect(await balances(OTHER)).toEqual(["0"]);
  });
});
