/**
 * Client change, Oct 2026: "Hide price/amount fields from the Warehouse In-Charge and show them to the Branch Manager."
 * What must hold: nothing the Incharge receives carries a price or an amount (truck, list, approvals, export); the Incharge can't
 * write them by any route (form, stage write, upload); the Branch Manager sets the price directly, without approval, and only on
 * their own suppliers' trucks; Admin keeps seeing everything; and the GRN lock still waits for the price the Incharge can't see.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, setStageFields } from "../src/services/receipts.js";
import { downloadWorkbook, previewWorkbook, sectionFor } from "../src/services/workbook.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const SITE = "PVX";
const MINE = "PVX-SUP-A";
const NOT_MINE = "PVX-SUP-B";
const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};
const GRN = "GRN Weight (kept separate from Gross/Net/Paid)";

async function cleanup() {
  await prisma.branchManagerSupplier.deleteMany({ where: { supplierCode: { startsWith: "PVX" } } });
  await prisma.formSubmission.deleteMany({ where: { receipt: { warehouse: SITE } } });
  await prisma.receipt.deleteMany({ where: { warehouse: SITE } });
  await prisma.supplier.deleteMany({ where: { code: { startsWith: "PVX" } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "pvx-" } } });
  await prisma.warehouse.deleteMany({ where: { name: SITE } });
}
async function login(key: string, role: string, warehouse: string | null) {
  const u = await prisma.user.create({ data: { username: `pvx-${key}`, displayName: key, role, warehouse, passwordHash: hashPassword(PW) } });
  ids[key] = u.id;
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `pvx-${key}`, password: PW } });
  cookies[key] = String(res.headers["set-cookie"]).split(";")[0]!;
}
const call = (who: string, method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined, headers: { cookie: cookies[who]!, ...(payload ? { "content-type": "application/json" } : {}) } });

/** A weighed, unloaded truck: everything the amount is calculated from except the price. */
async function truck(lba: string) {
  const r = await createReceipt(SITE, "2026-10-02");
  await setStageFields(r.id, "n-verify", { "LBA CODE": lba, "SUPPLIERS NAME": lba });
  await setStageFields(r.id, "n-gross", { "Loaded truck weight (kg)": "56300", "Tare / empty truck weight (kg)": "15000" });
  await setStageFields(r.id, "n-unload", { "BON SACS (good bags)": "463", "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "15", Refraction: "60" });
  return r.id;
}
const hasMoney = (stageData: Record<string, Record<string, string>>) => Boolean(stageData["n-grn"] && ("PRICE" in stageData["n-grn"] || "AMOUNT" in stageData["n-grn"]));

let mine: string;
let notMine: string;
beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: SITE, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "PVX" } });
  await prisma.supplier.createMany({ data: [{ code: MINE, name: "PVX A" }, { code: NOT_MINE, name: "PVX B" }] });
  await login("admin", "admin", null);
  await login("wi", "warehouse_incharge", SITE);
  await login("bm", "branch_manager", SITE);
  await prisma.branchManagerSupplier.create({ data: { userId: ids.bm!, supplierCode: MINE, assignedById: ids.admin! } });
  mine = await truck(MINE);
  notMine = await truck(NOT_MINE);
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

describe("the Branch Manager sets the price", () => {
  it("directly, with no approval; the amount follows (price × paid weight)", async () => {
    const res = await call("bm", "PUT", `/api/receipts/${mine}/price`, { price: "470" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.stageData["n-grn"]).toMatchObject({ PRICE: "470", AMOUNT: "19158140" });
    expect(await prisma.formSubmission.count({ where: { receiptId: mine } })).toBe(0);
  });

  it("only on their own suppliers' trucks, and only as a real price", async () => {
    expect((await call("bm", "PUT", `/api/receipts/${notMine}/price`, { price: "470" })).statusCode).toBe(403);
    const bad = await call("bm", "PUT", `/api/receipts/${mine}/price`, { price: "abc" });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error).toMatch(/number above 0/);
  });

  it("no longer through the approval form", async () => {
    const res = await call("bm", "POST", `/api/receipts/${mine}/submissions`, { values: { "n-grn": { PRICE: "480" } } });
    expect(res.statusCode).toBe(422);
  });
});

