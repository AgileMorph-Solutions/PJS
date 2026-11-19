/**
 * Production Phases 3–4 through the API: cooking takes kg out of the silos, QC-4 gates shelling, shelling
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
import { addLotEntry, listLots } from "../src/services/production/factoryLots.js";
import { TABS } from "../src/domain/productionWorkbook/tabs.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const SITE = "FLT-FACTORY";
const BATCH = "FLT-ANA-01";
const GRN = "GRN Weight (kept separate from Gross/Net/Paid)";
const cookies: Record<string, string> = {};
let piId = "";
let qfsId = "";
const IN_SILOS = 198_722.5;

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

const lots = async () => (await call("pi", "GET", `/batches/${BATCH}/lots`)).json();
const lot = async (code: string) => (await lots()).lots.find((l: { code: string }) => l.code === code);
/** The silos' kg now: one total, as no kg per silo is recorded (decision, Nov 2026). */
const silos = async () => (await batchCalibration(SITE, BATCH))!.silos.stockKg;
const store = async (stream: string) => (await lots()).stores.find((s: { stream: string }) => s.stream === stream).stockKg;
const entry = (who: string, code: string, body: object) => call(who, "POST", `/factory-lots/${code}/entries`, body);
/**
 * A quality check sent for approval. No screen role sends one now — the QFS Officer is the warehouse's, and the Production
 * Incharge's own checks count as saved (18 Nov 2026) — but the service still holds a check from someone who can't approve
 * it, for the factory's Quality roles to come (Lokesh, 16 Nov 2026), so its approval is tested through the service.
 */
const submit = (code: string, body: object) => addLotEntry(SITE, { id: qfsId, role: "qfs_officer" }, code, body as never);

const cookerLog = { kind: "cooker_log", date: "2026-07-20", values: { cookerNo: "2", size: "A", start: "06:00", stop: "07:00", tempC: "100", pressureBar: "2", siloName: "CS-1", gateNo: "3" } };
const qc4Ok = { kind: "qc4", date: "2026-07-21", values: { time: "10:00", moisture: "9", tempC: "30" }, decision: "ok" };
const dayRow = { date: "2026-07-21", inputKg: "20000", wholesKg: "5000", piecesKg: "200", rejectionKg: "400", oilKg: "60", blackRejectionKg: "120", firstPassUncutKg: "1800", finalUncutKg: "150" };
// Final kernels 5,780; dust 300; shell 13,920.

