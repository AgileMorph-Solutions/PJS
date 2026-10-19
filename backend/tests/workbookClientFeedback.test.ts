/**
 * The client's Oct 2026 workbook asks, through the file itself: Receipt Status and the plan columns on
 * Truck Reception, the cut-test grams (so KOR is calculated), GRN Quantity, a Delivery Plan sheet, and one
 * BKT row per truck with its variance. On a throwaway warehouse pair so nothing real is touched.
 *
 * The rules under test: the derived columns are SHOWN and never written; the two new sheets are for
 * reading, and an upload that changes them is told so rather than silently ignored; an older export
 * with the old GRN header still uploads.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, setBranch, setStageFields } from "../src/services/receipts.js";
import { createDeliveryPlan } from "../src/services/deliveryPlans.js";
import { createTransfer, dispatchTransfer, receiveTransfer } from "../src/services/transfers.js";
import { approveException } from "../src/services/receiptPlanInfo.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const A = "WBCF-A";
const B = "WBCF-B";
const STORE = "WBCF-A-STORE";
const GRN = "GRN Weight (kept separate from Gross/Net/Paid)";
let cookie = "";
let planId = "";
let onPlan = "";
let offPlan = "";
let unplanned = "";
let bkt = "";
let approver = "";

async function cleanup() {
  await prisma.transferRequest.deleteMany({ where: { fromWarehouse: A } });
  await prisma.receipt.deleteMany({ where: { warehouse: { in: [A, B] } } });
  await prisma.deliveryPlan.deleteMany({ where: { destinationWarehouse: A } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "wbcf-" } } });
  await prisma.warehouse.deleteMany({ where: { site: { in: [A, B] } } });
  await prisma.warehouse.deleteMany({ where: { name: { in: [A, B] } } });
}

beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: A, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "WCA" } });
  await prisma.warehouse.create({ data: { name: B, kind: "FACTORY", type: "CENTRAL", code: "WCB" } });
  await prisma.warehouse.create({ data: { name: STORE, site: A } });
  const u = await prisma.user.create({ data: { username: "wbcf-a", displayName: "Ama", role: "warehouse_incharge", warehouse: A, passwordHash: hashPassword(PW) } });
  approver = u.id;
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "wbcf-a", password: PW } });
  cookie = String(res.headers["set-cookie"]).split(";")[0]!;

  const plan = await createDeliveryPlan({
    supplierName: "WB Supplier", supplierCode: "LBA-WB", expectedOrigin: "VAVOUA", expectedQuantityKg: 50000, expectedTrucks: 2,
    expectedArrivalDate: "2035-05-01", expectedDeliveryEnd: "2035-05-31", destinationWarehouse: A, destinationStore: STORE,
  });
  planId = plan.id;
  const truck = async (against: string | undefined, origin: string, grn: string, veh: string) => {
    const r = await createReceipt(A, "2035-05-10", against);
    await setStageFields(r.id, "n-gate", { "VEHICLE NO.": veh, "WH NO.": STORE });
    await setStageFields(r.id, "n-verify", { "SUPPLIERS NAME": "WB Supplier", "LBA CODE": "LBA-WB", ORIGIN: origin });
    await setStageFields(r.id, "n-qfs", { "MOIS. (moisture)": "10.2", KOR: "47.5" });
    await setBranch(r.id, "n-qfs", "pass");
    await setStageFields(r.id, "n-unload", { "BON SACS (good bags)": "100" });
    await setStageFields(r.id, "n-grn", { [GRN]: grn });
    return r.id;
  };
  onPlan = await truck(planId, "VAVOUA", "30000", "WBCF-T1");
  offPlan = await truck(planId, "MANKONO", "25000", "WBCF-T2"); // origin differs, and pushes it over 50,000 kg
  unplanned = await truck(undefined, "VAVOUA", "10000", "WBCF-T3");
  await approveException(offPlan, approver, "Called the supplier");

  const onTruck = await truck(undefined, "VAVOUA", "48000", "WBCF-T4"); // the Lot that goes to the other warehouse
  const t = await createTransfer({ transferDate: "2035-05-20", fromWarehouse: A, toWarehouse: B, lines: [{ receiptId: onTruck, bags: 590 }] });
  bkt = t.id;
  await dispatchTransfer(bkt, { whReceiptNo: "WR-D", truckNo: "WBCF-RIG-1", dispatchedGrossKg: 48880 });
  await receiveTransfer(bkt, { whReceiptNo: "WR-R", bagsReceived: 574, receivedGrossKg: 48820, receivedComment: "16 bags short on the road" });
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

const get = (url: string) => app.inject({ method: "GET", url, headers: { cookie } });
const load = async (buf: Buffer | ArrayBuffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as ArrayBuffer); return wb; };
const exported = async () => load((await get("/api/workbook")).rawPayload);
const headersOf = (ws: ExcelJS.Worksheet) => (ws.getRow(1).values as unknown[]).slice(1).map(String);
/** One row of a sheet as {header: value}, found by the value in its first column. */
const rowOf = (ws: ExcelJS.Worksheet, id: string) => {
  const heads = headersOf(ws);
  for (let r = 2; r <= ws.rowCount; r++) {
    if (String(ws.getRow(r).getCell(1).value) === id) return { r, cells: Object.fromEntries(heads.map((h, i) => [h, ws.getRow(r).getCell(i + 1).value])) as Record<string, any> };
  }
  throw new Error(`no row ${id} on ${ws.name}`);
};
const setCell = (ws: ExcelJS.Worksheet, row: number, header: string, value: unknown) => { ws.getRow(row).getCell(headersOf(ws).indexOf(header) + 1).value = value as ExcelJS.CellValue; };

