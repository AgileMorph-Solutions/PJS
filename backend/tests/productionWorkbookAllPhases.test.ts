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
import { INTAKE_TABS, TABS, tabHeader } from "../src/domain/productionWorkbook/tabs.js";
import { startRun } from "../src/services/production/startRun.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const SITE = "PAP-FACTORY";
const RUN = "PAP-ANA-03B";
const LOT = "ANG26Z01";
const GRN = "GRN Weight (kept separate from Gross/Net/Paid)";
// Only Admin and the Production Incharge upload the file (18 Nov 2026), all of it at once, with no approval after: the
// load it finishes is accepted by the upload itself. The Warehouse Incharge records loads on screen and sees only intake.
type Who = "wi" | "pi";
const cookies: Record<Who, string> = { wi: "", pi: "" };
const isIntake = (title: string) => INTAKE_TABS.includes(TABS.find((t) => t.title === title)!.id);
const intakeTitles = TABS.filter((t) => isIntake(t.title)).map((t) => t.title);

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
  await prisma.rcnPallet.deleteMany({ where: atLoad });
  await prisma.rcnEmptyPalletStack.deleteMany({ where: atLoad });
  await prisma.rcnMoistureCheck.deleteMany({ where: atLoad });
  await prisma.rcnReceipt.deleteMany({ where: { batch: { warehouse: SITE } } });
  await prisma.productionBatch.deleteMany({ where: { warehouse: SITE } });
  await prisma.receipt.deleteMany({ where: { warehouse: SITE } });
  await prisma.bin.deleteMany({ where: { code: { startsWith: "PAP-" } } });
  await prisma.productionWorkbookUpload.deleteMany({ where: { warehouse: SITE } });
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
  const wi = await prisma.user.create({ data: { username: "pap-wi", displayName: "wi", role: "warehouse_incharge", warehouse: SITE, passwordHash: hashPassword(PW) } });
  await prisma.user.create({ data: { username: "pap-pi", displayName: "pi", role: "production_incharge", warehouse: SITE, passwordHash: hashPassword(PW) } });
  // The run is started on screen; the file never names one for a load, which finds it by its source bin.
  await startRun(SITE, wi.id, { name: RUN, startDate: "2026-07-19", bins: ["PAP-03B", "PAP-10"], proposedBy: "Warehouse team" });
  for (const who of ["wi", "pi"] as const) {
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `pap-${who}`, password: PW } });
    cookies[who] = String(res.headers["set-cookie"]).split(";")[0]!;
  }
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

// ── The file, as the Upload / Export dialog moves it ──────────────────────────────────────────────────────────────

// Read as the production team, who sees all of production; the warehouse team sees only its intake (18 Nov 2026).
const get = (url: string, who: Who = "pi") => app.inject({ method: "GET", url, headers: { cookie: cookies[who] } });

