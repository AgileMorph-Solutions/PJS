/**
 * Production Phases 3–4 through the API: cooking takes kg out of the silos, QC-3 and QC-4 gate each move, shelling
 * fills the shell silo, and trucks and the boiler empty it. What matters most here is what must be refused, and that
 * removing something can't leave a store or a silo below zero.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, setBranch, setStageFields } from "../src/services/receipts.js";
import { commitProductionWorkbook, downloadProductionWorkbook, previewProductionWorkbook } from "../src/services/productionWorkbook.js";
import { batchCalibration } from "../src/services/production/calibration.js";
import { listLots } from "../src/services/production/factoryLots.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const SITE = "FLT-FACTORY";
const BATCH = "FLT-ANA-01";
const GRN = "GRN Weight (kept separate from Gross/Net/Paid)";
const cookies: Record<string, string> = {};
let wiId = "";

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
  await prisma.bin.deleteMany({ where: { code: { startsWith: "FLT-" } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "flt-" } } });
  await prisma.warehouse.deleteMany({ where: { name: SITE } });
}

async function login(key: string, role: string) {
  const u = await prisma.user.create({ data: { username: `flt-${key}`, displayName: key, role, warehouse: SITE, passwordHash: hashPassword(PW) } });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `flt-${key}`, password: PW } });
  cookies[key] = String(res.headers["set-cookie"]).split(";")[0]!;
  return u.id;
}

const call = (who: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/production${url}`, payload: payload as object | undefined, headers: { cookie: cookies[who]!, ...(payload ? { "content-type": "application/json" } : {}) } });

const lots = async () => (await call("wi", "GET", `/batches/${BATCH}/lots`)).json();
const lot = async (code: string) => (await lots()).lots.find((l: { code: string }) => l.code === code);
const silo = async (size: string) => (await batchCalibration(SITE, BATCH))!.silos.find((s) => s.size === size)!.stockKg;
const store = async (stream: string) => (await lots()).stores.find((s: { stream: string }) => s.stream === stream).stockKg;
const entry = (who: string, code: string, body: object) => call(who, "POST", `/factory-lots/${code}/entries`, body);

const qc3Ok = { kind: "qc3", date: "2026-07-20", decision: "ok" };
const qc4Ok = { kind: "qc4", date: "2026-07-21", values: { time: "10:00", moisture: "9", tempC: "30" }, decision: "ok" };
const dayRow = { date: "2026-07-21", inputKg: "20000", wholesKg: "5000", piecesKg: "200", rejectionKg: "400", oilKg: "60", blackRejectionKg: "120", firstPassUncutKg: "1800", finalUncutKg: "150" };
// Final kernels 5,780; dust 300; shell 13,920.

/** A Lot of 20,000 kg through cooking, cooling and QC-4, as the Incharge. */
async function readyLot(code: string) {
  expect((await call("wi", "POST", "/factory-lots", { batchCode: BATCH, code, date: "2026-07-20", sizes: { A: "20000" } })).statusCode).toBe(201);
  expect((await entry("wi", code, { ...qc3Ok, values: { size: "A" } })).statusCode).toBe(201);
  expect((await call("wi", "POST", `/factory-lots/${code}/cooling`, { silo: "CS-1", date: "2026-07-20", time: "09:00" })).statusCode).toBe(200);
  expect((await entry("wi", code, qc4Ok)).statusCode).toBe(201);
}

beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: SITE, kind: "FACTORY", type: "CENTRAL", code: "FLT" } });
  await prisma.bin.create({ data: { code: "FLT-03B" } });
  const r = await createReceipt(SITE, "2026-06-01");
  await setBranch(r.id, "n-qfs", "pass");
  await setStageFields(r.id, "n-bin", { "Bin Number": "FLT-03B" }, { bypassValidation: true });
  await setStageFields(r.id, "n-grn", { [GRN]: "2950400", PRICE: "470" }, { bypassValidation: true });
  await setBranch(r.id, "n-drying", "none");
  await setBranch(r.id, "n-xferdec", "production");
  wiId = await login("wi", "warehouse_incharge");
  await login("qfs", "qfs_officer");
  expect((await call("wi", "POST", "/batches", { code: BATCH, startDate: "2026-07-19", bins: ["FLT-03B"] })).statusCode).toBe(201);
  // 200,000 kg weighed: 100,000 in A, 50,000 in B, 49,980.5 in C (19.5 kg of bags); 2,000 kg of pallets, 0 dust.
  const load = (await call("wi", "POST", "/rcn-receipts", { batchCode: BATCH, date: "2026-07-19", btmNo: "113", binCode: "FLT-03B" })).json().id;
  await call("wi", "POST", `/rcn-receipts/${load}/moisture-checks`, { moisture: "8", nutCount: "180", decision: "ok" });
  await call("wi", "POST", `/rcn-receipts/${load}/pallets`, { grossKg: "202000", bags: "30", factoryBin: "ANA-01" });
  await call("wi", "POST", `/rcn-receipts/${load}/final-weight`, { emptyPallets: [{ weightKg: "2000" }], dustKg: "1250", voidsKg: "8" });
  const sized = await call("wi", "POST", `/rcn-receipts/${load}/calibration-runs`, { date: "2026-07-19", sizes: { A: "100000", B: "50000", C: "48722.5" } });
  expect(sized.json().status).toBe("calibrated");
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

