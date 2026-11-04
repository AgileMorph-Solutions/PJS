/**
 * The production workbook: one file creates a batch, its load, the load's moisture checks, its pallets and its
 * final weight — through the same rules as the screens — and a preview writes nothing. What the file can't
 * do is as important: change a saved batch, check a load that isn't due one, weigh before moisture is OK.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, setBranch, setStageFields } from "../src/services/receipts.js";
import {
  commitProductionWorkbook, downloadProductionWorkbook, previewProductionWorkbook,
} from "../src/services/productionWorkbook.js";
import { listRcnReceipts } from "../src/services/production/rcnReceipts.js";

const prisma = new PrismaClient();
const app = buildApp();
const SITE = "PWB-FACTORY";
const GRN = "GRN Weight (kept separate from Gross/Net/Paid)";
let wi: { id: string; role: "warehouse_incharge" };
let qfsCookie = "";

async function cleanup() {
  await prisma.rcnPallet.deleteMany({ where: { rcnReceipt: { batch: { warehouse: SITE } } } });
  await prisma.rcnEmptyPalletStack.deleteMany({ where: { rcnReceipt: { batch: { warehouse: SITE } } } });
  await prisma.rcnMoistureCheck.deleteMany({ where: { rcnReceipt: { batch: { warehouse: SITE } } } });
  await prisma.rcnReceipt.deleteMany({ where: { batch: { warehouse: SITE } } });
  await prisma.productionBatch.deleteMany({ where: { warehouse: SITE } });
  await prisma.receipt.deleteMany({ where: { warehouse: SITE } });
  await prisma.bin.deleteMany({ where: { code: { startsWith: "PWB-" } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "pwb-" } } });
  await prisma.warehouse.deleteMany({ where: { name: SITE } });
}

async function lotInBin(bin: string, kg: string) {
  const r = await createReceipt(SITE, "2026-06-01");
  await setBranch(r.id, "n-qfs", "pass");
  await setStageFields(r.id, "n-bin", { "Bin Number": bin }, { bypassValidation: true });
  await setStageFields(r.id, "n-grn", { [GRN]: kg, PRICE: "470" }, { bypassValidation: true });
  await setBranch(r.id, "n-drying", "none");
  await setBranch(r.id, "n-xferdec", "stays");
}

/** An .xlsx with the given tabs: first row the headers, then the rows. */
async function xlsx(tabs: Record<string, (string | number | null)[][]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [title, rows] of Object.entries(tabs)) {
    const ws = wb.addWorksheet(title);
    for (const r of rows) ws.addRow(r);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const BATCHES = ["Batch Name", "Start Date", "Bins", "Proposed By"];
const LOADS = ["RCN Receipt ID", "Batch Name", "Date", "BTM No", "Source Bin"];
const CHECKS = ["Check ID", "RCN Receipt ID", "BTM No", "Moisture (%)", "Nut Count", "Sample Weight (g)", "GK (g)", "Spot (g)", "Immature (g)", "Result"];
const PALLETS = ["Pallet ID", "RCN Receipt ID", "BTM No", "Gross Weight (kg)", "No of Bags", "Factory Bin"];
const FINAL = ["RCN Receipt ID", "BTM No", "Empty Pallets Weight (kg)", "No of Pallets", "Dust (kg)", "Voids (kg)"];

const preview = (buf: Buffer) => previewProductionWorkbook(wi, SITE, buf, "test.xlsx");
const byName = (p: Awaited<ReturnType<typeof preview>>, name: string) => p.sheets.find((s) => s.name === name)!;

beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: SITE, kind: "FACTORY", type: "CENTRAL", code: "PWB" } });
  for (const code of ["PWB-03B", "PWB-10", "PWB-11"]) await prisma.bin.create({ data: { code } });
  await lotInBin("PWB-03B", "2950400");
  await lotInBin("PWB-10", "878200");
  await lotInBin("PWB-11", "640000");
  const u = await prisma.user.create({ data: { username: "pwb-wi", displayName: "wi", role: "warehouse_incharge", warehouse: SITE, passwordHash: hashPassword("test-password-1") } });
  wi = { id: u.id, role: "warehouse_incharge" };
  await prisma.user.create({ data: { username: "pwb-qfs", displayName: "qfs", role: "qfs_officer", warehouse: SITE, passwordHash: hashPassword("test-password-1") } });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "pwb-qfs", password: "test-password-1" } });
  qfsCookie = String(res.headers["set-cookie"]).split(";")[0]!;
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

