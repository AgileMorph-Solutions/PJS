/**
 * Production Phase 2 (client's "Production module" doc, Phase 2): a load whose Intake is done is sized into the
 * 9 silos run by run until its into-silo kg is used up; QC-2 sizing checks go through the Incharge like a
 * moisture check; a failed silo is re-sized by hand, moving kg between silos; silo stock follows.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, setBranch, setStageFields } from "../src/services/receipts.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const SITE = "CAL-FACTORY";
const BATCH = "CAL-ANA-01";
const GRN = "GRN Weight (kept separate from Gross/Net/Paid)";
const cookies: Record<string, string> = {};

async function cleanup() {
  const atSite = { rcnReceipt: { batch: { warehouse: SITE } } };
  await prisma.manualCalibration.deleteMany({ where: { sizingCheck: { batch: { warehouse: SITE } } } });
  await prisma.sizingCheck.deleteMany({ where: { batch: { warehouse: SITE } } });
  await prisma.rcnCalibrationRun.deleteMany({ where: atSite });
  await prisma.rcnPallet.deleteMany({ where: atSite });
  await prisma.rcnEmptyPalletStack.deleteMany({ where: atSite });
  await prisma.rcnMoistureCheck.deleteMany({ where: atSite });
  await prisma.rcnReceipt.deleteMany({ where: { batch: { warehouse: SITE } } });
  await prisma.productionBatch.deleteMany({ where: { warehouse: SITE } });
  await prisma.receipt.deleteMany({ where: { warehouse: SITE } });
  await prisma.bin.deleteMany({ where: { code: { startsWith: "CAL-" } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "cal-" } } });
  await prisma.warehouse.deleteMany({ where: { name: SITE } });
}

async function login(key: string, role: string) {
  await prisma.user.create({ data: { username: `cal-${key}`, displayName: key, role, warehouse: SITE, passwordHash: hashPassword(PW) } });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `cal-${key}`, password: PW } });
  cookies[key] = String(res.headers["set-cookie"]).split(";")[0]!;
}

const call = (who: string, method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined, headers: { cookie: cookies[who]!, ...(payload ? { "content-type": "application/json" } : {}) } });

/** A load through all of Intake: OK moisture, one pallet, final weight. Into silos = 140,000 − 19.5 − 2,000 − 1,250 − 8. */
async function intakeDoneLoad(btmNo: string): Promise<string> {
  const id = (await call("wi", "POST", "/api/production/rcn-receipts", { batchCode: BATCH, date: "2026-07-25", btmNo, binCode: "CAL-03B" })).json().id;
  expect((await call("wi", "POST", `/api/production/rcn-receipts/${id}/moisture-checks`, { moisture: "8", nutCount: "180", decision: "ok" })).statusCode).toBe(201);
  expect((await call("wi", "POST", `/api/production/rcn-receipts/${id}/pallets`, { grossKg: "140000", bags: "30", factoryBin: "ANA-01" })).statusCode).toBe(201);
  return id;
}
const TO_SILOS = 136_722.5;

const calibration = async () => (await call("wi", "GET", `/api/production/batches/${BATCH}/calibration`)).json();
const silo = (cal: { silos: { size: string; stockKg: number }[] }, size: string) => cal.silos.find((s) => s.size === size)!.stockKg;

let loadId = "";

beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: SITE, kind: "FACTORY", type: "CENTRAL", code: "CAL" } });
  await prisma.bin.create({ data: { code: "CAL-03B" } });
  const r = await createReceipt(SITE, "2026-06-01");
  await setBranch(r.id, "n-qfs", "pass");
  await setStageFields(r.id, "n-bin", { "Bin Number": "CAL-03B" }, { bypassValidation: true });
  await setStageFields(r.id, "n-grn", { [GRN]: "2950400", PRICE: "470" }, { bypassValidation: true });
  await setBranch(r.id, "n-drying", "none");
  await setBranch(r.id, "n-xferdec", "stays");
  await login("wi", "warehouse_incharge");
  await login("qfs", "qfs_officer");
  expect((await call("wi", "POST", "/api/production/batches", { code: BATCH, startDate: "2026-07-19", bins: ["CAL-03B"] })).statusCode).toBe(201);
  loadId = await intakeDoneLoad("113");
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

