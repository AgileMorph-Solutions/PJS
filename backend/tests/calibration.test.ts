/**
 * Production Phase 2 (client's "Production module" doc, Phase 2), as agreed in Nov 2026: only the silos' total is
 * known, so a load goes into the silos as net − dust − voids when its final weight is saved (Intake & Calibration are
 * one stage); QC-2 sizing checks go through the Incharge like a moisture check; a failed silo is re-sized by hand,
 * recorded as typed; silo stock is one total.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, setBranch, setStageFields } from "../src/services/receipts.js";
import { submitSizingCheck } from "../src/services/production/calibration.js";

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

const ids: Record<string, string> = {};

async function login(key: string, role: string) {
  ids[key] = (await prisma.user.create({ data: { username: `cal-${key}`, displayName: key, role, warehouse: SITE, passwordHash: hashPassword(PW) } })).id;
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `cal-${key}`, password: PW } });
  cookies[key] = String(res.headers["set-cookie"]).split(";")[0]!;
}

const call = (who: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined, headers: { cookie: cookies[who]!, ...(payload ? { "content-type": "application/json" } : {}) } });

/** A load weighed but not closed: OK moisture, one pallet. Its final weight (below) puts 140,000 − 19.5 − 2,000 − 1,250 − 8 into the silos. */
async function weighedLoad(btmNo: string): Promise<string> {
  const id = (await call("wi", "POST", "/api/production/rcn-receipts", { batchCode: BATCH, date: "2026-07-25", btmNo, binCode: "CAL-03B" })).json().id;
  expect((await call("wi", "POST", `/api/production/rcn-receipts/${id}/moisture-checks`, { moisture: "8", nutCount: "180", decision: "ok" })).statusCode).toBe(201);
  expect((await call("wi", "POST", `/api/production/rcn-receipts/${id}/pallets`, { grossKg: "140000", bags: "30", factoryBin: "ANA-01" })).statusCode).toBe(201);
  return id;
}
const TO_SILOS = 136_722.5;

// The silos are the production team's to see (18 Nov 2026); the warehouse team sees its loads only.
const calibration = async () => (await call("pi", "GET", `/api/production/batches/${BATCH}/calibration`)).json();
/**
 * A check sent for approval. No screen role sends one now (the QFS Officer is the warehouse's; the Production Incharge's
 * own check counts as saved), but the service still holds one from someone who can't approve it, for the factory's
 * Quality roles to come — so the approval is tested through the service.
 */
const submitted = (body: object) => submitSizingCheck(SITE, { id: ids.qfs!, role: "qfs_officer" }, body as never);

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
  await setBranch(r.id, "n-xferdec", "production");
  await login("wi", "warehouse_incharge");
  await login("qfs", "qfs_officer");
  await login("pi", "production_incharge");
  await login("admin", "admin");
  expect((await call("wi", "POST", "/api/production/batches", { code: BATCH, startDate: "2026-07-19", bins: ["CAL-03B"] })).statusCode).toBe(201);
  loadId = await weighedLoad("113");
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

describe("Intake & Calibration, one stage", () => {
  it("before the final weight the load is not in the silos, and there is no route to sort it by hand", async () => {
    const load = (await call("wi", "GET", `/api/production/rcn-receipts?batch=${BATCH}`)).json()[0];
    expect(load.status).toBe("weighing");
    expect(load).not.toHaveProperty("calibration");
    expect((await calibration()).silos).toEqual({ inKg: 0, cookedKg: 0, stockKg: 0 });
    const res = await call("wi", "POST", `/api/production/rcn-receipts/${loadId}/calibration-runs`, { date: "2026-07-25", sizes: { A: "100" } });
    expect(res.statusCode).toBe(404);
  });

  // The silos are the factory's: a weighed load is still the warehouse's until production accepts it (Lokesh, 16 Nov 2026).
  it("the final weight alone puts nothing in the silos: the load waits for production", async () => {
    const res = await call("wi", "POST", `/api/production/rcn-receipts/${loadId}/final-weight`, { emptyPallets: [{ weightKg: "2000" }], dustKg: "1250", voidsKg: "8" });
    expect(res.json().status).toBe("waiting_for_acceptance");
    expect((await calibration()).silos).toEqual({ inKg: 0, cookedKg: 0, stockKg: 0 });
  });

  it("production's acceptance makes it Calibrated: net − dust − voids is in this run's silos and in the history", async () => {
    expect((await call("pi", "POST", `/api/production/rcn-receipts/${loadId}/accept`)).json().status).toBe("calibrated");
    const cal = await calibration();
    expect(cal.silos).toEqual({ inKg: TO_SILOS, cookedKg: 0, stockKg: TO_SILOS });
    const texts = (await call("wi", "GET", `/api/production/batches/${BATCH}`)).json().history.map((h: { text: string }) => h.text);
    expect(texts).toContain("BTM 113 weighed: 1 pallet, net 137,980.5 kg");
    expect(texts).toContain("BTM 113 accepted by production: net 137,980.5 kg out of CAL-03B, 136,722.5 kg into the silos");
  });

  it("an Admin's correction to an accepted load changes what is in the silos with it: one number, never a copy", async () => {
    const pallet = (await call("wi", "GET", `/api/production/rcn-receipts?batch=${BATCH}`)).json()[0].pallets[0];
    const fix = (grossKg: string) => call("admin", "PUT", `/api/production/rcn-pallets/${pallet.id}?warehouse=${SITE}`, { grossKg, bags: "30", factoryBin: "ANA-01" });
    expect((await fix("140100")).statusCode).toBe(200);
    expect((await calibration()).silos.stockKg).toBe(TO_SILOS + 100);
    expect((await fix("140000")).statusCode).toBe(200);
    expect((await calibration()).silos.stockKg).toBe(TO_SILOS);
  });
});