describe("the sample", () => {
  it("is one file with a tab per Phase 1 step, headers only", async () => {
    const built = await downloadProductionWorkbook(SITE, {}, true);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(built.buffer as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Batches", "RCN Receipts", "Moisture Checks", "Pallets", "Final Weight"]);
    expect(wb.worksheets.every((w) => w.actualRowCount === 1)).toBe(true);
    expect(built.filename).toBe("ANAGROCI - Production - Sample.xlsx");
  });
});

describe("one file, the whole of Intake", () => {
  const file = () => xlsx({
    Batches: [BATCHES, ["PWB-ANA-03B", "2026-07-19", "PWB-03B / PWB-10", "Warehouse team"]],
    "RCN Receipts": [LOADS, [null, "PWB-ANA-03B", "2026-07-20", "109", "PWB-03B"]],
    // Too wet first, then OK after drying: two rows for one load, in the order they happened.
    "Moisture Checks": [CHECKS, [null, null, "109", 11.2, 180, 1000, 230, 12, 13, "Hold"], [null, null, "109", 9.8, 180, 1000, 230, 12, 13, "OK"]],
    Pallets: [PALLETS, [null, null, "109", 2335, 30, "ANA-03B"], [null, null, "109", 2445.4, 30, "ANA-03B"]],
    "Final Weight": [FINAL, [null, "109", "120 / 80", "1 / 1", 2.5, ""]],
  });

  it("previews every row as new, and writes nothing", async () => {
    const p = await preview(await file());
    expect(p.errorCount).toBe(0);
    expect(p.sheets.map((s) => [s.name, s.created])).toEqual([["Batches", 1], ["RCN Receipts", 1], ["Moisture Checks", 2], ["Pallets", 2], ["Final Weight", 1]]);
    expect(await prisma.productionBatch.count({ where: { warehouse: SITE } })).toBe(0);
    expect(await prisma.rcnReceipt.count({ where: { batch: { warehouse: SITE } } })).toBe(0);
  });

  it("applies it: the load is Intake done, and an Incharge's checks are approved as they are saved", async () => {
    const p = await preview(await file());
    const done = await commitProductionWorkbook(wi, p.token);
    expect(done.totalCreated).toBe(7);
    const [load] = await listRcnReceipts(SITE);
    expect(load).toMatchObject({ batchCode: "PWB-ANA-03B", btmNo: "109", binCode: "PWB-03B", status: "intake_done" });
    expect(load!.moistureChecks.map((c) => [c.decision, c.status])).toEqual([["hold", "approved"], ["ok", "approved"]]);
    expect(load!.pallets.map((p) => p.grossKg)).toEqual(["2335", "2445.4"]);
    expect(load!.finalWeight).toMatchObject({ emptyPallets: [{ weightKg: "120", count: "1" }, { weightKg: "80", count: "1" }], dustKg: "2.5", voidsKg: "" });
  });

  it("a token is used once", async () => {
    const p = await preview(await xlsx({ Batches: [BATCHES] }));
    await commitProductionWorkbook(wi, p.token);
    await expect(commitProductionWorkbook(wi, p.token)).rejects.toThrow(/expired/);
  });

  it("an export uploaded back unchanged changes nothing", async () => {
    const built = await downloadProductionWorkbook(SITE, {}, false);
    const p = await preview(Buffer.from(built.buffer as ArrayBuffer));
    expect(p.errorCount).toBe(0);
    expect(p.totalCreated + p.totalChanged).toBe(0);
    expect(byName(p, "Pallets").unchanged).toBe(2);
  });
});

describe("what the file can't do — the screens' own refusals, row by row", () => {
  it("won't put a bin in a second batch, or change a saved one", async () => {
    const p = await preview(await xlsx({
      Batches: [BATCHES, ["PWB-NEW", "2026-08-01", "PWB-03B", ""], ["PWB-ANA-03B", "2026-07-25", "PWB-03B / PWB-10", "Warehouse team"]],
    }));
    expect(byName(p, "Batches").errors.map((e) => [e.row, e.message])).toEqual([
      [2, expect.stringMatching(/PWB-03B is already in batch PWB-ANA-03B/)],
      [3, expect.stringMatching(/Batch PWB-ANA-03B is already saved.*Start Date/)],
    ]);
  });

  it("refuses a check for a load that isn't due one, and pallets before moisture is OK", async () => {
    const p = await preview(await xlsx({
      "RCN Receipts": [LOADS, [null, "PWB-ANA-03B", "2026-07-21", "110", "PWB-10"]],
      Pallets: [PALLETS, [null, null, "110", 2000, 30, "ANA-03B"]],
      "Moisture Checks": [CHECKS, [null, null, "109", 9.5, 180, null, null, null, null, "OK"]],
    }));
    expect(byName(p, "RCN Receipts").created).toBe(1);
    expect(byName(p, "Moisture Checks").errors[0]!.message).toMatch(/Intake done; no moisture check is due/);
    expect(byName(p, "Pallets").errors[0]!.message).toMatch(/Waiting for moisture; it can't be weighed now/);
    await expect(commitProductionWorkbook(wi, p.token)).rejects.toThrow(/nothing was written/);
    expect(await prisma.rcnReceipt.count({ where: { batch: { warehouse: SITE } } })).toBe(1);
  });

  it("asks for the RCN Receipt ID when a BTM No is on two loads, and warns about the repeat", async () => {
    const p = await preview(await xlsx({
      "RCN Receipts": [LOADS, [null, "PWB-ANA-03B", "2026-07-22", "109", "PWB-03B"]],
      "Moisture Checks": [CHECKS, [null, null, "109", 9.5, 180, null, null, null, null, "OK"]],
    }));
    expect(byName(p, "RCN Receipts").warnings[0]!.message).toMatch(/BTM 109 from PWB-03B is already on RR-PWB-2026-0001/);
    expect(byName(p, "Moisture Checks").errors[0]!.message).toMatch(/BTM 109 is on 2 loads .* Give the RCN Receipt ID/);
  });

  it("won't change a closed load's pallets, and reports an unknown ID rather than creating a row", async () => {
    const [load] = await listRcnReceipts(SITE);
    const p = await preview(await xlsx({
      Pallets: [PALLETS, [load!.pallets[0]!.id, null, null, 9999, 30, "ANA-03B"], [999999, null, null, 1, 1, "X"]],
    }));
    const errors = byName(p, "Pallets").errors.map((e) => e.message);
    expect(errors[0]).toMatch(/Intake done; it can't be weighed now/);
    expect(errors[1]).toMatch(/Pallet 999999 doesn't exist/);
  });

  it("a column the tab needs must be there", async () => {
    const p = await preview(await xlsx({ Pallets: [["Gross Weight (kg)", "No of Bags"], [1, 1]] }));
    expect(byName(p, "Pallets").errors[0]!.message).toMatch(/"Pallet ID" column is missing/);
  });
});

describe("who may upload", () => {
  it("a QFS Officer keeps entering checks on screen, for the Incharge to approve", async () => {
    const res = await app.inject({ method: "GET", url: "/api/production/workbook/info", headers: { cookie: qfsCookie } });
    expect(res.statusCode).toBe(403);
  });
});