describe("Kg into each silo (Phase 2, step 2)", () => {
  it("can't size a load before its final weight: it has no into-silo kg yet", async () => {
    const load = (await call("wi", "GET", `/api/production/rcn-receipts?batch=${BATCH}`)).json()[0];
    expect(load.calibration).toBeNull();
    const res = await call("wi", "POST", `/api/production/rcn-receipts/${loadId}/calibration-runs`, { date: "2026-07-25", sizes: { A: "100" } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/Weighing in progress; it can't be calibrated now/);
  });

  it("after the final weight the load is Intake done, with all of its into-silo kg still to calibrate", async () => {
    const res = await call("wi", "POST", `/api/production/rcn-receipts/${loadId}/final-weight`, { emptyPallets: [{ weightKg: "2000" }], dustKg: "1250", voidsKg: "8" });
    expect(res.json()).toMatchObject({ status: "intake_done", calibration: { toSilosKg: TO_SILOS, sizedKg: 0, leftKg: TO_SILOS, runs: [] } });
  });

  it("a first run puts it In calibration, fills the silos, and shows in the history", async () => {
    const res = await call("wi", "POST", `/api/production/rcn-receipts/${loadId}/calibration-runs`, {
      date: "2026-07-25",
      sizes: { Ap: "600", A: "24209", AB: "24089", B: " ", E: "5812" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: "calibrating", calibration: { sizedKg: 54_710, leftKg: 82_012.5 } });
    expect(res.json().calibration.runs[0]).toMatchObject({ date: "2026-07-25", sizes: { Ap: "600", A: "24209", AB: "24089", E: "5812" }, totalKg: 54_710, createdBy: "wi" });

    const cal = await calibration();
    expect([silo(cal, "Ap"), silo(cal, "A"), silo(cal, "B"), silo(cal, "E")]).toEqual([600, 24_209, 0, 5_812]);
    expect(cal.batchSizedKg.A).toBe(24_209);
    const batch = (await call("wi", "GET", `/api/production/batches/${BATCH}`)).json();
    expect(batch.history[0].text).toBe("BTM 113 sized into silos: 54,710 kg");
  });

  it("refuses sizing more than is left of the load, and bad numbers", async () => {
    const cases: [object, RegExp][] = [
      [{ date: "2026-07-26", sizes: { A: "82012.6" } }, /more than the 82,012.5 kg of this load still to calibrate/],
      [{ date: "2026-07-26", sizes: { A: "-5" } }, /Size A must be a number of kg, 0 or more/],
      [{ date: "2026-07-26", sizes: {} }, /at least one silo/],
      [{ date: "", sizes: { A: "1" } }, /date is required/],
    ];
    for (const [body, message] of cases) {
      const res = await call("wi", "POST", `/api/production/rcn-receipts/${loadId}/calibration-runs`, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(422);
      expect(res.json().error).toMatch(message);
    }
  });

  it("is Calibrated once the runs add up to the into-silo kg, and then takes no more", async () => {
    const res = await call("wi", "POST", `/api/production/rcn-receipts/${loadId}/calibration-runs`, { date: "2026-07-26", sizes: { BC: "50000", C: "32012.5" } });
    expect(res.json()).toMatchObject({ status: "calibrated", calibration: { sizedKg: TO_SILOS, leftKg: 0 } });
    const more = await call("wi", "POST", `/api/production/rcn-receipts/${loadId}/calibration-runs`, { date: "2026-07-26", sizes: { C: "1" } });
    expect(more.json().error).toMatch(/is Calibrated; it can't be calibrated now/);
  });

  it("is the Incharge's: a QFS Officer can't size a load", async () => {
    expect((await call("qfs", "POST", `/api/production/rcn-receipts/${loadId}/calibration-runs`, { date: "2026-07-26", sizes: { C: "1" } })).statusCode).toBe(403);
  });
});

describe("QC-2 sizing check and manual calibration (Phase 2, steps 3–4)", () => {
  // The client's "24. Wholes Manual Calibration" Sheet2, 28/08/2026, silo A+ of BIN-08B: 162 g A+, 792 g A, 46 g AB.
  const sample = { batchCode: BATCH, date: "2026-08-28", point: "Ap", binCode: "CAL-03B", nutCount: "129", sampleG: "1000", grams: { Ap: "162", A: "792", AB: "46" }, decision: "fail" };
  let checkId = 0;

  it("a QFS Officer's check waits for the Incharge, with the correct-size % and the doc's alert", async () => {
    expect((await call("qfs", "GET", `/api/production/batches/${BATCH}/calibration`)).statusCode).toBe(200);
    const res = await call("qfs", "POST", "/api/production/sizing-checks", sample);
    expect(res.statusCode).toBe(201);
    checkId = res.json().id;
    expect(res.json()).toMatchObject({ point: "Ap", status: "submitted", decision: "fail", submittedBy: "qfs", notes: ["Only 16.2 % is the silo's own size (target 85 %)."] });
    expect(res.json().correctPct).toBeCloseTo(16.2, 6);
  });

  it("no re-sizing by hand until the failed check is approved", async () => {
    const res = await call("wi", "POST", `/api/production/sizing-checks/${checkId}/manual-calibrations`, { date: "2026-08-28", toSize: "A", kg: "100" });
    expect(res.json().error).toMatch(/only after a failed, approved sizing check/);
  });

  it("only the Incharge approves; then nuts move out of the failed silo, within its stock", async () => {
    expect((await call("qfs", "POST", `/api/production/sizing-checks/${checkId}/approve`)).statusCode).toBe(403);
    expect((await call("wi", "POST", `/api/production/sizing-checks/${checkId}/approve`)).json().status).toBe("approved");

    const tooMuch = await call("wi", "POST", `/api/production/sizing-checks/${checkId}/manual-calibrations`, { date: "2026-08-28", toSize: "A", kg: "601" });
    expect(tooMuch.json().error).toMatch(/holds 600 kg; 601 kg can't be moved out of it/);
    const wrongSilo = await call("wi", "POST", `/api/production/sizing-checks/${checkId}/manual-calibrations`, { date: "2026-08-28", fromSize: "B", toSize: "A", kg: "1" });
    expect(wrongSilo.json().error).toMatch(/re-sized out of that silo/);

    const res = await call("wi", "POST", `/api/production/sizing-checks/${checkId}/manual-calibrations`, { date: "2026-08-28", toSize: "A", kg: "500" });
    expect(res.statusCode).toBe(201);
    expect(res.json().manualCalibrations).toMatchObject([{ fromSize: "Ap", toSize: "A", kg: "500", createdBy: "wi" }]);
    const cal = await calibration();
    expect([silo(cal, "Ap"), silo(cal, "A")]).toEqual([100, 24_709]);
    // Moving between silos changes no total: it is the same nuts.
    expect(cal.silos.reduce((n: number, s: { stockKg: number }) => n + s.stockKg, 0)).toBe(TO_SILOS);
  });

  it("won't remove a run whose nuts have since been moved out of a silo by hand", async () => {
    const load = (await call("wi", "GET", `/api/production/rcn-receipts?batch=${BATCH}`)).json()[0];
    const firstRun = load.calibration.runs[0].id;
    const res = await call("wi", "DELETE", `/api/production/calibration-runs/${firstRun}`);
    expect(res.json().error).toMatch(/would leave silo A\+ \(25 mm\) at -500 kg/);
    expect(await prisma.rcnCalibrationRun.count({ where: { id: firstRun } })).toBe(1);
  });

  it("an OK check needs no re-sizing, and a check can't be reviewed twice or rejected without a reason", async () => {
    const ok = (await call("qfs", "POST", "/api/production/sizing-checks", { ...sample, point: "A", grams: { A: "900", AB: "100" }, decision: "ok" })).json();
    expect(ok.correctPct).toBe(90);
    expect(ok.notes).toEqual([]);
    expect((await call("wi", "POST", `/api/production/sizing-checks/${ok.id}/reject`, { reason: " " })).json().error).toMatch(/Give a reason/);
    expect((await call("wi", "POST", `/api/production/sizing-checks/${ok.id}/reject`, { reason: "wrong silo" })).json()).toMatchObject({ status: "rejected", rejectReason: "wrong silo" });
    expect((await call("wi", "POST", `/api/production/sizing-checks/${ok.id}/approve`)).json().error).toMatch(/already rejected/);
  });

  it("refuses a sample from a bin outside the batch, and one with no grams", async () => {
    expect((await call("wi", "POST", "/api/production/sizing-checks", { ...sample, binCode: "BIN-NOPE" })).json().error).toMatch(/BIN-NOPE is not in batch/);
    expect((await call("wi", "POST", "/api/production/sizing-checks", { ...sample, grams: {} })).json().error).toMatch(/grams found in each size/);
  });

  it("an Incharge's own check is approved as saved, and the batch history reads both checks", async () => {
    const own = (await call("wi", "POST", "/api/production/sizing-checks", { ...sample, decision: "ok" })).json();
    expect(own).toMatchObject({ status: "approved", reviewedBy: "wi" });
    const texts = (await call("wi", "GET", `/api/production/batches/${BATCH}`)).json().history.map((h: { text: string }) => h.text);
    expect(texts).toContain("Sizing check (QC-2), Silo A+ (25 mm): Fail · re-size by hand: submitted for approval");
    expect(texts).toContain("Sizing check approved");
    expect(texts).toContain("Re-sized by hand: 500 kg from silo A+ (25 mm) to A (24 mm)");
  });
});