function multipart(file: Buffer | ArrayBuffer) {
  const boundary = "----wbcf" + Math.random().toString(16).slice(2);
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="workbook.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
    Buffer.from(file as ArrayBuffer), Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, contentType: `multipart/form-data; boundary=${boundary}` };
}
const preview = async (wb: ExcelJS.Workbook) => {
  const m = multipart(Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer));
  return app.inject({ method: "POST", url: "/api/workbook/preview", payload: m.payload, headers: { cookie, "content-type": m.contentType } });
};
const sheet = (body: any, title: string) => body.sheets.find((s: any) => s.name === title);

describe("Truck Reception shows where each truck stands, and never takes it back", () => {
  it("Receipt Status, Reception Type, flags, plan link and approval are columns, worked out for each truck", async () => {
    const ws = (await exported()).getWorksheet("Truck Reception")!;
    expect(rowOf(ws, onPlan).cells).toMatchObject({
      "Receipt Status": "GRN completed", "Delivery Plan ID": planId, "Reception Type": "Planned", "Planning / Exception Flag": null,
      "Plan Link Status": "Planned from start", "Exception Approval Status": "Not required", "GRN Quantity (kg)": "30000",
    });
    expect(rowOf(ws, offPlan).cells).toMatchObject({
      "Reception Type": "Planned with exception", "Exception Approval Status": "Approved",
      "Planning / Exception Flag": "Origin differs from plan; Over the planned quantity",
    });
    // A truck that has left on a BKT reads as transferred out — the status is a label, not an internal id.
    expect(rowOf(ws, (await prisma.transferRequestLine.findFirstOrThrow({ where: { transferId: bkt } })).receiptId).cells["Receipt Status"]).toBe("Transferred out");
    expect(rowOf(ws, unplanned).cells).toMatchObject({
      "Delivery Plan ID": null, "Reception Type": "Unplanned", "Plan Link Status": "Not planned", "Exception Approval Status": "Pending", "Planning / Exception Flag": "Unplanned; Supplier not in master", // WB test supplier is not in the master
    });
  });

  it("asks for the loaded truck weight and the cut-test grams, and the old GRN header still works", async () => {
    const heads = headersOf((await exported()).getWorksheet("Truck Reception")!);
    for (const h of ["Loaded Truck Weight (kg)", "Sample – Good Kernel (g)", "Final – Spotted (g)", "GRN Quantity (kg)"]) expect(heads).toContain(h);
    expect(heads).not.toContain("GRN Weight (kg)");

    const wb = await exported();
    const ws = wb.getWorksheet("Truck Reception")!;
    const { r } = rowOf(ws, unplanned);
    ws.getRow(1).getCell(heads.indexOf("GRN Quantity (kg)") + 1).value = "GRN Weight (kg)"; // an export from before the rename
    setCell(ws, r, "GRN Weight (kg)", "10500");
    const body = (await preview(wb)).json();
    expect(sheet(body, "Truck Reception")).toMatchObject({ changed: 1, errorCount: 0 });
    expect(sheet(body, "Truck Reception").samples[0].changes).toEqual([{ column: "GRN Quantity (kg)", from: "10000", to: "10500" }]);
  });

  it("KOR is calculated from the cut test in the file; typing it as well is refused, and a truck with no grams still takes a typed KOR", async () => {
    const wb = await exported();
    const ws = wb.getWorksheet("Truck Reception")!;
    const { r } = rowOf(ws, unplanned);
    setCell(ws, r, "Sample – Good Kernel (g)", 270);
    setCell(ws, r, "Sample – Immature (g)", 30);
    setCell(ws, r, "Sample – Spotted (g)", 20);
    const ok = (await preview(wb)).json();
    expect(ok.errorCount).toBe(0);
    expect(sheet(ok, "Truck Reception").changed).toBe(1);

    setCell(ws, r, "KOR", "40");
    const refused = (await preview(wb)).json();
    expect(refused.errorCount).toBe(1);
    expect(sheet(refused, "Truck Reception").errors[0]).toMatchObject({ column: "KOR", message: expect.stringMatching(/is calculated/) });

    // No grams: KOR typed alone, as every 2026 truck has it, is fine.
    const bare = await exported();
    const bws = bare.getWorksheet("Truck Reception")!;
    setCell(bws, rowOf(bws, onPlan).r, "KOR", "47.69");
    expect(sheet((await preview(bare)).json(), "Truck Reception")).toMatchObject({ changed: 1, errorCount: 0 });
  });

  it("an edited derived cell (Receipt Status, Reception Type) is ignored, not applied and not an error", async () => {
    const wb = await exported();
    const ws = wb.getWorksheet("Truck Reception")!;
    const { r } = rowOf(ws, unplanned);
    setCell(ws, r, "Receipt Status", "Rejected");
    setCell(ws, r, "Reception Type", "Planned");
    setCell(ws, r, "Delivery Plan ID", planId);
    const body = (await preview(wb)).json();
    expect(sheet(body, "Truck Reception")).toMatchObject({ changed: 0, errorCount: 0 });
  });
});