describe("the Warehouse Incharge never sees or writes a price", () => {
  it("not on the truck, not in the list, not in the truck's links; Admin and the Branch Manager still do", async () => {
    const one = (await call("wi", "GET", `/api/receipts/${mine}`)).json();
    expect(hasMoney(one.data?.stageData ?? one.stageData)).toBe(false);
    const list = (await call("wi", "GET", "/api/receipts")).json();
    const rows = (list.data ?? list) as { id: string; stageData: Record<string, Record<string, string>> }[];
    expect(rows.find((r) => r.id === mine)).toBeTruthy();
    expect(rows.some((r) => hasMoney(r.stageData))).toBe(false);
    for (const who of ["admin", "bm"]) {
      const r = (await call(who, "GET", `/api/receipts/${mine}`)).json();
      expect((r.data ?? r).stageData["n-grn"]).toMatchObject({ PRICE: "470", AMOUNT: "19158140" });
    }
  });

  it("can't write it by a stage write or by the price route", async () => {
    const write = await call("wi", "PATCH", `/api/receipts/${mine}/stages/n-grn`, { fields: { PRICE: "999" } });
    expect(write.statusCode).toBe(403);
    expect((await call("wi", "PUT", `/api/receipts/${mine}/price`, { price: "999" })).statusCode).toBe(403);
    // Its other GRN field is still the Incharge's to write.
    expect((await call("wi", "PATCH", `/api/receipts/${notMine}/stages/n-grn`, { fields: { [GRN]: "40000" } })).statusCode).toBe(200);
  });

  it("an export leaves the price and amount columns out for the Incharge, not for Admin; an upload of them is ignored", async () => {
    const section = await sectionFor(SITE);
    const headersOf = async (role: "warehouse_incharge" | "admin") => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await downloadWorkbook(section, {}, false, role)).buffer as ArrayBuffer);
      return (wb.getWorksheet("Truck Reception")!.getRow(1).values as unknown[]).filter(Boolean).map(String);
    };
    expect(await headersOf("warehouse_incharge")).not.toEqual(expect.arrayContaining(["Price (CFA/kg)"]));
    expect((await headersOf("warehouse_incharge")).some((h) => /Price|Amount/.test(h))).toBe(false);
    expect(await headersOf("admin")).toEqual(expect.arrayContaining(["Price (CFA/kg)", "Amount (CFA)"]));

    // The Admin's file, price column and all, uploaded by the Incharge with a changed price: the column is ignored and said so.
    const adminFile = await downloadWorkbook(section, {}, false, "admin");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(adminFile.buffer as ArrayBuffer);
    const ws = wb.getWorksheet("Truck Reception")!;
    const header = (ws.getRow(1).values as unknown[]).map(String);
    const priceCol = header.indexOf("Price (CFA/kg)");
    ws.eachRow((row, n) => { if (n > 1) row.getCell(priceCol).value = 1; });
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const preview = await previewWorkbook({ id: ids.wi!, role: "warehouse_incharge" }, section, buffer, "pvx.xlsx");
    expect(preview.notices.join(" ")).toMatch(/"Price \(CFA\/kg\)".*ignored/);
    expect(preview.totalChanged).toBe(0);
  });
});

describe("the GRN lock", () => {
  it("still waits for the price: the Incharge's GRN quantity locks a truck whose price the Branch Manager set", async () => {
    expect((await prisma.receipt.findUniqueOrThrow({ where: { id: mine } })).lockedAt).toBeNull();
    const res = await call("wi", "PATCH", `/api/receipts/${mine}/stages/n-grn`, { fields: { [GRN]: "40762" } });
    expect(res.statusCode).toBe(200);
    expect((await prisma.receipt.findUniqueOrThrow({ where: { id: mine } })).lockedAt).not.toBeNull();
    const late = await call("bm", "PUT", `/api/receipts/${mine}/price`, { price: "480" });
    expect(late.statusCode).toBe(422);
  });

  it("does not lock a truck with a GRN quantity and no price", async () => {
    expect((await prisma.receipt.findUniqueOrThrow({ where: { id: notMine } })).lockedAt).toBeNull();
  });
});