/** A Lot of 20,000 kg through cooking, cooling and QC-4, as the Incharge. */
async function readyLot(code: string) {
  expect((await call("pi", "POST", "/factory-lots", { batchCode: BATCH, code, date: "2026-07-20", sizes: { A: "20000" } })).statusCode).toBe(201);
  expect((await call("pi", "POST", `/factory-lots/${code}/cooling`, { silo: "CS-1", date: "2026-07-20", time: "09:00" })).statusCode).toBe(200);
  expect((await entry("pi", code, qc4Ok)).statusCode).toBe(201);
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
  await login("wi", "warehouse_incharge");
  piId = await login("pi", "production_incharge");
  await login("admin", "admin");
  qfsId = await login("qfs", "qfs_officer");
  await login("fm", "factory_manager");
  expect((await call("wi", "POST", "/batches", { code: BATCH, startDate: "2026-07-19", bins: ["FLT-03B"] })).statusCode).toBe(201);
  // 202,000 kg gross − 19.5 kg of bags − 2,000 kg of pallets − 1,250 dust − 8 voids = 198,722.5 kg into the silos,
  // the moment production accepts the weighed load (Intake & Calibration are one stage).
  const load = (await call("wi", "POST", "/rcn-receipts", { batchCode: BATCH, date: "2026-07-19", btmNo: "113", binCode: "FLT-03B" })).json().id;
  await call("wi", "POST", `/rcn-receipts/${load}/moisture-checks`, { moisture: "8", nutCount: "180", decision: "ok" });
  await call("wi", "POST", `/rcn-receipts/${load}/pallets`, { grossKg: "202000", bags: "30", factoryBin: "ANA-01" });
  const closed = await call("wi", "POST", `/rcn-receipts/${load}/final-weight`, { emptyPallets: [{ weightKg: "2000" }], dustKg: "1250", voidsKg: "8" });
  expect(closed.json().status).toBe("waiting_for_acceptance");
  // The silos are the factory's from production's acceptance (Lokesh, 16 Nov 2026).
  expect((await call("pi", "POST", `/rcn-receipts/${load}/accept`)).json().status).toBe("calibrated");
  expect(await silos()).toBe(IN_SILOS);
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

describe("Cooking (Phase 3)", () => {
  it("a Lot is born here: kg leave the silos, total and bags are worked out, and it starts as Cooking", async () => {
    const res = await call("pi", "POST", "/factory-lots", { batchCode: BATCH, code: "ang26g16", date: "2026-07-20", sizes: { A: "30000", B: "10000" } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ code: "ANG26G16", status: "cooking", totalKg: 40_000, bags: 500, cookedSizes: ["A", "B"], damagedKg: 0 });
    expect(await silos()).toBe(IN_SILOS - 40_000);
    const cal = (await batchCalibration(SITE, BATCH))!;
    expect(cal.silos.cookedKg).toBe(40_000);
    expect(cal.daily.at(-1)).toMatchObject({ date: "2026-07-20", cookedKg: 40_000 });
    expect((await call("pi", "GET", `/batches/${BATCH}`)).json().history[0].text).toBe("Lot ANG26G16 cooked: 40,000 kg");
  });

  it("can't cook more than its run has in the silos, nor for a batch elsewhere; only the Production Incharge cooks", async () => {
    const over = await call("pi", "POST", "/factory-lots", { batchCode: BATCH, code: "ANG26G17", date: "2026-07-20", sizes: { A: "100000", B: "58722.6" } });
    expect(over.statusCode).toBe(422);
    expect(over.json().error).toMatch(/has 158,722.5 kg in the silos; 158,722.6 kg can.t be cooked/);
    expect((await call("pi", "POST", "/factory-lots", { batchCode: "NOPE", code: "X1", date: "2026-07-20", sizes: { A: "1" } })).json().error).toMatch(/Production run NOPE doesn't exist/);
    // Cooking is after the acceptance: the warehouse's side records loads, not Lots.
    for (const who of ["qfs", "wi"]) expect((await call(who, "POST", "/factory-lots", { batchCode: BATCH, code: "X1", date: "2026-07-20", sizes: { A: "1" } })).statusCode).toBe(403);
  });

  it("a second row adds to the same Lot (ANG26F01 has two in the sheet), and removing it returns the kg", async () => {
    const res = await call("pi", "POST", "/factory-lots", { batchCode: BATCH, code: "ANG26G16", date: "2026-07-20", sizes: { A: "1000" } });
    expect(res.json()).toMatchObject({ totalKg: 41_000, sizes: { A: 31_000 } });
    expect(await silos()).toBe(IN_SILOS - 41_000);
    expect((await call("pi", "DELETE", `/lot-cook-runs/${res.json().runs[1].id}`)).statusCode).toBe(204);
    expect(await silos()).toBe(IN_SILOS - 40_000);
    expect((await lot("ANG26G16")).totalKg).toBe(40_000);
  });

  it("damaged or spoiled kg leave the silos with the row, but are never left to shell; never more than the row cooked", async () => {
    const over = await call("pi", "POST", "/factory-lots", { batchCode: BATCH, code: "ANG26G16", date: "2026-07-20", sizes: { A: "1000" }, damagedKg: "1001" });
    expect(over.json().error).toMatch(/more than the 1,000 kg cooked/);
    const res = await call("pi", "POST", "/factory-lots", { batchCode: BATCH, code: "ANG26G16", date: "2026-07-20", sizes: { A: "1000" }, damagedKg: "250" });
    expect(res.json()).toMatchObject({ totalKg: 41_000, damagedKg: 250, leftToShellKg: 40_750 });
    expect(res.json().runs[1].damagedKg).toBe("250");
    expect(await silos()).toBe(IN_SILOS - 41_000);
    expect((await call("pi", "GET", `/batches/${BATCH}`)).json().history[0].text).toBe("Lot ANG26G16 cooked: 1,000 kg, of which 250 kg damaged or spoiled");
    expect((await call("pi", "DELETE", `/lot-cook-runs/${res.json().runs[1].id}`)).statusCode).toBe(204);
    expect((await lot("ANG26G16")).damagedKg).toBe(0);
  });

  it("a load's weighing can't be lowered below what was already cooked out of the silos", async () => {
    // 40,000 − 19.5 − 2,000 − 1,258 = 36,722.5 kg into the silos, but 40,000 kg are already cooked.
    const load = (await call("pi", "GET", `/rcn-receipts?batch=${BATCH}`)).json()[0];
    const lower = { grossKg: "40000", bags: "30", factoryBin: "ANA-01" };
    // Accepted, the load is closed to the warehouse; an Admin's correction still meets the silo rule.
    expect((await call("wi", "PUT", `/rcn-pallets/${load.pallets[0].id}`, lower)).json().error).toMatch(/Production has accepted/);
    const res = await call("admin", "PUT", `/rcn-pallets/${load.pallets[0].id}?warehouse=${SITE}`, lower);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/silo stock at -3,277.5 kg: the run has already cooked more than that/);
    expect(await silos()).toBe(IN_SILOS - 40_000);
  });

  it("the cooker log is the floor's: it names the cooker, the size, and the cooling silo and gate (1–3) the run goes to", async () => {
    expect((await entry("qfs", "ANG26G16", cookerLog)).statusCode).toBe(403);
    expect((await entry("pi", "ANG26G16", { ...cookerLog, values: { ...cookerLog.values, cookerNo: "" } })).json().error).toMatch(/cooker no/i);
    expect((await entry("pi", "ANG26G16", { ...cookerLog, values: { ...cookerLog.values, siloName: "" } })).json().error).toMatch(/target cooling silo/i);
    expect((await entry("pi", "ANG26G16", { ...cookerLog, values: { ...cookerLog.values, gateNo: "4" } })).json().error).toMatch(/Gate must be one of 1, 2, 3/);
    expect((await entry("pi", "ANG26G16", { ...cookerLog, values: { ...cookerLog.values, size: "C" } })).json().error).toMatch(/cooked no size C/);
    const saved = await entry("pi", "ANG26G16", cookerLog);
    expect(saved.statusCode).toBe(201);
    expect(saved.json().entries.at(-1)).toMatchObject({ status: "approved", values: { cookerNo: "2", siloName: "CS-1", gateNo: "3" } });
    // The cooking check (QC-3) is no longer done: the kind is gone.
    expect((await entry("pi", "ANG26G16", { kind: "qc3", date: "2026-07-20", decision: "ok", values: { size: "A" } })).json().error).toMatch(/Choose what is being recorded/);
  });

  it("a Lot goes to its cooling silo straight after cooking, with no check in between; then cooking is over", async () => {
    const cooling = { silo: "CS-1", date: "2026-07-20", time: "09:00" };
    expect((await call("pi", "POST", "/factory-lots/ANG26G16/cooling", { ...cooling, time: "9am" })).json().error).toMatch(/HH:MM/);
    expect((await call("pi", "POST", "/factory-lots/ANG26G16/cooling", cooling)).json()).toMatchObject({ status: "cooling", coolingSilo: "CS-1", coolingAt: "2026-07-20T09:00" });
    // Cooking is over: nothing more cooks into it, and its rows stand.
    expect((await call("pi", "POST", "/factory-lots", { batchCode: BATCH, code: "ANG26G16", date: "2026-07-20", sizes: { A: "1" } })).json().error).toMatch(/gone to its cooling silo/);
    expect((await call("pi", "DELETE", `/lot-cook-runs/${(await lot("ANG26G16")).runs[0].id}`)).json().error).toMatch(/can't be changed/);
  });

  it("QC-4: shelling stays shut on Wait, a re-check opens it, and under 24 hours is a note", async () => {
    const shelling = () => call("pi", "POST", "/factory-lots/ANG26G16/shelling-days", dayRow);
    expect((await shelling()).json().error).toMatch(/has not passed its moisture and temperature check/);
    const wait = await submit("ANG26G16", { kind: "qc4", date: "2026-07-20", values: { time: "20:00", moisture: "12", tempC: "45" }, decision: "wait" });
    const e = wait.entries.at(-1)!;
    expect(e.notes[0]).toMatch(/Only 11.0 hours in the cooling silo/);
    expect(wait.coolingCheck).toBe("waiting");
    expect((await call("pi", "POST", `/lot-entries/${e.id}/reject`, { reason: " " })).json().error).toMatch(/Give a reason/);
    expect((await call("pi", "POST", `/lot-entries/${e.id}/approve`)).json()).toMatchObject({ status: "cooling", coolingCheck: "wait" });
    expect((await shelling()).statusCode).toBe(422);
    expect((await entry("qfs", "ANG26G16", { kind: "line_run", date: "2026-07-21", values: {} })).statusCode).toBe(403);
    expect((await entry("pi", "ANG26G16", { kind: "qty1", date: "2026-07-21", values: { line: "A1", kg: "1", repassed: "Yes" } })).json().error).toMatch(/shelling can't start/);
    expect((await entry("pi", "ANG26G16", qc4Ok)).json()).toMatchObject({ status: "ready", coolingCheck: "ok", leftToShellKg: 40_000 });
    expect((await call("pi", "POST", "/factory-lots/ANG26G16/cooling", { silo: "CS-2", date: "2026-07-20", time: "09:00" })).json().error).toMatch(/its cooling silo can't change now/);
  });

  it("cooking waste water goes to its store, and its record can be removed unless it has left", async () => {
    const saved = await entry("pi", "ANG26G16", { kind: "waste_water", date: "2026-07-20", values: { kg: "6000", tank: "T1" } });
    expect(await store("waste_water")).toBe(6000);
    const closed = await call("pi", "POST", "/trucks", { stream: "waste_water", date: "2026-07-21", truckNo: "4316CV04", documentsChecked: true, tareKg: "6350", grossKg: "12050", buyer: "BECO", gatePassNo: "WW-1" });
    expect(closed.statusCode).toBe(201);
    expect(await store("waste_water")).toBe(300);
    const res = await call("pi", "DELETE", `/lot-entries/${saved.json().entries.at(-1).id}`);
    expect(res.json().error).toMatch(/cooking waste water store at -5,700 kg/);
    expect(await store("waste_water")).toBe(300);
  });
});

describe("Shelling (Phase 4)", () => {
  it("the day record works out kernels, dust and shell; the Lot is Shelled, and the stores fill", async () => {
    const res = await call("pi", "POST", "/factory-lots/ANG26G16/shelling-days", dayRow);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: "shelled", shelledKg: 20_000, leftToShellKg: 20_000 });
    expect(res.json().shellingDays[0].figures).toMatchObject({ goodKg: 5200, finalKg: 5780, shellDustKg: 300, shellKg: 13_920 });
    expect(await store("shell")).toBe(13_920);
    expect(await store("shell_dust")).toBe(300);
    const history = (await call("pi", "GET", `/batches/${BATCH}`)).json().history;
    expect(history[0].text).toBe("Lot ANG26G16 shelled: 20,000 kg in, 5,780 kg kernels (26.00 % good), 13,920 kg shell");
  });

  it("refuses outputs above the input; a QFS Officer can't enter it", async () => {
    expect((await call("pi", "POST", "/factory-lots/ANG26G16/shelling-days", { ...dayRow, wholesKg: "99999" })).json().error).toMatch(/more than the input/);
    expect((await call("qfs", "POST", "/factory-lots/ANG26G16/shelling-days", dayRow)).statusCode).toBe(403);
  });

  it("shelling more than was cooked is a note, as the client's ANG26F10 does it", async () => {
    await readyLot("ANG26G18");
    const res = await call("pi", "POST", "/factory-lots/ANG26G18/shelling-days", { ...dayRow, inputKg: "21000" });
    expect(res.statusCode).toBe(201);
    expect(res.json().shellingDays[0].notes[0]).toMatch(/Only 20,000 kg of this Lot is left to shell/);
    expect(res.json().leftToShellKg).toBe(-1000);
  });

  it("the checks on the line: figures, alerts, and one button to approve a shift's samples", async () => {
    const sample = { kind: "qc5_capacity", date: "2026-07-21", values: { shift: "A", line: "A1", machine: "1", sampleG: "1000", wholesG: "189", piecesG: "1", knifeMarkG: "20", uncutG: "130", unscoopWholesG: "129", unscoopPiecesG: "13", shellG: "538" } };
    await submit("ANG26G16", sample);
    const second = await submit("ANG26G16", { ...sample, values: { ...sample.values, machine: "2" } });
    const made = second.entries.filter((e: { kind: string }) => e.kind === "qc5_capacity");
    expect(made.map((e: { status: string }) => e.status)).toEqual(["submitted", "submitted"]);
    expect(made[0].notes).toEqual([expect.stringMatching(/Wholes 90.0 % is below the 95 % target/)]);
    expect((await call("qfs", "POST", "/factory-lots/ANG26G16/entries/approve-all", { kind: "qc5_capacity" })).statusCode).toBe(403);
    const all = await call("pi", "POST", "/factory-lots/ANG26G16/entries/approve-all", { kind: "qc5_capacity" });
    expect(all.json().entries.filter((e: { kind: string; status: string }) => e.kind === "qc5_capacity" && e.status === "approved")).toHaveLength(2);
    expect((await entry("pi", "ANG26G16", { kind: "qc6", date: "2026-07-21", values: { point: "Line 2", sampleG: "1000", brokensG: "7.8", shellG: "992.2" } })).json().entries.at(-1).notes).toEqual([expect.stringMatching(/0.78 % kernel left in the shell/)]);
    expect((await entry("pi", "ANG26G16", { kind: "line_run", date: "2026-07-21", values: { line: "A++", size: "App", inputKg: "8010", start: "06:25", end: "12:00", uncutKg: "700" } })).statusCode).toBe(201);
    // A check stays on record; only the floor's own lines come off.
    const q = (await lot("ANG26G16")).entries.find((e: { kind: string }) => e.kind === "qc6");
    expect((await call("pi", "DELETE", `/lot-entries/${q.id}`)).json().error).toMatch(/stays on record/);
  });

  // 18 Nov 2026: the warehouse team sees its loads, nothing after them; the production team sees all of it.
  it("the Factory Manager reads the Lots and the stores; the warehouse team can't, nor a QFS Officer enter anything", async () => {
    const res = await call("fm", "GET", `/batches/${BATCH}/lots`);
    expect(res.statusCode).toBe(200);
    expect(res.json().lots.map((l: { code: string }) => l.code).slice(0, 2)).toEqual(["ANG26G16", "ANG26G18"]);
    for (const who of ["wi", "qfs"]) expect((await call(who, "GET", `/batches/${BATCH}/lots`)).statusCode, who).toBe(403);
    expect((await call("qfs", "POST", "/trucks", { stream: "shell", date: "2026-07-21", truckNo: "X" })).statusCode).toBe(403);
    expect((await call("fm", "POST", "/trucks", { stream: "shell", date: "2026-07-21", truckNo: "X" })).statusCode).toBe(403);
  });
});

describe("Colour sort (Phase 5)", () => {
  // ANG26G16's day record: wholes 5,000, pieces 200, rejection + oil 460, black rejection 120.
  const sample = (stream: string, decision?: string) => ({ kind: decision ? "qc7_after" : "qc7_before", date: "2026-07-22", values: { stream, sizes: "BC to E", sampleG: "1000", wholesG: "916", brokensG: "20", buttsG: "10", knifeMarkG: "36", rejectionG: "12", oilDirtG: "6" }, ...(decision ? { decision } : {}) });

  it("only a shelled Lot can be sampled at the sorter", async () => {
    await readyLot("ANG26G19");
    expect((await entry("pi", "ANG26G19", sample("Wholes"))).json().error).toMatch(/no shelling day record yet/);
  });

  it("a stream that failed is held until a newer check passes it; the Lot is Colour sorted once every stream has", async () => {
    expect((await entry("pi", "ANG26G16", sample("Wholes"))).statusCode).toBe(201);
    const no = await submit("ANG26G16", sample("Wholes", "no"));
    expect(no.sortChecks.Wholes).toBe("waiting");
    const e = no.entries.at(-1)!;
    expect((await call("pi", "POST", `/lot-entries/${e.id}/approve`)).json()).toMatchObject({ status: "shelled", sortChecks: { Wholes: "resort", Pieces: "not_checked" } });
    await entry("pi", "ANG26G16", sample("Wholes", "ok"));
    await entry("pi", "ANG26G16", sample("Pieces", "ok"));
    expect((await lot("ANG26G16")).status).toBe("shelled");
    const sorted = await entry("pi", "ANG26G16", sample("Rejection + oil", "ok"));
    expect(sorted.json()).toMatchObject({ status: "colour_sorted", sorterStreams: ["Wholes", "Pieces", "Rejection + oil"], sorterKg: { Wholes: 5000, Pieces: 200, "Rejection + oil": 460 } });
    const history = (await call("pi", "GET", `/batches/${BATCH}`)).json().history.map((h: { text: string }) => h.text);
    expect(history).toContain("Lot ANG26G16 QC-7, Wholes: No · sort again: submitted for approval");
  });

  it("a stream shelling gave none of can't be checked after the sorter", async () => {
    const lotWithout = await call("pi", "POST", "/factory-lots/ANG26G19/shelling-days", { date: "2026-07-22", inputKg: "1000", wholesKg: "200" });
    expect(lotWithout.json().sorterStreams).toEqual(["Wholes"]);
    expect((await entry("pi", "ANG26G19", sample("Pieces", "ok"))).json().error).toMatch(/Shelling gave ANG26G19 no Pieces to sort/);
  });

  it("black rejection is its own store, from the day records, sold by truck within it", async () => {
    // ANG26G16 120 + ANG26G18 120 + ANG26G19 0.
    expect(await store("black_rejection")).toBe(240);
    const over = await call("pi", "POST", "/trucks", { stream: "black_rejection", date: "2026-07-23", truckNo: "BR-1", documentsChecked: true, tareKg: "1000", grossKg: "1241", buyer: "Buyer", gatePassNo: "BR-GP-1" });
    expect(over.json().error).toMatch(/black rejection store holds 240 kg; a truck of 241 kg/);
    expect((await call("pi", "POST", "/trucks", { stream: "black_rejection", date: "2026-07-23", truckNo: "BR-1", documentsChecked: true, tareKg: "1000", grossKg: "1200", buyer: "Buyer", gatePassNo: "BR-GP-1" })).statusCode).toBe(201);
    expect(await store("black_rejection")).toBe(40);
  });
});

describe("Trucks and the boiler", () => {
  let id = 0;
  const shellTruck = { stream: "shell", date: "2026-07-22", truckNo: "2040KB01", driver: "Yao" };

  it("the gate procedure, saved as the truck moves; only leaving takes kg out of the store", async () => {
    const before = await store("shell");
    expect((await call("pi", "POST", "/trucks", { ...shellTruck, tareKg: "20850" })).json().error).toMatch(/documents before weighing/);
    const at = await call("pi", "POST", "/trucks", shellTruck);
    id = at.json().id;
    expect(at.json().status).toBe("at_gate");
    const up = (v: object) => call("pi", "PUT", `/trucks/${id}`, { ...shellTruck, documentsChecked: true, ...v });
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
    expect((await call("pi", "PUT", `/trucks/${id}`, { ...shellTruck, documentsChecked: true, tareKg: "1", grossKg: "2", buyer: "x", gatePassNo: "GP-1" })).json().error).toMatch(/has left on gate pass GP-1/);
    expect((await call("pi", "DELETE", `/trucks/${id}`)).json().error).toMatch(/stays on record/);
    const twin = await call("pi", "POST", "/trucks", { ...shellTruck, documentsChecked: true, tareKg: "1000", grossKg: "1100", buyer: "Revata", gatePassNo: "GP-1" });
    expect(twin.json().error).toMatch(/Gate pass GP-1 is already used/);
    const open = await call("pi", "POST", "/trucks", shellTruck);
    expect((await call("pi", "DELETE", `/trucks/${open.json().id}`)).statusCode).toBe(204);
  });

  it("the boiler burns from the shell silo, never more than it holds", async () => {
    const before = await store("shell");
    expect((await call("pi", "POST", "/boiler", { date: "2026-07-22", shellKg: String(before + 1) })).json().error).toMatch(/can't be burned/);
    const res = await call("pi", "POST", "/boiler", { date: "2026-07-22", shellKg: "7000", runningHours: "8" });
    expect(res.statusCode).toBe(201);
    expect(await store("shell")).toBeCloseTo(before - 7000, 3);
    const shell = (await lots()).stores.find((s: { stream: string }) => s.stream === "shell");
    expect(shell).toMatchObject({ burnedKg: 7000, dispatchedKg: 9150 });
    expect((await call("qfs", "POST", "/boiler", { date: "2026-07-22", shellKg: "1" })).statusCode).toBe(403);
  });

  it("dust and voids from Intake are in their store, ready for a truck", async () => {
    expect(await store("dust_voids")).toBe(1258);
    expect((await call("pi", "POST", "/trucks", { stream: "dust_voids", date: "2026-07-22", truckNo: "T1", documentsChecked: true, tareKg: "1000", grossKg: "2259", buyer: "GI2E", gatePassNo: "D-1" })).json().error).toMatch(/holds 1,258 kg; a truck of 1,259 kg/);
  });

  it("a shelling day can't be removed once its shell has left, and can be while there is room", async () => {
    const days = (await lot("ANG26G16")).shellingDays;
    // A truck takes nearly all that is left, so the shell of this day has gone and its record must stay.
    const closeAll = await call("pi", "POST", "/trucks", { stream: "shell", date: "2026-07-23", truckNo: "T9", documentsChecked: true, tareKg: "1000", grossKg: String(1000 + (await store("shell")) - 100), buyer: "Revata", gatePassNo: "GP-9" });
    expect(closeAll.statusCode).toBe(201);
    expect((await call("pi", "DELETE", `/shelling-days/${days[0].id}`)).json().error).toMatch(/shell store at -/);
    expect((await lot("ANG26G16")).shellingDays).toHaveLength(1);
  });
});

describe("the production workbook, Phases 3 and 4", () => {
  const WB_BATCH = BATCH;
  // The factory's tabs are the Production Incharge's to upload (tabs.ts INTAKE_TABS).
  const pi = () => ({ id: piId, role: "production_incharge" as const });
  async function xlsx(tabs: Record<string, (string | number | Date | null)[][]>) {
    const wb = new ExcelJS.Workbook();
    for (const [title, rows] of Object.entries(tabs)) {
      const ws = wb.addWorksheet(title);
      for (const r of rows) ws.addRow(r);
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  const preview = (buf: Buffer) => previewProductionWorkbook(pi(), SITE, buf, "t.xlsx");
  // A tab by its title, or by the older name this test's file still uses: those keep uploading.
  const tabOf = (p: Awaited<ReturnType<typeof preview>>, name: string) => p.sheets.find((s) => s.name === TABS.find((t) => t.title === name || t.aliases?.includes(name))!.title)!;
  const file = () => xlsx({
    Cooking: [["Cooking ID", "Batch Name", "Lot No", "Date", "Size A (24mm)", "Size B (22mm)", "Size E (18mm)", "Damaged / Spoiled (kg)"], [null, WB_BATCH, "ANG26G20", "2026-07-25", 1000, 500, null, 100]],
    // A real Excel time cell: ExcelJS reads it as a date on 1899-12-30.
    "Cooker Log": [["Entry ID", "Lot No", "Date", "Cooker No", "Size", "Start", "Stop", "Temperature (°C)", "Pressure (bar)", "Silo Name", "Gate No"], [null, "ANG26G20", "2026-07-25", "1", "A", new Date(Date.UTC(1899, 11, 30, 6, 25)), "07:00", 100, 2, "CS-3", 2]],
    // An older file's QC-3 tab: read past, with a word on why.
    "Cooking Checks": [["Entry ID", "Lot No", "Date", "Size", "Remarks", "Result"], [null, "ANG26G20", "2026-07-25", "A", "", "OK"]],
    Cooling: [["Lot No", "Cooling Silo", "Date In", "Time In"], ["ANG26G20", "CS-3", "2026-07-25", "12:00"]],
    "Cooling Checks": [["Entry ID", "Lot No", "Date", "Time of the check", "Moisture (%)", "Temperature (°C)", "Result"], [null, "ANG26G20", "2026-07-26", "13:00", 9, 30, "OK"]],
    "Shelling Days": [["Day ID", "Lot No", "Date", "Input Quantity (Kg's)", "Wholes (kg's)", "Pieces (kg's)"], [null, "ANG26G20", "2026-07-26", 1500, 400, 10]],
    "Shell Samples": [["Entry ID", "Lot No", "Date", "Sampling point", "Sample (g)", "Brokens (g)", "Shell (g)"], [null, "ANG26G20", "2026-07-26", "Line 1", 1000, 5, 995]],
    Boiler: [["Reading ID", "DATE", "QTY Consumed (Kg's)", "Running Hours"], [null, "2026-07-26", 10, 8]],
    "20. Shell Dispatch Tracker": [["DATE", "TRUCK NO", "TARE WEIGHT", "GROSS WEIGHT", "Vendor", "Truck ID", "Documents Checked", "Gate Pass No"], ["2026-07-26", "WB-1", 1000, 1010, "MTL", null, "Yes", "GP-WB"]],
  });

  it("previews Phases 3–4 leaning on each other, and writes nothing", async () => {
    const p = await preview(await file());
    expect(p.sheets.flatMap((s) => s.errors)).toEqual([]);
    // Reported step by step, in the floor's order: the workbook's own.
    expect(p.sheets.map((s) => [s.name, s.created])).toEqual([
      ["6. Cooking Process", 1], ["7. Cooking Cycles Monitoring", 1], ["9. Cooling", 1], ["10. Cooling Checks", 1],
      ["11. Shelling Process", 1], ["16. Shell Waste Sample", 1], ["18. Boiler Consumption", 1], ["20. Shell Dispatch Tracker", 1],
    ]);
    expect(p.notices).toContainEqual(expect.stringMatching(/Sheet "Cooking Checks" — ignored: the cooking check \(QC-3\) is no longer done/));
    expect(await prisma.factoryLot.count({ where: { code: "ANG26G20" } })).toBe(0);
  });

  it("applies them: a real Excel time cell keeps its clock, and the Lot comes out Shelled", async () => {
    await commitProductionWorkbook(pi(), (await preview(await file())).token);
    const l = (await listLots(SITE, BATCH)).find((x) => x.code === "ANG26G20")!;
    expect(l).toMatchObject({ status: "shelled", totalKg: 1500, damagedKg: 100, coolingSilo: "CS-3", coolingAt: "2026-07-25T12:00", coolingCheck: "ok" });
    expect(l.entries.find((e) => e.kind === "cooker_log")!.values).toMatchObject({ size: "A", start: "06:25", cookerNo: "1", siloName: "CS-3", gateNo: "2" });
  });

  it("the same file again creates nothing, and an export uploaded back changes nothing", async () => {
    const again = await preview(await file());
    expect(again.sheets.flatMap((s) => s.errors.map((e) => `${s.name} row ${e.row}: ${e.message}`))).toEqual([]);
    expect(again.totalCreated + again.totalChanged).toBe(0);
    const built = await downloadProductionWorkbook(SITE, {}, false);
    const p = await preview(Buffer.from(built.buffer as ArrayBuffer));
    expect(p.sheets.flatMap((s) => s.errors.map((e) => `${s.name} row ${e.row}: ${e.message}`))).toEqual([]);
    expect(p.totalCreated + p.totalChanged).toBe(0);
    expect(tabOf(p, "Cooking").unchanged).toBeGreaterThan(0);
    expect(tabOf(p, "20. Shell Dispatch Tracker").unchanged).toBeGreaterThan(0);
  });

  it("gives the screens' own refusals, row by row", async () => {
    const p = await preview(await xlsx({
      Cooking: [["Cooking ID", "Batch Name", "Lot No", "Date", "Size A (24mm)"], [null, WB_BATCH, "ANG26G21", "2026-07-27", 99_999_999]],
      "Shelling Days": [["Day ID", "Lot No", "Date", "Input Quantity (Kg's)", "Wholes (kg's)"], [null, "NOPE", "2026-07-27", 1, 1]],
      "20. Shell Dispatch Tracker": [["DATE", "TRUCK NO", "TARE WEIGHT"], ["2026-07-27", "T", 100]],
      // File 15's Category says the waste; one the app doesn't follow is refused with the words it does.
      "19. Waste Management Dispatch": [["DATE", "TRUCK NO", "Category"], ["2026-07-27", "T2", "Factory Waste"]],
      // A tab from before the files were followed says where its rows went now.
      Trucks: [["Truck ID", "Stream"], [null, "Shell"]],
    }));
    expect(tabOf(p, "Cooking").errors[0]!.message).toMatch(/can't be cooked from it/);
    expect(tabOf(p, "Shelling Days").errors[0]!.message).toMatch(/Lot NOPE doesn't exist/);
    expect(tabOf(p, "20. Shell Dispatch Tracker").errors[0]!.message).toMatch(/documents before weighing/);
    expect(tabOf(p, "19. Waste Management Dispatch").errors[0]!.message).toMatch(/"Factory Waste" isn't a waste the app follows. Category must be Calibration Dust, Cooking Waste Water, Shell Dust, Black Rejection/);
    expect(p.notices).toContainEqual(expect.stringMatching(/Sheet "Trucks" — ignored: trucks are now on two tabs/));
  });
});