describe("Delivery Plan and BKT Transfers are sheets for reading", () => {
  it("the Delivery Plan sheet has the client's columns, with received, remaining and variance worked out from the trucks", async () => {
    const ws = (await exported()).getWorksheet("Delivery Plan")!;
    expect(headersOf(ws)).toEqual(expect.arrayContaining([
      "Delivery Plan ID", "Planning Date", "LBA Code", "Supplier Name", "Expected Origin", "Destination Warehouse", "Expected Delivery Start", "Expected Delivery End",
      "Expected Quantity (kg)", "Expected Trucks", "Purchase / Funding Reference", "Plan Status", "Actual Received Quantity (kg)", "Actual Arrivals",
      "Accepted Trucks", "Remaining Quantity (kg)", "Quantity Variance (kg)",
    ]));
    // The plan has two trucks against it (30,000 + 25,000 kg) — the unplanned third isn't on it.
    expect(rowOf(ws, planId).cells).toMatchObject({
      "Destination Warehouse": STORE, "Expected Quantity (kg)": 50000, "Actual Received Quantity (kg)": 55000, "Actual Arrivals": 2, "Accepted Trucks": 2,
      "Remaining Quantity (kg)": -5000, "Quantity Variance (kg)": 5000, "Plan Status": "Delivered", "Purchase / Funding Reference": null,
    });
  });

  it("the BKT Transfers sheet is one row per truck, with what left, what arrived and the difference", async () => {
    const ws = (await exported()).getWorksheet("BKT Transfers")!;
    expect(rowOf(ws, bkt).cells).toMatchObject({
      "From Warehouse": A, "To Warehouse": B, "Truck Registration": "WBCF-RIG-1", "Transfer Status": "Discrepancy",
      "Bags Dispatched": 590, "Bags Received": 574, "Bag Variance": -16, "Net Weight Dispatched (kg)": 48290, "Net Weight at Arrival (kg)": 48246, "Weight Variance (kg)": -44,
    });
  });

  it("uploads the file back unchanged with nothing written and nothing said", async () => {
    const wb = await exported();
    const body = (await preview(wb)).json();
    expect(body.errorCount).toBe(0);
    expect(body.notices).toEqual([]);
    expect(sheet(body, "Delivery Plan")).toMatchObject({ created: 0, changed: 0 });
    expect(sheet(body, "BKT Transfers")).toMatchObject({ created: 0, changed: 0, unchanged: 1 });
  });

  it("an edit to either sheet is reported as not applied, in words — never silently dropped, never written", async () => {
    const wb = await exported();
    const plans = wb.getWorksheet("Delivery Plan")!;
    setCell(plans, rowOf(plans, planId).r, "Expected Quantity (kg)", 99999);
    const bkts = wb.getWorksheet("BKT Transfers")!;
    setCell(bkts, rowOf(bkts, bkt).r, "Bags Received", 590); // "fixing" the variance in the file
    const body = (await preview(wb)).json();
    expect(sheet(body, "Delivery Plan")).toMatchObject({ created: 0, changed: 0 });
    expect(sheet(body, "BKT Transfers")).toMatchObject({ created: 0, changed: 0 });
    expect(body.notices).toEqual([
      expect.stringMatching(/^Delivery Plan: 1 row differs from what the app holds, but this sheet is for reading - nothing was changed\./),
      expect.stringMatching(/^BKT Transfers: 1 row differs/),
    ]);
    expect((await prisma.deliveryPlan.findUniqueOrThrow({ where: { id: planId } })).expectedQuantityKg?.toString()).toBe("50000");
    expect((await prisma.transferRequest.findUniqueOrThrow({ where: { id: bkt } })).bagsReceived).toBe(574);
  });

  it("a row for a plan or BKT the app doesn't have is a difference too, not a new record", async () => {
    const wb = await exported();
    const plans = wb.getWorksheet("Delivery Plan")!;
    const r = plans.rowCount + 1;
    setCell(plans, r, "Delivery Plan ID", "DP-WCA-2035-099");
    setCell(plans, r, "Supplier Name", "Made up in Excel");
    const body = (await preview(wb)).json();
    expect(sheet(body, "Delivery Plan")).toMatchObject({ created: 0 });
    expect(body.notices.join(" ")).toMatch(/Delivery Plan: 1 row differs/);
    expect(await prisma.deliveryPlan.count({ where: { id: "DP-WCA-2035-099" } })).toBe(0);
  });
});