async function upload(buf: Buffer, who: Who) {
  const boundary = "----pap" + Math.random().toString(16).slice(2);
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="production.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
    buf, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({ method: "POST", url: "/api/production/workbook/preview", payload, headers: { cookie: cookies[who], "content-type": `multipart/form-data; boundary=${boundary}` } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Preview;
}

interface Preview {
  token: string;
  errorCount: number;
  totalCreated: number;
  totalChanged: number;
  notices: string[];
  sheets: { name: string; created: number; changed: number; unchanged: number; errors: { row: number; message: string }[]; warnings?: { message: string }[] }[];
}

const commit = async (token: string, who: Who) => {
  const res = await app.inject({ method: "POST", url: `/api/production/workbook/${token}/commit`, headers: { cookie: cookies[who] } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { totalCreated: number };
};

const load = async (raw: Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(raw as unknown as ArrayBuffer); return wb; };
const headersOf = (ws: ExcelJS.Worksheet) => (ws.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? ""));
const errorsOf = (p: Preview) => p.sheets.flatMap((s) => s.errors.map((e) => `${s.name} row ${e.row}: ${e.message}`));

// ── One row (or more) for every tab, by the header words of the sample itself ────────────────────────────────────
// One load, BTM 901, all the way through: weighed at 2335 + 2445.4 kg gross, less 60 bags (39 kg), 200 kg of pallets and
// 2.5 kg of dust = 4,538.9 kg into the silos when its final weight is saved (no kg per silo: decision, Nov 2026); silo B
// fails its check and 100 kg move to BC; 1,500 kg of A is cooked into Lot ANG26Z01, cooled, shelled into wholes and pieces, and both streams pass
// the sorter. The shell it gives goes out on a truck and into the boiler.
type Row = Record<string, string | number>;
const D = (day: number) => `2026-07-${String(day).padStart(2, "0")}`;

// Under each tab's own words: the client's column names where the tab is one of their files.
const DATA: Record<string, Row[]> = {
  "1. RCN Receipts": [
    { DATE: D(20), "Source BIN": "PAP-03B", "Bin No": "ANA-03B", "BTM No": "901", "Gross Weight (kg's)": 2335, "No of Bags": 30, "Pallet Weight (Kg's)": 120, Dust: 2.5 },
    { DATE: D(20), "Source BIN": "PAP-03B", "Bin No": "ANA-03B", "BTM No": "901", "Gross Weight (kg's)": 2445.4, "No of Bags": 30, "Pallet Weight (Kg's)": 80 },
  ],
  // A second load, arrived and not yet weighed: the one thing the RCN Receipts summary tab is filled in for.
  "2. RCN Receipts summary": [{ Date: D(21), "BTM No": "902", "Source Bin No": "PAP-10" }],
  "3. Input RCN Quality": [{ "BTM NO": "901", Moisture: 9.8, "Nut Count": 180, "Sample Weight (g)": 1000, "GK (g)": 230, "Spot (g)": 12, "Immature (g)": 13, Result: "OK" }],
  "4. Wholes Manual Calibration": [
    { "Batch Name": RUN, Date: D(22), "Sampling Point": "A", "Sample Qty (gm)": 1000, A: 1000, Result: "OK" },
    { "Batch Name": RUN, Date: D(22), "Sampling Point": "B", "Sample Qty (gm)": 1000, B: 900, BC: 100, Result: "Fail" },
  ],
  "6. Cooking Process": [{ "Batch Name": RUN, "Lot No": LOT, Date: D(23), "Size A (24mm)": 1500, "Damaged / Spoiled (kg)": 20 }],
  "7. Cooking Cycles Monitoring": [{
    "Lot No": LOT, DATE: D(23), "Cooker No": "C1", "Size Description": "A", "Start Time": "06:00", "End Time": "07:00", "Set temperature (deg C)": 100,
    "Set Pressure (bar)": 2, "Bin No": "ANA-03B", "Silo Name": "S-A", "Gate No": "2", "Quantity (kg's)": 1500,
  }],
  "11. Shelling Process": [{ "Lot No": LOT, Date: D(24), "Input Quantity (Kg's)": 1500, "Wholes (kg's)": 400, "Pieces (kg's)": 10 }],
  "12. Shelling Line wise Data": [{
    "Lot number": LOT, Date: D(24), Line: "A1", Size: "A", "Input Qty": 1500, "Start Time": "08:00", "End Time": "12:00", "Uncut Qty": 20,
    "Uncut Start Time": "12:10", "Uncut End Time": "12:40", "Breakdown Time (mins)": "00:15",
  }],
  "13. Shelling Machine Frequency": [{ "Lot Number": LOT, Date: D(24), Line: "A1", Material: "A", "Machine No": 3, "Per minutes": 500 }],
  "14. Shelling Machine Quality": [{ "Lot No": LOT, Date: D(24), Shift: "A", Line: "A1", "Machine No": 3, "Sample Qty (g)": 1000, "Wholes (g)": 900, "Pieces (g)": 50, Shell: 50 }],
  "16. Shell Waste Sample": [{ "Lot No": LOT, Date: D(24), "Sampling Point": "Line 1", "Sample Qty (g)": 1000, "Brokens (g)": 5, "Shell (g)": 995 }],
  // Both sides of the colour sorter on the client's one sheet, told apart by the Sampling Point.
  "17. Shelled Kernels Quality": [
    { "Lot No": LOT, Date: D(25), "Sampling Point": "Before CS", Stream: "Wholes", Sizes: "A++ to B", Shift: "A", "Sample Qty (g)": 1000, "Wholes (g)": 950, "Brokens (g)": 30, "Shell (g)": 20 },
    { "Lot No": LOT, Date: D(25), "Sampling Point": "After CS", Stream: "Wholes", Sizes: "A++ to B", Shift: "A", "Sample Qty (g)": 1000, "Wholes (g)": 990, "Shell (g)": 10, Result: "OK" },
    { "Lot No": LOT, Date: D(25), "Sampling Point": "After CS", Stream: "Pieces", Sizes: "A++ to B", Shift: "A", "Sample Qty (g)": 1000, "Brokens (g)": 990, "Shell (g)": 10, Result: "OK" },
  ],
  "18. Boiler Consumption": [{ DATE: D(25), "QTY Consumed (Kg's)": 10, "Running Hours": 8 }],
  // The load's 2.5 kg of dust leaves as "Calibration Dust", as file 15 calls it.
  "19. Waste Management Dispatch": [{ DATE: D(25), "TRUCK NO": "PAP-W1", "TARE WEIGHT": 1000, "GROSS WEIGHT": 1002, Vendor: "Waste Co", Category: "Calibration Dust", "Documents Checked": "Yes", "Gate Pass No": "GP-PAP-W" }],
  "20. Shell Dispatch Tracker": [{ DATE: D(25), "TRUCK NO": "PAP-T1", "Documents Checked": "Yes", "TARE WEIGHT": 1000, "GROSS WEIGHT": 1010, Vendor: "MTL", "Gate Pass No": "GP-PAP" }],
  "5. Silo Moves": [{ Date: D(22), "From Silo": "B", "To Silo": "BC", "Kg Moved": 100 }],
  "8. Cooking Waste Water": [{ "Lot No": LOT, Date: D(23), "Quantity (kg)": 300, Tank: "T1" }],
  "9. Cooling": [{ "Lot No": LOT, "Cooling Silo": "CS-1", "Date In": D(23), "Time In": "12:00" }],
  "10. Cooling Checks": [{ "Lot No": LOT, Date: D(24), "Time of the check": "13:00", "Moisture (%)": 9, "Temperature (°C)": 30, Result: "OK" }],
  "15. Uncut Checks": [{ "Lot No": LOT, Date: D(24), Line: "A1", "Uncut (kg)": 20, "Repassed?": "Yes" }],
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
const rowsOf = (titles: string[]) => titles.reduce((n, t) => n + rowsIn(t), 0);

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

  it("the warehouse team's copy has only its three intake tabs: it doesn't see production past its loads", async () => {
    const res = await get("/api/production/workbook?blank=1", "wi");
    expect(res.statusCode).toBe(200);
    expect((await load(res.rawPayload)).worksheets.map((w) => w.name)).toEqual(intakeTitles);
  });

  it("this test fills in every tab of it, so no phase goes untested", () => {
    expect(Object.keys(DATA).sort()).toEqual(TABS.map((t) => t.title).sort());
  });
});

describe("the filled-in sample, uploaded once by the Production Incharge", () => {
  it("the Warehouse Incharge can't upload it: loads are recorded on screen", async () => {
    const res = await app.inject({ method: "POST", url: "/api/production/workbook/preview", headers: { cookie: cookies.wi } });
    expect(res.statusCode).toBe(403);
  });

  it("previews a new row in every tab and writes nothing", async () => {
    const p = await upload(await filledSample(), "pi");
    expect(errorsOf(p).join("\n")).toBe("");
    expect(p.sheets.map((s) => [s.name, s.created])).toEqual(TABS.map((t) => [t.title, rowsIn(t.title)]));
    expect(await prisma.rcnReceipt.count({ where: { batch: { warehouse: SITE } } })).toBe(0);
  });

  it("applies the whole file, no approval left waiting: the load is weighed, its check approved, and accepted before it is cooked", async () => {
    const p = await upload(await filledSample(), "pi");
    expect((await commit(p.token, "pi")).totalCreated).toBe(rowsOf(TABS.map((t) => t.title)));
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

  it("Intake & Calibration: the load passed moisture, was weighed, accepted by production, and is in the silos", async () => {
    const load = (await api(`/rcn-receipts?batch=${RUN}`)).find((r: { btmNo: string }) => r.btmNo === "901");
    expect(load).toMatchObject({ btmNo: "901", binCode: "PAP-03B", status: "calibrated", acceptance: { acceptedBy: "pi" } });
    expect(load.moistureChecks.map((c: { decision: string; status: string }) => [c.decision, c.status])).toEqual([["ok", "approved"]]);
    expect(load.pallets).toHaveLength(2);
    expect(load.finalWeight).toMatchObject({ dustKg: "2.5" });
  });

  it("Calibration: the silos hold the load's total less what was cooked; a move changes no total; the failed silo was re-sized", async () => {
    const cal = await api(`/batches/${RUN}/calibration`);
    expect(cal.silos).toEqual({ inKg: 4_538.9, cookedKg: 1_500, stockKg: 3_038.9 });
    expect(cal.silos.inKg).toBe(4_538.9);
    expect(cal.siloChecks.A.state).toBe("ok");
    expect(cal.siloChecks.B.state).toBe("re_sized");
  });

  it("Cooking, Shelling and Colour sorting: the Lot went all the way, with every check on record", async () => {
    const data = await api(`/batches/${RUN}/lots`);
    const lot = data.lots.find((l: { code: string }) => l.code === LOT);
    expect(lot).toMatchObject({ status: "colour_sorted", totalKg: 1500, damagedKg: 20, coolingSilo: "CS-1", coolingCheck: "ok" });
    expect(lot.shellingDays).toHaveLength(1);
    const kinds = lot.entries.map((e: { kind: string }) => e.kind).sort();
    expect(kinds).toEqual(["cooker_log", "line_run", "qc4", "qc5_capacity", "qc5_frequency", "qc6", "qc7_after", "qc7_after", "qc7_before", "qty1", "waste_water"]);
    // The Production Incharge's own checks are approved as they are saved, from a file as on screen.
    expect(lot.entries.every((e: { status: string }) => e.status === "approved")).toBe(true);
  });

  it("By-products: the shell truck and the boiler took their shell out of the store", async () => {
    const data = await api(`/batches/${RUN}/lots`);
    expect(data.trucks).toEqual(expect.arrayContaining([
      expect.objectContaining({ truckNo: "PAP-T1", stream: "shell", netKg: 10 }),
      expect.objectContaining({ truckNo: "PAP-W1", stream: "dust_voids", category: "Calibration Dust", netKg: 2 }),
    ]));
    expect(data.boiler).toHaveLength(1);
  });
});

describe("uploading again never duplicates or changes anything", () => {
  it("the same filled-in sample, uploaded a second time, creates nothing twice", async () => {
    // Every tab knows its own rows again: the tally sheet's pallets match the load's, an RCN Receipts row names a load
    // already saved, a check or Lot record identical to a saved one is that record.
    const before = await prisma.rcnReceipt.count({ where: { batch: { warehouse: SITE } } });
    const p = await upload(await filledSample(), "pi");
    expect(errorsOf(p).join("\n")).toBe("");
    expect(p.totalCreated + p.totalChanged).toBe(0);
    expect(p.sheets.find((s) => s.name === "2. RCN Receipts summary")!.unchanged).toBe(1);
    expect(await prisma.rcnReceipt.count({ where: { batch: { warehouse: SITE } } })).toBe(before);
  });

  it("the rows with no link to a load — silo checks and moves, Lots and their records — are recognised as already saved", async () => {
    const { "2. RCN Receipts summary": _l, "3. Input RCN Quality": _m, "1. RCN Receipts": _t, ...rest } = DATA;
    const wb = new ExcelJS.Workbook();
    for (const [title, rows] of Object.entries(rest)) {
      const tab = TABS.find((t) => t.title === title)!;
      const labels = tab.fields.map((f) => f.label);
      const ws = wb.addWorksheet(title);
      ws.addRow(labels);
      for (const row of rows) ws.addRow(labels.map((l) => row[l] ?? null));
    }
    const p = await upload(Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer), "pi");
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
    const p = await upload(res.rawPayload, "pi");
    expect(errorsOf(p).join("\n")).toBe("");
    expect(p.totalCreated + p.totalChanged).toBe(0);
    for (const tab of TABS) expect(p.sheets.find((s) => s.name === tab.title)?.unchanged, tab.title).toBeGreaterThan(0);
  });
});
