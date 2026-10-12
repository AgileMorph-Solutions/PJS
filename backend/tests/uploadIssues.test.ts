/**
 * Soft checks on an uploaded workbook: a row that looks wrong (here, moisture over 100%) does NOT stop
 * the upload, is shown in the preview, and is saved against that truck so its page can show it. A hard
 * error still blocks. On a throwaway warehouse so nothing real is touched.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, setStageFields } from "../src/services/receipts.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const A = "UPI-A";
let cookie = "";
let flagged = "";
let untouched = "";

async function cleanup() {
  await prisma.receipt.deleteMany({ where: { warehouse: A } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "upi-" } } });
  await prisma.supplier.deleteMany({ where: { code: "LBA-UPI" } });
  await prisma.warehouse.deleteMany({ where: { name: A } });
}

beforeAll(async () => {
  await cleanup();
  // In the master, and in the past, so the only thing the checks can find is what each test adds.
  await prisma.supplier.create({ data: { code: "LBA-UPI", name: "UPI Supplier" } });
  await prisma.warehouse.create({ data: { name: A, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "UPA" } });
  await prisma.user.create({ data: { username: "upi-a", displayName: "Ama", role: "warehouse_incharge", warehouse: A, passwordHash: hashPassword(PW) } });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "upi-a", password: PW } });
  cookie = String(res.headers["set-cookie"]).split(";")[0]!;
  for (const [veh, set] of [["UPI-T1", (id: string) => (flagged = id)], ["UPI-T2", (id: string) => (untouched = id)]] as const) {
    const r = await createReceipt(A, "2026-06-10");
    await setStageFields(r.id, "n-gate", { "VEHICLE NO.": veh });
    await setStageFields(r.id, "n-verify", { "SUPPLIERS NAME": "UPI Supplier", "LBA CODE": "LBA-UPI" });
    set(r.id);
  }
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

const get = (url: string) => app.inject({ method: "GET", url, headers: { cookie } });
const load = async (buf: Buffer | ArrayBuffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as ArrayBuffer); return wb; };
const headersOf = (ws: ExcelJS.Worksheet) => (ws.getRow(1).values as unknown[]).slice(1).map(String);
const rowNo = (ws: ExcelJS.Worksheet, id: string) => { for (let r = 2; r <= ws.rowCount; r++) if (String(ws.getRow(r).getCell(1).value) === id) return r; throw new Error(`no row ${id}`); };
const setCell = (ws: ExcelJS.Worksheet, row: number, header: string, value: unknown) => { ws.getRow(row).getCell(headersOf(ws).indexOf(header) + 1).value = value as ExcelJS.CellValue; };
function multipart(file: Buffer) {
  const boundary = "----upi" + Math.random().toString(16).slice(2);
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="march.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
    file, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, contentType: `multipart/form-data; boundary=${boundary}` };
}
const preview = async (wb: ExcelJS.Workbook) => {
  const m = multipart(Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer));
  return app.inject({ method: "POST", url: "/api/workbook/preview", payload: m.payload, headers: { cookie, "content-type": m.contentType } });
};
const sheet = (body: any, title: string) => body.sheets.find((s: any) => s.name === title);
/** The exported workbook with one change on the flagged truck. */
async function withEdit(header: string, value: unknown) {
  const wb = await load((await get("/api/workbook")).rawPayload);
  const ws = wb.getWorksheet("Truck Reception")!;
  setCell(ws, rowNo(ws, flagged), header, value);
  return wb;
}

describe("soft checks on an uploaded row", () => {
  it("a value that cannot be true is warned about in the preview, and does not block the upload", async () => {
    const body = (await preview(await withEdit("Moisture (%)", 140))).json();
    const s = sheet(body, "Truck Reception");
    expect(s).toMatchObject({ changed: 1, errorCount: 0 });
    expect(s.warnings).toEqual([expect.objectContaining({ row: expect.any(Number), column: "MOIS. (moisture)", message: expect.stringContaining("over 100%"), severity: "warning" })]);
    expect(body.warningCount).toBe(1);
  });

  it("commits anyway and keeps the issue on that truck only; reviewing it records who, and changes no data", async () => {
    const body = (await preview(await withEdit("Moisture (%)", 140))).json();
    const commit = await app.inject({ method: "POST", url: `/api/workbook/${body.token}/commit`, headers: { cookie } });
    expect(commit.statusCode).toBe(200);

    const issues = (await get(`/api/receipts/${flagged}/upload-issues`)).json();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ filename: "march.xlsx", sheet: "Truck Reception", message: expect.stringContaining("over 100%"), reviewedAt: null, uploadedBy: "Ama" });
    expect((await get(`/api/receipts/${untouched}/upload-issues`)).json()).toEqual([]);

    // The odd value was stored as typed, not "fixed".
    expect((await get(`/api/receipts/${flagged}`)).json().stageData["n-qfs"]["MOIS. (moisture)"]).toBe("140");

    const reviewed = await app.inject({ method: "POST", url: `/api/receipts/${flagged}/upload-issues/${issues[0].id}/review`, headers: { cookie } });
    expect(reviewed.json()).toMatchObject({ reviewedBy: "Ama", reviewedAt: expect.any(String) });
    // An issue id can't be reviewed through another truck's URL.
    const wrong = await app.inject({ method: "POST", url: `/api/receipts/${untouched}/upload-issues/${issues[0].id}/review`, headers: { cookie } });
    expect(wrong.statusCode).toBe(404);
  });

  it("re-uploading an untouched export raises nothing", async () => {
    const body = (await preview(await load((await get("/api/workbook")).rawPayload))).json();
    expect(sheet(body, "Truck Reception")).toMatchObject({ changed: 0, errorCount: 0, warningCount: 0 });
  });

  it("a hard error still blocks, and is reported as an error, not a warning", async () => {
    const body = (await preview(await withEdit("Quality Result", "maybe"))).json();
    expect(sheet(body, "Truck Reception").errorCount).toBeGreaterThan(0);
    expect(body.errorCount).toBeGreaterThan(0);
  });
});
