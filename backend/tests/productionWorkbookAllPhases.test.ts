/**
 * The production workbook, end to end, the way a person uses it: download the sample, fill a row into every one of its
 * tabs, upload it (preview, then apply), and check that every phase came out right — Intake, Calibration, Cooking,
 * Shelling, Colour sorting, and the by-products. Then the round trips that protect real data: the same file uploaded
 * twice creates nothing twice, and an export uploaded back unchanged changes nothing.
 *
 * Everything goes through HTTP, like the screen's Upload / Export dialog: the downloaded sample is the file that gets
 * filled in, so a header the sample spells differently from what the upload reads fails here. And every tab of the
 * workbook must have a row below — a tab added later without test data fails the coverage check.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, setBranch, setStageFields } from "../src/services/receipts.js";
import { TABS, tabHeader } from "../src/domain/productionWorkbook/tabs.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const SITE = "PAP-FACTORY";
const RUN = "PAP-ANA-03B";
const LOT = "ANG26Z01";
const GRN = "GRN Weight (kept separate from Gross/Net/Paid)";
let cookie = "";

async function cleanup() {
  const atLot = { lot: { batch: { warehouse: SITE } } };
  const atLoad = { rcnReceipt: { batch: { warehouse: SITE } } };
  await prisma.lotEntry.deleteMany({ where: atLot });
  await prisma.shellingDay.deleteMany({ where: atLot });
  await prisma.lotCookRun.deleteMany({ where: atLot });
  await prisma.factoryLot.deleteMany({ where: { batch: { warehouse: SITE } } });
  await prisma.truckMovement.deleteMany({ where: { warehouse: SITE } });
  await prisma.boilerReading.deleteMany({ where: { warehouse: SITE } });
  await prisma.manualCalibration.deleteMany({ where: { sizingCheck: { batch: { warehouse: SITE } } } });
  await prisma.sizingCheck.deleteMany({ where: { batch: { warehouse: SITE } } });
  await prisma.rcnCalibrationRun.deleteMany({ where: atLoad });
  await prisma.rcnPallet.deleteMany({ where: atLoad });
  await prisma.rcnEmptyPalletStack.deleteMany({ where: atLoad });
  await prisma.rcnMoistureCheck.deleteMany({ where: atLoad });
  await prisma.rcnReceipt.deleteMany({ where: { batch: { warehouse: SITE } } });
  await prisma.productionBatch.deleteMany({ where: { warehouse: SITE } });
  await prisma.receipt.deleteMany({ where: { warehouse: SITE } });
  await prisma.bin.deleteMany({ where: { code: { startsWith: "PAP-" } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "pap-" } } });
  await prisma.warehouse.deleteMany({ where: { name: SITE } });
}

/** A truck whose procurement is finished, in `bin`, ready for production. */
async function lotInBin(bin: string, kg: string) {
  const r = await createReceipt(SITE, "2026-06-01");
  await setBranch(r.id, "n-qfs", "pass");
  await setStageFields(r.id, "n-bin", { "Bin Number": bin }, { bypassValidation: true });
  await setStageFields(r.id, "n-grn", { [GRN]: kg, PRICE: "470" }, { bypassValidation: true });
  await setBranch(r.id, "n-drying", "none");
  await setBranch(r.id, "n-xferdec", "production");
}

beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: SITE, kind: "FACTORY", type: "CENTRAL", code: "PAP" } });
  for (const code of ["PAP-03B", "PAP-10"]) await prisma.bin.create({ data: { code } });
  await lotInBin("PAP-03B", "2950400");
  await lotInBin("PAP-10", "878200");
  await prisma.user.create({ data: { username: "pap-wi", displayName: "wi", role: "warehouse_incharge", warehouse: SITE, passwordHash: hashPassword(PW) } });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "pap-wi", password: PW } });
  cookie = String(res.headers["set-cookie"]).split(";")[0]!;
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