describe("Cooking (Phase 3)", () => {
  it("a Lot is born here: kg leave the silos, total and bags are worked out, and it starts as Cooking", async () => {
    const res = await call("wi", "POST", "/factory-lots", { batchCode: BATCH, code: "ang26g16", date: "2026-07-20", sizes: { A: "30000", B: "10000" } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ code: "ANG26G16", status: "cooking", totalKg: 40_000, bags: 500, cookedSizes: ["A", "B"], cookChecks: { A: "not_checked", B: "not_checked" } });
    expect([await silo("A"), await silo("B")]).toEqual([70_000, 40_000]);
    const cal = (await batchCalibration(SITE, BATCH))!;
    expect(cal.silos.find((s) => s.size === "A")!.cookedKg).toBe(30_000);
    expect(cal.daily.at(-1)).toMatchObject({ date: "2026-07-20", cookedKg: 40_000 });
    expect((await call("wi", "GET", `/batches/${BATCH}`)).json().history[0].text).toBe("Lot ANG26G16 cooked: 40,000 kg");
  });

  it("can't cook more than a silo holds, nor for a batch elsewhere; only the Incharge cooks", async () => {
    const over = await call("wi", "POST", "/factory-lots", { batchCode: BATCH, code: "ANG26G17", date: "2026-07-20", sizes: { A: "70001" } });
    expect(over.statusCode).toBe(422);
    expect(over.json().error).toMatch(/holds 70,000 kg; 70,001 kg can't be cooked/);
    expect((await call("wi", "POST", "/factory-lots", { batchCode: "NOPE", code: "X1", date: "2026-07-20", sizes: { A: "1" } })).json().error).toMatch(/Production run NOPE doesn't exist/);
    expect((await call("qfs", "POST", "/factory-lots", { batchCode: BATCH, code: "X1", date: "2026-07-20", sizes: { A: "1" } })).statusCode).toBe(403);
  });

  it("a second row adds to the same Lot (ANG26F01 has two in the sheet), and removing it returns the kg", async () => {
    const res = await call("wi", "POST", "/factory-lots", { batchCode: BATCH, code: "ANG26G16", date: "2026-07-20", sizes: { A: "1000" } });
    expect(res.json()).toMatchObject({ totalKg: 41_000, sizes: { A: 31_000 } });
    expect(await silo("A")).toBe(69_000);
    expect((await call("wi", "DELETE", `/lot-cook-runs/${res.json().runs[1].id}`)).statusCode).toBe(204);
    expect(await silo("A")).toBe(70_000);
    expect((await lot("ANG26G16")).totalKg).toBe(40_000);
  });

  it("removing what calibrated nuts that have since been cooked is refused: a silo can't go below zero", async () => {
    const load = (await call("wi", "GET", `/rcn-receipts?batch=${BATCH}`)).json()[0];
    const res = await call("wi", "DELETE", `/calibration-runs/${load.calibration.runs[0].id}`);
    expect(res.json().error).toMatch(/would leave silo A \(24 mm\) at -30,000 kg: nuts were moved or cooked out of it since/);
  });

  it("QC-3: the floor's log is refused to a QFS Officer; a check waits for the Incharge; a size not cooked is refused", async () => {
    const log = { kind: "cooker_log", date: "2026-07-20", values: { size: "A", start: "06:00", stop: "07:00", tempC: "100", pressureBar: "2" } };
    expect((await entry("qfs", "ANG26G16", log)).statusCode).toBe(403);
    expect((await entry("wi", "ANG26G16", log)).statusCode).toBe(201);
    expect((await entry("wi", "ANG26G16", { ...qc3Ok, values: { size: "C" } })).json().error).toMatch(/cooked no size C/);
    const sent = await entry("qfs", "ANG26G16", { ...qc3Ok, decision: "no", values: { size: "A", remarks: "pressure low" } });
    expect(sent.statusCode).toBe(201);
    expect(sent.json().cookChecks.A).toBe("waiting");
    const e = sent.json().entries.at(-1);
    expect(e).toMatchObject({ status: "submitted", submittedBy: "qfs", decision: "no" });
    expect((await call("qfs", "POST", `/lot-entries/${e.id}/approve`)).statusCode).toBe(403);
    expect((await call("wi", "POST", `/lot-entries/${e.id}/approve`)).json().cookChecks.A).toBe("recook");
  });

  it("a Lot can't go to cooling while a size is held, or unchecked; then it can, once", async () => {
    const cooling = { silo: "CS-1", date: "2026-07-20", time: "09:00" };
    expect((await call("wi", "POST", "/factory-lots/ANG26G16/cooling", cooling)).json().error).toMatch(/A \(24 mm\), B \(22 mm\) of ANG26G16 has not passed/);
    await entry("wi", "ANG26G16", { ...qc3Ok, values: { size: "A" } });
    await entry("wi", "ANG26G16", { ...qc3Ok, values: { size: "B" } });
    expect((await call("wi", "POST", "/factory-lots/ANG26G16/cooling", { ...cooling, time: "9am" })).json().error).toMatch(/HH:MM/);
    expect((await call("wi", "POST", "/factory-lots/ANG26G16/cooling", cooling)).json()).toMatchObject({ status: "cooling", coolingSilo: "CS-1", coolingAt: "2026-07-20T09:00" });
    // Cooking is over: nothing more cooks into it, and its rows stand.
    expect((await call("wi", "POST", "/factory-lots", { batchCode: BATCH, code: "ANG26G16", date: "2026-07-20", sizes: { A: "1" } })).json().error).toMatch(/gone to its cooling silo/);
    expect((await call("wi", "DELETE", `/lot-cook-runs/${(await lot("ANG26G16")).runs[0].id}`)).json().error).toMatch(/can't be changed/);
  });

  it("QC-4: shelling stays shut on Wait, a re-check opens it, and under 24 hours is a note", async () => {
    const shelling = () => call("wi", "POST", "/factory-lots/ANG26G16/shelling-days", dayRow);
    expect((await shelling()).json().error).toMatch(/has not passed its moisture and temperature check/);
    const wait = await entry("qfs", "ANG26G16", { kind: "qc4", date: "2026-07-20", values: { time: "20:00", moisture: "12", tempC: "45" }, decision: "wait" });
    const e = wait.json().entries.at(-1);
    expect(e.notes[0]).toMatch(/Only 11.0 hours in the cooling silo/);
    expect(wait.json().coolingCheck).toBe("waiting");
    expect((await call("wi", "POST", `/lot-entries/${e.id}/reject`, { reason: " " })).json().error).toMatch(/Give a reason/);
    expect((await call("wi", "POST", `/lot-entries/${e.id}/approve`)).json()).toMatchObject({ status: "cooling", coolingCheck: "wait" });
    expect((await shelling()).statusCode).toBe(422);
    expect((await entry("qfs", "ANG26G16", { kind: "line_run", date: "2026-07-21", values: {} })).statusCode).toBe(403);
    expect((await entry("wi", "ANG26G16", { kind: "qty1", date: "2026-07-21", values: { line: "A1", kg: "1", repassed: "Yes" } })).json().error).toMatch(/shelling can't start/);
    expect((await entry("wi", "ANG26G16", qc4Ok)).json()).toMatchObject({ status: "ready", coolingCheck: "ok", leftToShellKg: 40_000 });
    expect((await call("wi", "POST", "/factory-lots/ANG26G16/cooling", { silo: "CS-2", date: "2026-07-20", time: "09:00" })).json().error).toMatch(/its cooling silo can't change now/);
  });

  it("cooking waste water goes to its store, and its record can be removed unless it has left", async () => {
    const saved = await entry("wi", "ANG26G16", { kind: "waste_water", date: "2026-07-20", values: { kg: "6000", tank: "T1" } });
    expect(await store("waste_water")).toBe(6000);
    const closed = await call("wi", "POST", "/trucks", { stream: "waste_water", date: "2026-07-21", truckNo: "4316CV04", documentsChecked: true, tareKg: "6350", grossKg: "12050", buyer: "BECO", gatePassNo: "WW-1" });
    expect(closed.statusCode).toBe(201);
    expect(await store("waste_water")).toBe(300);
    const res = await call("wi", "DELETE", `/lot-entries/${saved.json().entries.at(-1).id}`);
    expect(res.json().error).toMatch(/cooking waste water store at -5,700 kg/);
    expect(await store("waste_water")).toBe(300);
  });
});

describe("Shelling (Phase 4)", () => {
  it("the day record works out kernels, dust and shell; the Lot is Shelled, and the stores fill", async () => {
    const res = await call("wi", "POST", "/factory-lots/ANG26G16/shelling-days", dayRow);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: "shelled", shelledKg: 20_000, leftToShellKg: 20_000 });
    expect(res.json().shellingDays[0].figures).toMatchObject({ goodKg: 5200, finalKg: 5780, shellDustKg: 300, shellKg: 13_920 });
    expect(await store("shell")).toBe(13_920);
    expect(await store("shell_dust")).toBe(300);
    const history = (await call("wi", "GET", `/batches/${BATCH}`)).json().history;
    expect(history[0].text).toBe("Lot ANG26G16 shelled: 20,000 kg in, 5,780 kg kernels (26.00 % good), 13,920 kg shell");
  });

  it("refuses outputs above the input; a QFS Officer can't enter it", async () => {
    expect((await call("wi", "POST", "/factory-lots/ANG26G16/shelling-days", { ...dayRow, wholesKg: "99999" })).json().error).toMatch(/more than the input/);
    expect((await call("qfs", "POST", "/factory-lots/ANG26G16/shelling-days", dayRow)).statusCode).toBe(403);
  });

  it("shelling more than was cooked is a note, as the client's ANG26F10 does it", async () => {
    await readyLot("ANG26G18");
    const res = await call("wi", "POST", "/factory-lots/ANG26G18/shelling-days", { ...dayRow, inputKg: "21000" });
    expect(res.statusCode).toBe(201);
    expect(res.json().shellingDays[0].notes[0]).toMatch(/Only 20,000 kg of this Lot is left to shell/);
    expect(res.json().leftToShellKg).toBe(-1000);
  });

  it("the checks on the line: figures, alerts, and one button to approve a shift's samples", async () => {
    const sample = { kind: "qc5_capacity", date: "2026-07-21", values: { shift: "A", line: "A1", machine: "1", sampleG: "1000", wholesG: "189", piecesG: "1", knifeMarkG: "20", uncutG: "130", unscoopWholesG: "129", unscoopPiecesG: "13", shellG: "538" } };
    expect((await entry("qfs", "ANG26G16", sample)).statusCode).toBe(201);
    const second = await entry("qfs", "ANG26G16", { ...sample, values: { ...sample.values, machine: "2" } });
    const made = second.json().entries.filter((e: { kind: string }) => e.kind === "qc5_capacity");
    expect(made.map((e: { status: string }) => e.status)).toEqual(["submitted", "submitted"]);
    expect(made[0].notes).toEqual([expect.stringMatching(/Wholes 90.0 % is below the 95 % target/)]);
    expect((await call("qfs", "POST", "/factory-lots/ANG26G16/entries/approve-all", { kind: "qc5_capacity" })).statusCode).toBe(403);
    const all = await call("wi", "POST", "/factory-lots/ANG26G16/entries/approve-all", { kind: "qc5_capacity" });
    expect(all.json().entries.filter((e: { kind: string; status: string }) => e.kind === "qc5_capacity" && e.status === "approved")).toHaveLength(2);
    expect((await entry("qfs", "ANG26G16", { kind: "qc6", date: "2026-07-21", values: { point: "Line 2", sampleG: "1000", brokensG: "7.8", shellG: "992.2" } })).json().entries.at(-1).notes).toEqual([expect.stringMatching(/0.78 % kernel left in the shell/)]);
    expect((await entry("wi", "ANG26G16", { kind: "line_run", date: "2026-07-21", values: { line: "A++", size: "App", inputKg: "8010", start: "06:25", end: "12:00", uncutKg: "700" } })).statusCode).toBe(201);
    // A check stays on record; only the floor's own lines come off.
    const q = (await lot("ANG26G16")).entries.find((e: { kind: string }) => e.kind === "qc6");
    expect((await call("wi", "DELETE", `/lot-entries/${q.id}`)).json().error).toMatch(/stays on record/);
  });

  it("a QFS Officer reads the Lots, and sees the same stores", async () => {
    const res = await call("qfs", "GET", `/batches/${BATCH}/lots`);
    expect(res.statusCode).toBe(200);
    expect(res.json().lots.map((l: { code: string }) => l.code).slice(0, 2)).toEqual(["ANG26G16", "ANG26G18"]);
    expect((await call("qfs", "POST", "/trucks", { stream: "shell", date: "2026-07-21", truckNo: "X" })).statusCode).toBe(403);
  });
});

describe("Colour sort (Phase 5)", () => {
  // ANG26G16's day record: wholes 5,000, pieces 200, rejection + oil 460, black rejection 120.
  const sample = (stream: string, decision?: string) => ({ kind: decision ? "qc7_after" : "qc7_before", date: "2026-07-22", values: { stream, sizes: "BC to E", sampleG: "1000", wholesG: "916", brokensG: "20", buttsG: "10", knifeMarkG: "36", rejectionG: "12", oilDirtG: "6" }, ...(decision ? { decision } : {}) });

  it("only a shelled Lot can be sampled at the sorter", async () => {
    await readyLot("ANG26G19");
    expect((await entry("qfs", "ANG26G19", sample("Wholes"))).json().error).toMatch(/no shelling day record yet/);
  });

  it("a stream that failed is held until a newer check passes it; the Lot is Colour sorted once every stream has", async () => {
    expect((await entry("qfs", "ANG26G16", sample("Wholes"))).statusCode).toBe(201);
    const no = await entry("qfs", "ANG26G16", sample("Wholes", "no"));
    expect(no.json().sortChecks.Wholes).toBe("waiting");
    const e = no.json().entries.at(-1);
    expect((await call("wi", "POST", `/lot-entries/${e.id}/approve`)).json()).toMatchObject({ status: "shelled", sortChecks: { Wholes: "resort", Pieces: "not_checked" } });
    await entry("wi", "ANG26G16", sample("Wholes", "ok"));
    await entry("wi", "ANG26G16", sample("Pieces", "ok"));
    expect((await lot("ANG26G16")).status).toBe("shelled");
    const sorted = await entry("wi", "ANG26G16", sample("Rejection + oil", "ok"));
    expect(sorted.json()).toMatchObject({ status: "colour_sorted", sorterStreams: ["Wholes", "Pieces", "Rejection + oil"], sorterKg: { Wholes: 5000, Pieces: 200, "Rejection + oil": 460 } });
    const history = (await call("wi", "GET", `/batches/${BATCH}`)).json().history.map((h: { text: string }) => h.text);
    expect(history).toContain("Lot ANG26G16 QC-7, Wholes: No · sort again: submitted for approval");
  });

  it("a stream shelling gave none of can't be checked after the sorter", async () => {
    const lotWithout = await call("wi", "POST", "/factory-lots/ANG26G19/shelling-days", { date: "2026-07-22", inputKg: "1000", wholesKg: "200" });
    expect(lotWithout.json().sorterStreams).toEqual(["Wholes"]);
    expect((await entry("wi", "ANG26G19", sample("Pieces", "ok"))).json().error).toMatch(/Shelling gave ANG26G19 no Pieces to sort/);
  });

  it("black rejection is its own store, from the day records, sold by truck within it", async () => {
    // ANG26G16 120 + ANG26G18 120 + ANG26G19 0.
    expect(await store("black_rejection")).toBe(240);
    const over = await call("wi", "POST", "/trucks", { stream: "black_rejection", date: "2026-07-23", truckNo: "BR-1", documentsChecked: true, tareKg: "1000", grossKg: "1241", buyer: "Buyer", gatePassNo: "BR-GP-1" });
    expect(over.json().error).toMatch(/black rejection store holds 240 kg; a truck of 241 kg/);
    expect((await call("wi", "POST", "/trucks", { stream: "black_rejection", date: "2026-07-23", truckNo: "BR-1", documentsChecked: true, tareKg: "1000", grossKg: "1200", buyer: "Buyer", gatePassNo: "BR-GP-1" })).statusCode).toBe(201);
    expect(await store("black_rejection")).toBe(40);
  });
});

describe("Trucks and the boiler", () => {
  let id = 0;
  const shellTruck = { stream: "shell", date: "2026-07-22", truckNo: "2040KB01", driver: "Yao" };

  it("the gate procedure, saved as the truck moves; only leaving takes kg out of the store", async () => {
    const before = await store("shell");
    expect((await call("wi", "POST", "/trucks", { ...shellTruck, tareKg: "20850" })).json().error).toMatch(/documents before weighing/);
    const at = await call("wi", "POST", "/trucks", shellTruck);
    id = at.json().id;
    expect(at.json().status).toBe("at_gate");
    const up = (v: object) => call("wi", "PUT", `/trucks/${id}`, { ...shellTruck, documentsChecked: true, ...v });
    expect((await up({})).json().status).toBe("documents_checked");
    expect((await up({ tareKg: "20850" })).json().status).toBe("tare_weighed");
    expect((await up({ tareKg: "20850", grossKg: "40000" })).json()).toMatchObject({ status: "weighed", netKg: 19_150 });
    expect(await store("shell")).toBe(before);
    expect((await up({ tareKg: "20850", grossKg: "60000", buyer: "Revata", gatePassNo: "GP-1" })).json().error).toMatch(/shell store holds .*; a truck of 39,150 kg/);
    const closed = await up({ tareKg: "20850", grossKg: "30000", slipNo: "600", buyer: "Revata", gatePassNo: "GP-1" });
    expect(closed.json()).toMatchObject({ status: "closed", netKg: 9150 });
    expect(await store("shell")).toBeCloseTo(before - 9150, 3);
  });

  it("a closed truck can't change or be removed; a gate pass is unique; a truck still at the gate can go", async () => {
    expect((await call("wi", "PUT", `/trucks/${id}`, { ...shellTruck, documentsChecked: true, tareKg: "1", grossKg: "2", buyer: "x", gatePassNo: "GP-1" })).json().error).toMatch(/has left on gate pass GP-1/);
    expect((await call("wi", "DELETE", `/trucks/${id}`)).json().error).toMatch(/stays on record/);
    const twin = await call("wi", "POST", "/trucks", { ...shellTruck, documentsChecked: true, tareKg: "1000", grossKg: "1100", buyer: "Revata", gatePassNo: "GP-1" });
    expect(twin.json().error).toMatch(/Gate pass GP-1 is already used/);
    const open = await call("wi", "POST", "/trucks", shellTruck);
    expect((await call("wi", "DELETE", `/trucks/${open.json().id}`)).statusCode).toBe(204);
  });

  it("the boiler burns from the shell silo, never more than it holds", async () => {
    const before = await store("shell");
    expect((await call("wi", "POST", "/boiler", { date: "2026-07-22", shellKg: String(before + 1) })).json().error).toMatch(/can't be burned/);
    const res = await call("wi", "POST", "/boiler", { date: "2026-07-22", shellKg: "7000", runningHours: "8" });
    expect(res.statusCode).toBe(201);
    expect(await store("shell")).toBeCloseTo(before - 7000, 3);
    const shell = (await lots()).stores.find((s: { stream: string }) => s.stream === "shell");
    expect(shell).toMatchObject({ burnedKg: 7000, dispatchedKg: 9150 });
    expect((await call("qfs", "POST", "/boiler", { date: "2026-07-22", shellKg: "1" })).statusCode).toBe(403);
  });

  it("dust and voids from Intake are in their store, ready for a truck", async () => {
    expect(await store("dust_voids")).toBe(1258);
    expect((await call("wi", "POST", "/trucks", { stream: "dust_voids", date: "2026-07-22", truckNo: "T1", documentsChecked: true, tareKg: "1000", grossKg: "2259", buyer: "GI2E", gatePassNo: "D-1" })).json().error).toMatch(/holds 1,258 kg; a truck of 1,259 kg/);
  });

  it("a shelling day can't be removed once its shell has left, and can be while there is room", async () => {
    const days = (await lot("ANG26G16")).shellingDays;
    // A truck takes nearly all that is left, so the shell of this day has gone and its record must stay.
    const closeAll = await call("wi", "POST", "/trucks", { stream: "shell", date: "2026-07-23", truckNo: "T9", documentsChecked: true, tareKg: "1000", grossKg: String(1000 + (await store("shell")) - 100), buyer: "Revata", gatePassNo: "GP-9" });
    expect(closeAll.statusCode).toBe(201);
    expect((await call("wi", "DELETE", `/shelling-days/${days[0].id}`)).json().error).toMatch(/shell store at -/);
    expect((await lot("ANG26G16")).shellingDays).toHaveLength(1);
  });
});

describe("the production workbook, Phases 3 and 4", () => {
  const WB_BATCH = BATCH;
  const wi = () => ({ id: wiId, role: "warehouse_incharge" as const });
  async function xlsx(tabs: Record<string, (string | number | Date | null)[][]>) {
    const wb = new ExcelJS.Workbook();
    for (const [title, rows] of Object.entries(tabs)) {
      const ws = wb.addWorksheet(title);
      for (const r of rows) ws.addRow(r);
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  const preview = (buf: Buffer) => previewProductionWorkbook(wi(), SITE, buf, "t.xlsx");
  const tabOf = (p: Awaited<ReturnType<typeof preview>>, name: string) => p.sheets.find((s) => s.name === name)!;
  const file = () => xlsx({
    Cooking: [["Cooking ID", "Batch Name", "Lot No", "Date", "Size A (24mm)", "Size B (22mm)", "Size E (18mm)"], [null, WB_BATCH, "ANG26G20", "2026-07-25", 1000, 500, null]],
    // A real Excel time cell: ExcelJS reads it as a date on 1899-12-30.
    "Cooker Log": [["Entry ID", "Lot No", "Date", "Size", "Start", "Stop", "Temperature (°C)", "Pressure (bar)"], [null, "ANG26G20", "2026-07-25", "A", new Date(Date.UTC(1899, 11, 30, 6, 25)), "07:00", 100, 2]],
    "Cooking Checks": [["Entry ID", "Lot No", "Date", "Size", "Remarks", "Result"], [null, "ANG26G20", "2026-07-25", "A", "", "OK"], [null, "ANG26G20", "2026-07-25", "B", "fine", "OK"]],
    Cooling: [["Lot No", "Cooling Silo", "Date In", "Time In"], ["ANG26G20", "CS-3", "2026-07-25", "12:00"]],
    "Cooling Checks": [["Entry ID", "Lot No", "Date", "Time of the check", "Moisture (%)", "Temperature (°C)", "Result"], [null, "ANG26G20", "2026-07-26", "13:00", 9, 30, "OK"]],
    "Shelling Days": [["Day ID", "Lot No", "Date", "Input Quantity (Kg's)", "Wholes (kg's)", "Pieces (kg's)"], [null, "ANG26G20", "2026-07-26", 1500, 400, 10]],
    "Shell Samples": [["Entry ID", "Lot No", "Date", "Sampling point", "Sample (g)", "Brokens (g)", "Shell (g)"], [null, "ANG26G20", "2026-07-26", "Line 1", 1000, 5, 995]],
    Boiler: [["Reading ID", "DATE", "QTY Consumed (Kg's)", "Running Hours"], [null, "2026-07-26", 10, 8]],
    Trucks: [["Truck ID", "Stream", "DATE", "TRUCK NO", "Documents Checked", "TARE WEIGHT", "GROSS WEIGHT", "Vendor", "Gate Pass No"], [null, "Shell", "2026-07-26", "WB-1", "Yes", 1000, 1010, "MTL", "GP-WB"]],
  });

  it("previews Phases 3–4 leaning on each other, and writes nothing", async () => {
    const p = await preview(await file());
    expect(p.sheets.flatMap((s) => s.errors)).toEqual([]);
    expect(p.sheets.map((s) => [s.name, s.created])).toEqual([["Cooking", 1], ["Cooker Log", 1], ["Cooking Checks", 2], ["Cooling", 1], ["Cooling Checks", 1], ["Shelling Days", 1], ["Shell Samples", 1], ["Boiler", 1], ["Trucks", 1]]);
    expect(await prisma.factoryLot.count({ where: { code: "ANG26G20" } })).toBe(0);
  });

  it("applies them: a real Excel time cell keeps its clock, and the Lot comes out Shelled", async () => {
    await commitProductionWorkbook(wi(), (await preview(await file())).token);
    const l = (await listLots(SITE, BATCH)).find((x) => x.code === "ANG26G20")!;
    expect(l).toMatchObject({ status: "shelled", totalKg: 1500, coolingSilo: "CS-3", coolingAt: "2026-07-25T12:00", coolingCheck: "ok" });
    expect(l.entries.find((e) => e.kind === "cooker_log")!.values).toMatchObject({ size: "A", start: "06:25" });
  });

  it("the same file again creates nothing, and an export uploaded back changes nothing", async () => {
    const again = await preview(await file());
    expect(again.sheets.flatMap((s) => s.errors)).toEqual([]);
    expect(again.totalCreated + again.totalChanged).toBe(0);
    const built = await downloadProductionWorkbook(SITE, {}, false);
    const p = await preview(Buffer.from(built.buffer as ArrayBuffer));
    expect(p.sheets.flatMap((s) => s.errors)).toEqual([]);
    expect(p.totalCreated + p.totalChanged).toBe(0);
    expect(tabOf(p, "Cooking").unchanged).toBeGreaterThan(0);
    expect(tabOf(p, "Trucks").unchanged).toBeGreaterThan(0);
  });

  it("gives the screens' own refusals, row by row", async () => {
    const p = await preview(await xlsx({
      Cooking: [["Cooking ID", "Batch Name", "Lot No", "Date", "Size A (24mm)"], [null, WB_BATCH, "ANG26G21", "2026-07-27", 99_999_999]],
      "Shelling Days": [["Day ID", "Lot No", "Date", "Input Quantity (Kg's)", "Wholes (kg's)"], [null, "NOPE", "2026-07-27", 1, 1]],
      Trucks: [["Truck ID", "Stream", "DATE", "TRUCK NO", "TARE WEIGHT"], [null, "Shell", "2026-07-27", "T", 100]],
    }));
    expect(tabOf(p, "Cooking").errors[0]!.message).toMatch(/can't be cooked from it/);
    expect(tabOf(p, "Shelling Days").errors[0]!.message).toMatch(/Lot NOPE doesn't exist/);
    expect(tabOf(p, "Trucks").errors[0]!.message).toMatch(/documents before weighing/);
  });
});