describe("QC-2 sizing check and manual calibration (Phase 2, steps 3–4)", () => {
  // The client's "24. Wholes Manual Calibration" Sheet2, 28/08/2026, silo A+ of BIN-08B: 162 g A+, 792 g A, 46 g AB.
  const sample = { batchCode: BATCH, date: "2026-08-28", point: "Ap", binCode: "CAL-03B", nutCount: "129", sampleG: "1000", grams: { Ap: "162", A: "792", AB: "46" }, decision: "fail" };
  let checkId = 0;

  it("is the production team's and the QFS Officer's: the Warehouse Incharge neither sees the silos nor checks them", async () => {
    expect((await call("wi", "GET", `/api/production/batches/${BATCH}/calibration`)).statusCode).toBe(403);
    expect((await call("wi", "POST", "/api/production/sizing-checks", sample)).statusCode).toBe(403);
    // 26 Nov 2026: the QFS Officer takes every quality check, QC-2 included, so they read the silos (their check is sent below).
    expect((await call("qfs", "GET", `/api/production/batches/${BATCH}/calibration`)).statusCode).toBe(200);
  });

  it("a check sent for approval waits for the Production Incharge, with the correct-size % and the doc's alert", async () => {
    const check = await submitted(sample);
    checkId = check.id;
    expect(check).toMatchObject({ point: "Ap", status: "submitted", decision: "fail", submittedBy: "qfs", notes: ["Only 16.2 % is the silo's own size (target 85 %)."] });
    expect(check.correctPct).toBeCloseTo(16.2, 6);
  });

  it("no re-sizing by hand until the failed check is approved", async () => {
    const res = await call("pi", "POST", `/api/production/sizing-checks/${checkId}/manual-calibrations`, { date: "2026-08-28", toSize: "A", kg: "100" });
    expect(res.json().error).toMatch(/only after a failed, approved sizing check/);
  });

  it("only the Production Incharge approves; then nuts move out of the failed silo, recorded as typed", async () => {
    expect((await call("qfs", "POST", `/api/production/sizing-checks/${checkId}/approve`)).statusCode).toBe(403);
    // Calibration is after the acceptance: the warehouse's side no longer approves it.
    expect((await call("wi", "POST", `/api/production/sizing-checks/${checkId}/approve`)).statusCode).toBe(403);
    expect((await call("pi", "POST", `/api/production/sizing-checks/${checkId}/approve`)).json().status).toBe("approved");

    const nothing = await call("pi", "POST", `/api/production/sizing-checks/${checkId}/manual-calibrations`, { date: "2026-08-28", toSize: "A", kg: "0" });
    expect(nothing.json().error).toMatch(/above 0/);
    const wrongSilo = await call("pi", "POST", `/api/production/sizing-checks/${checkId}/manual-calibrations`, { date: "2026-08-28", fromSize: "B", toSize: "A", kg: "1" });
    expect(wrongSilo.json().error).toMatch(/re-sized out of that silo/);

    const res = await call("pi", "POST", `/api/production/sizing-checks/${checkId}/manual-calibrations`, { date: "2026-08-28", toSize: "A", kg: "500" });
    expect(res.statusCode).toBe(201);
    expect(res.json().manualCalibrations).toMatchObject([{ fromSize: "Ap", toSize: "A", kg: "500", createdBy: "pi" }]);
    // Moving between silos changes no total: it is the same nuts.
    expect((await calibration()).silos.stockKg).toBe(TO_SILOS);
  });

  it("flags the silo until it is re-sized, then asks for a new check; a silo not yet checked says so", async () => {
    const cal = await calibration();
    expect(cal.siloChecks.Ap).toMatchObject({ state: "re_sized", date: "2026-08-28" });
    expect(cal.siloChecks.Ap.correctPct).toBeCloseTo(16.2, 6);
    expect(cal.siloChecks.B).toEqual({ state: "not_checked", correctPct: null, date: null, checkId: null });
  });

  it("an OK check needs no re-sizing, and a check can't be reviewed twice or rejected without a reason", async () => {
    const ok = await submitted({ ...sample, point: "A", grams: { A: "900", AB: "100" }, decision: "ok" });
    expect(ok.correctPct).toBe(90);
    expect(ok.notes).toEqual([]);
    expect((await call("pi", "POST", `/api/production/sizing-checks/${ok.id}/reject`, { reason: " " })).json().error).toMatch(/Give a reason/);
    expect((await call("pi", "POST", `/api/production/sizing-checks/${ok.id}/reject`, { reason: "wrong silo" })).json()).toMatchObject({ status: "rejected", rejectReason: "wrong silo" });
    expect((await call("pi", "POST", `/api/production/sizing-checks/${ok.id}/approve`)).json().error).toMatch(/already rejected/);
  });

  it("refuses a sample from a bin outside the batch, and one with no grams", async () => {
    expect((await call("pi", "POST", "/api/production/sizing-checks", { ...sample, binCode: "BIN-NOPE" })).json().error).toMatch(/BIN-NOPE is not in production run/);
    expect((await call("pi", "POST", "/api/production/sizing-checks", { ...sample, grams: {} })).json().error).toMatch(/grams found in each size/);
  });

  it("a silo failed from another batch can be fixed from this one: the silos are the factory's", async () => {
    // Silo A+ last failed on BATCH's check; another batch's page must still see that check, with its moves.
    await prisma.bin.create({ data: { code: "CAL-OTHER" } });
    const r = await createReceipt(SITE, "2026-06-02");
    await setBranch(r.id, "n-qfs", "pass");
    await setStageFields(r.id, "n-bin", { "Bin Number": "CAL-OTHER" }, { bypassValidation: true });
    await setStageFields(r.id, "n-grn", { [GRN]: "1000000", PRICE: "470" }, { bypassValidation: true });
    await setBranch(r.id, "n-drying", "none");
    await setBranch(r.id, "n-xferdec", "production");
    expect((await call("wi", "POST", "/api/production/batches", { code: "CAL-OTHER-B", startDate: "2026-08-01", bins: ["CAL-OTHER"] })).statusCode).toBe(201);
    const other = (await call("pi", "GET", "/api/production/batches/CAL-OTHER-B/calibration")).json();
    // BATCH is the run's name; the check is stored against the run's system ID.
    const runId = (await call("pi", "GET", `/api/production/batches/${BATCH}`)).json().code;
    expect(other.sizingChecks.map((c: { id: number; batchCode: string }) => [c.id, c.batchCode])).toEqual([[checkId, runId]]);
    expect(other.siloChecks.Ap.checkId).toBe(checkId);
    // The silo kg are not shared: each run's stock is only what its own accepted loads put in.
    expect(other.silos).toEqual({ inKg: 0, cookedKg: 0, stockKg: 0 });
    expect(other.daily).toEqual([]);
  });

  it("reports the silos day by day, closing on the same total as the silo stock", async () => {
    const cal = await calibration();
    expect(cal.daily.map((d: { date: string; openingKg: number; inKg: number; closingKg: number }) => [d.date, d.openingKg, d.inKg, d.closingKg])).toEqual([
      ["2026-07-25", 0, TO_SILOS, TO_SILOS],
      ["2026-08-28", TO_SILOS, 0, TO_SILOS],
    ]);
    expect(cal.daily[1].movedKg).toBe(500);
    expect(cal.daily.at(-1).closingKg).toBe(cal.silos.stockKg);
  });

  it("an Incharge's own check is approved as saved, and the batch history reads both checks", async () => {
    const own = (await call("pi", "POST", "/api/production/sizing-checks", { ...sample, decision: "ok" })).json();
    expect(own).toMatchObject({ status: "approved", reviewedBy: "pi" });
    const texts = (await call("pi", "GET", `/api/production/batches/${BATCH}`)).json().history.map((h: { text: string }) => h.text);
    expect(texts).toContain("Sizing check (QC-2), Silo A+ (25 mm): Fail · re-size by hand: submitted for approval");
    expect(texts).toContain("Sizing check approved");
    expect(texts).toContain("Re-sized by hand: 500 kg from silo A+ (25 mm) to A (24 mm)");
  });
});