// ── The file, as the Upload / Export dialog moves it ──────────────────────────────────────────────────────────────

const get = (url: string) => app.inject({ method: "GET", url, headers: { cookie } });

async function upload(buf: Buffer) {
  const boundary = "----pap" + Math.random().toString(16).slice(2);
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="production.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
    buf, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({ method: "POST", url: "/api/production/workbook/preview", payload, headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Preview;
}

interface Preview {
  token: string;
  errorCount: number;
  totalCreated: number;
  totalChanged: number;
  sheets: { name: string; created: number; changed: number; unchanged: number; errors: { row: number; message: string }[]; warnings?: { message: string }[] }[];
}

const commit = async (token: string) => {
  const res = await app.inject({ method: "POST", url: `/api/production/workbook/${token}/commit`, headers: { cookie } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { totalCreated: number };
};

const load = async (raw: Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(raw as unknown as ArrayBuffer); return wb; };
const headersOf = (ws: ExcelJS.Worksheet) => (ws.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? ""));
const errorsOf = (p: Preview) => p.sheets.flatMap((s) => s.errors.map((e) => `${s.name} row ${e.row}: ${e.message}`));

// ── One row (or more) for every tab, by the header words of the sample itself ────────────────────────────────────
// One load, BTM 901, all the way through: weighed at 2335 + 2445.4 kg gross, less 60 bags (39 kg), 200 kg of pallets and
// 2.5 kg of dust = 4,538.9 kg to sort; sorted into silos A (3,000) and B (1,538.9); silo B fails its check and 100 kg
// move to BC; 1,500 kg of A is cooked into Lot ANG26Z01, cooled, shelled into wholes and pieces, and both streams pass
// the sorter. The shell it gives goes out on a truck and into the boiler.
type Row = Record<string, string | number>;
const D = (day: number) => `2026-07-${String(day).padStart(2, "0")}`;

const DATA: Record<string, Row[]> = {
  Batches: [{ "Batch Name": RUN, "Start Date": D(19), Bins: "PAP-03B / PAP-10", "Proposed By": "Warehouse team" }],
  "RCN Receipts": [{ "Batch Name": RUN, Date: D(20), "BTM No": "901", "Source Bin": "PAP-03B" }],
  "Moisture Checks": [{ "BTM No": "901", "Moisture (%)": 9.8, "Nut Count": 180, "Sample Weight (g)": 1000, "GK (g)": 230, "Spot (g)": 12, "Immature (g)": 13, Result: "OK" }],
  Pallets: [
    { "BTM No": "901", "Gross Weight (kg)": 2335, "No of Bags": 30, "Factory Bin": "ANA-03B" },
    { "BTM No": "901", "Gross Weight (kg)": 2445.4, "No of Bags": 30, "Factory Bin": "ANA-03B" },
  ],
  "Final Weight": [{ "BTM No": "901", "Empty Pallets Weight (kg)": "120 / 80", "No of Pallets": "1 / 1", "Dust (kg)": 2.5 }],
  "Calibration Runs": [{ "BTM No": "901", Date: D(21), "Size A (24mm)": 3000, "Size B (22mm)": 1538.9 }],
  "Silo Checks": [
    { "Batch Name": RUN, Date: D(22), "Sampling Point": "A", "Sample Qty (gm)": 1000, "A (g)": 1000, Result: "OK" },
    { "Batch Name": RUN, Date: D(22), "Sampling Point": "B", "Sample Qty (gm)": 1000, "B (g)": 900, "BC (g)": 100, Result: "Fail" },
  ],
  "Silo Moves": [{ Date: D(22), "From Silo": "B", "To Silo": "BC", "Kg Moved": 100 }],
  Cooking: [{ "Batch Name": RUN, "Lot No": LOT, Date: D(23), "Size A (24mm)": 1500 }],
  "Cooker Log": [{ "Lot No": LOT, Date: D(23), Size: "A", Start: "06:00", Stop: "07:00", "Temperature (°C)": 100, "Pressure (bar)": 2 }],
  "Cooking Checks": [{ "Lot No": LOT, Date: D(23), Size: "A", Result: "OK" }],
  "Waste Water": [{ "Lot No": LOT, Date: D(23), "Quantity (kg)": 300, Tank: "T1" }],
  Cooling: [{ "Lot No": LOT, "Cooling Silo": "CS-1", "Date In": D(23), "Time In": "12:00" }],
  "Cooling Checks": [{ "Lot No": LOT, Date: D(24), "Time of the check": "13:00", "Moisture (%)": 9, "Temperature (°C)": 30, Result: "OK" }],
  "Shelling Days": [{ "Lot No": LOT, Date: D(24), "Input Quantity (Kg's)": 1500, "Wholes (kg's)": 400, "Pieces (kg's)": 10 }],
  "Line Runs": [{ "Lot No": LOT, Date: D(24), Line: "A1", Size: "A", "Input (kg)": 1500, Start: "08:00", End: "12:00", "Uncut (kg)": 20 }],
  "Machine Frequency": [{ "Lot No": LOT, Date: D(24), Line: "A1", "Machine no": 3, "Grams per minute": 500 }],
  "Machine Samples": [{ "Lot No": LOT, Date: D(24), Shift: "A", Line: "A1", "Machine no": 3, "Sample (g)": 1000, "Wholes (g)": 900, "Pieces (g)": 50, "Shell (g)": 50 }],
  "Uncut Checks": [{ "Lot No": LOT, Date: D(24), Line: "A1", "Uncut (kg)": 20, "Repassed?": "Yes" }],
  "Shell Samples": [{ "Lot No": LOT, Date: D(24), "Sampling point": "Line 1", "Sample (g)": 1000, "Brokens (g)": 5, "Shell (g)": 995 }],
  "Sorter Before": [{ "Lot No": LOT, Date: D(25), Stream: "Wholes", "Size group": "A++ to B", Shift: "A", "Sample (g)": 1000, "Wholes (g)": 950, "Brokens (g)": 30, "Shell (g)": 20 }],
  "Sorter After": [
    { "Lot No": LOT, Date: D(25), Stream: "Wholes", "Size group": "A++ to B", Shift: "A", "Sample (g)": 1000, "Wholes (g)": 990, "Shell (g)": 10, Result: "OK" },
    { "Lot No": LOT, Date: D(25), Stream: "Pieces", "Size group": "A++ to B", Shift: "A", "Sample (g)": 1000, "Brokens (g)": 990, "Shell (g)": 10, Result: "OK" },
  ],
  Boiler: [{ DATE: D(25), "QTY Consumed (Kg's)": 10, "Running Hours": 8 }],
  Trucks: [{ Stream: "Shell", DATE: D(25), "TRUCK NO": "PAP-T1", "Documents Checked": "Yes", "TARE WEIGHT": 1000, "GROSS WEIGHT": 1010, Vendor: "MTL", "Gate Pass No": "GP-PAP" }],
};

/** The downloaded sample with DATA typed into it, under the sample's own headers. */
async function filledSample(): Promise<Buffer> {
  const res = await get("/api/production/workbook?blank=1");
  expect(res.statusCode).toBe(200);
  const wb = await load(res.rawPayload);
  for (const [title, rows] of Object.entries(DATA)) {
    const ws = wb.getWorksheet(title);
    if (!ws) throw new Error(`The sample has no "${title}" tab`);
    const headers = headersOf(ws);
    for (const row of rows) {
      const cells = headers.map(() => null as string | number | null);
      for (const [label, value] of Object.entries(row)) {
        const at = headers.findIndex((h) => tabHeader(h) === tabHeader(label));
        if (at < 0) throw new Error(`The sample's "${title}" tab has no "${label}" column (it has: ${headers.join(", ")})`);
        cells[at] = value;
      }
      ws.addRow(cells);
    }
  }
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

const rowsIn = (title: string) => DATA[title]!.length;

// ── The tests ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe("the sample download", () => {
  it("has every tab of the workbook, with exactly the columns the upload reads, and no rows", async () => {
    const res = await get("/api/production/workbook?blank=1");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/ANAGROCI - Production - Sample\.xlsx/);
    const wb = await load(res.rawPayload);
    expect(wb.worksheets.map((w) => w.name)).toEqual(TABS.map((t) => t.title));
    for (const tab of TABS) {
      const ws = wb.getWorksheet(tab.title)!;
      expect(headersOf(ws), tab.title).toEqual(tab.fields.map((f) => f.label));
      expect(ws.actualRowCount, tab.title).toBe(1);
    }
  });

  it("this test fills in every tab of it, so no phase goes untested", () => {
    expect(Object.keys(DATA).sort()).toEqual(TABS.map((t) => t.title).sort());
  });
});

describe("the filled-in sample, uploaded", () => {
  it("previews a new row in every tab, with no error, and writes nothing", async () => {
    const p = await upload(await filledSample());
    expect(errorsOf(p).join("\n")).toBe("");
    expect(p.sheets.map((s) => [s.name, s.created])).toEqual(TABS.map((t) => [t.title, rowsIn(t.title)]));
    expect(await prisma.productionBatch.count({ where: { warehouse: SITE } })).toBe(0);
    expect(await prisma.factoryLot.count({ where: { code: LOT } })).toBe(0);
  });

  it("applies every row", async () => {
    const p = await upload(await filledSample());
    const done = await commit(p.token);
    expect(done.totalCreated).toBe(Object.values(DATA).reduce((n, rows) => n + rows.length, 0));
  });
});

describe("every phase came out as the rows say", () => {
  const api = async (url: string) => {
    const res = await get(`/api/production${url}`);
    expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
    return res.json();
  };

  it("the production run has its system ID, and keeps the name the file gave it", async () => {
    const runs = await api("/batches");
    expect(runs).toEqual([expect.objectContaining({ code: "PR-PAP-2026-001", name: RUN, binCodes: ["PAP-03B", "PAP-10"], status: "in_process" })]);
  });

  it("Intake: the load passed moisture, was weighed, and is fully calibrated", async () => {
    const [load] = await api(`/rcn-receipts?batch=${RUN}`);
    expect(load).toMatchObject({ btmNo: "901", binCode: "PAP-03B", status: "calibrated" });
    expect(load.moistureChecks.map((c: { decision: string; status: string }) => [c.decision, c.status])).toEqual([["ok", "approved"]]);
    expect(load.pallets).toHaveLength(2);
    expect(load.finalWeight).toMatchObject({ dustKg: "2.5" });
    expect(load.calibration).toMatchObject({ toSilosKg: 4_538.9, sizedKg: 4_538.9, leftKg: 0 });
  });

  it("Calibration: the silos hold what was sorted, moved and cooked; the failed silo was re-sized", async () => {
    const cal = await api(`/batches/${RUN}/calibration`);
    const stock = Object.fromEntries(cal.silos.map((s: { size: string; stockKg: number }) => [s.size, s.stockKg]));
    expect(stock).toMatchObject({ A: 1_500, B: 1_438.9, BC: 100 });
    expect(cal.siloChecks.A.state).toBe("ok");
    expect(cal.siloChecks.B.state).toBe("re_sized");
  });

  it("Cooking, Shelling and Colour sorting: the Lot went all the way, with every check on record", async () => {
    const data = await api(`/batches/${RUN}/lots`);
    const lot = data.lots.find((l: { code: string }) => l.code === LOT);
    expect(lot).toMatchObject({ status: "colour_sorted", totalKg: 1500, coolingSilo: "CS-1", coolingCheck: "ok" });
    expect(lot.shellingDays).toHaveLength(1);
    const kinds = lot.entries.map((e: { kind: string }) => e.kind).sort();
    expect(kinds).toEqual(["cooker_log", "line_run", "qc3", "qc4", "qc5_capacity", "qc5_frequency", "qc6", "qc7_after", "qc7_after", "qc7_before", "qty1", "waste_water"]);
    // The Incharge's own checks are approved as they are saved, from a file as on screen.
    expect(lot.entries.every((e: { status: string }) => e.status === "approved")).toBe(true);
  });

  it("By-products: the shell truck and the boiler took their shell out of the store", async () => {
    const data = await api(`/batches/${RUN}/lots`);
    expect(data.trucks).toEqual([expect.objectContaining({ truckNo: "PAP-T1", netKg: 10 })]);
    expect(data.boiler).toHaveLength(1);
  });
});

describe("uploading again never duplicates or changes anything", () => {
  it("the same filled-in sample, uploaded a second time, is refused as a whole and writes nothing", async () => {
    // A load row with no RCN Receipt ID means "a new load", and a repeat BTM from the same bin is only a warning (the
    // client's own sheets have real second loads). So the second upload offers a second load of BTM 901 — and every
    // later row then can't tell which of the two loads it is for. Errors block the whole file: nothing doubles up.
    // Updating what is saved goes through the export, whose rows carry their IDs (the next tests).
    const before = await prisma.rcnReceipt.count({ where: { batch: { warehouse: SITE } } });
    const p = await upload(await filledSample());
    expect(p.sheets.find((s) => s.name === "RCN Receipts")!.warnings?.[0]?.message).toMatch(/BTM 901 from PAP-03B is already on RR-PAP-2026-0001/);
    expect(errorsOf(p).length).toBeGreaterThan(0);
    expect(errorsOf(p).every((e) => /BTM 901 is on 2 loads .* Give the RCN Receipt ID/.test(e))).toBe(true);
    const res = await app.inject({ method: "POST", url: `/api/production/workbook/${p.token}/commit`, headers: { cookie } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/nothing was written/);
    expect(await prisma.rcnReceipt.count({ where: { batch: { warehouse: SITE } } })).toBe(before);
  });

  it("the rows with no link to a load — runs, silo checks and moves, Lots and their records — are recognised as already saved", async () => {
    const { "RCN Receipts": _l, "Moisture Checks": _m, Pallets: _p, "Final Weight": _f, "Calibration Runs": _r, ...rest } = DATA;
    const wb = new ExcelJS.Workbook();
    for (const [title, rows] of Object.entries(rest)) {
      const tab = TABS.find((t) => t.title === title)!;
      const labels = tab.fields.map((f) => f.label);
      const ws = wb.addWorksheet(title);
      ws.addRow(labels);
      for (const row of rows) ws.addRow(labels.map((l) => row[l] ?? null));
    }
    const p = await upload(Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer));
    expect(errorsOf(p).join("\n")).toBe("");
    expect(p.totalCreated + p.totalChanged).toBe(0);
  });

  it("the export has a row in every tab, under the same columns as the sample", async () => {
    const res = await get("/api/production/workbook");
    expect(res.statusCode).toBe(200);
    const wb = await load(res.rawPayload);
    for (const tab of TABS) {
      const ws = wb.getWorksheet(tab.title)!;
      expect(headersOf(ws), tab.title).toEqual(tab.fields.map((f) => f.label));
      expect(ws.actualRowCount - 1, `${tab.title} rows`).toBeGreaterThanOrEqual(rowsIn(tab.title));
    }
  });

  it("the export, uploaded back as it is, changes nothing in any tab", async () => {
    const res = await get("/api/production/workbook");
    const p = await upload(res.rawPayload);
    expect(errorsOf(p).join("\n")).toBe("");
    expect(p.totalCreated + p.totalChanged).toBe(0);
    for (const tab of TABS) expect(p.sheets.find((s) => s.name === tab.title)?.unchanged, tab.title).toBeGreaterThan(0);
  });
});
