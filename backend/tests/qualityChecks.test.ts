/**
 * The QFS Officer takes every quality check (26 Nov 2026, user) and sends it for approval, and sees them all on one list named
 * by section. The bug this guards against: the contract said the QFS Officer takes the factory's QC checks, yet the server
 * refused them — so the first block proves, for EVERY section, that the routes a QFS Officer uses are open to them. A new
 * section can't be added to the contract without listing its routes here (the Record is exhaustive).
 *
 * Then, through the HTTP routes, on throwaway warehouses: the Incharge records drying, a transfer lot and a triage without
 * their quality; the QFS Officer finds each on their list, sends the readings, and nothing changes until the Incharge approves.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { QualityCheckItem, QualityChecksView, QualitySection } from "@anagroci/contract/domain/qualityChecks";
import { buildApp } from "../src/app.js";
import { isAllowed } from "../src/auth/policy.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, setBranch, setStageFields } from "../src/services/receipts.js";

/** What a QFS Officer calls to take each section's checks. */
const ROUTES: Record<QualitySection, [method: string, path: string][]> = {
  reception: [["GET", "/api/receipts/REC-X"], ["POST", "/api/receipts/REC-X/submissions"]],
  unloading: [["POST", "/api/receipts/REC-X/submissions"]],
  unit_reception: [["GET", "/api/receipts/REC-X"], ["POST", "/api/receipts/REC-X/submissions"]],
  drying: [["POST", "/api/quality-submissions"]],
  triage: [["POST", "/api/quality-submissions"]],
  transfer_lot: [["POST", "/api/quality-submissions"]],
  production_intake: [["GET", "/api/production/rcn-receipts"], ["POST", "/api/production/rcn-receipts/RR-1/moisture-checks"]],
  production: [
    ["GET", "/api/production/batches/RUN-1/calibration"], ["GET", "/api/production/batches/RUN-1/lots"],
    ["POST", "/api/production/sizing-checks"], ["POST", "/api/production/factory-lots/LOT-1/entries"],
  ],
};

describe("every section's checks are open to the QFS Officer", () => {
  it("lets them reach each section's routes, and their list", () => {
    for (const [section, routes] of Object.entries(ROUTES)) {
      for (const [method, path] of routes) expect(isAllowed("qfs_officer", method, path), `${section}: ${method} ${path}`).toBe(true);
    }
    expect(isAllowed("qfs_officer", "GET", "/api/quality-checks")).toBe(true);
  });

  it("keeps the decisions and the floor's records off them", () => {
    expect(isAllowed("qfs_officer", "POST", "/api/quality-submissions/1/approve")).toBe(false);
    expect(isAllowed("qfs_officer", "POST", "/api/production/lot-entries/1/approve")).toBe(false);
    expect(isAllowed("qfs_officer", "POST", "/api/production/factory-lots")).toBe(false);
    expect(isAllowed("qfs_officer", "POST", "/api/drying-batches/x/check")).toBe(false);
    expect(isAllowed("branch_manager", "POST", "/api/quality-submissions")).toBe(false);
  });
});

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const UNIT = "QCHK-UNIT";
const UNIT_STORE = "QCHK-UNIT-STORE";
const CENTRAL = "QCHK-CENTRAL";
const BIN = "QCHK-BIN-01";
const NEW_BIN = "QCHK-BIN-02";
const GRN = "GRN Weight (kept separate from Gross/Net/Paid)";
const cookies: Record<string, string> = {};

async function cleanup() {
  await prisma.qualitySubmission.deleteMany({ where: { warehouse: { in: [UNIT, UNIT_STORE, CENTRAL] } } });
  await prisma.dryingBatch.deleteMany({ where: { warehouseSite: { in: [UNIT, CENTRAL] } } });
  await prisma.transferLot.deleteMany({ where: { warehouse: UNIT } });
  await prisma.warehouseActivityLedgerEntry.deleteMany({ where: { warehouse: { in: [UNIT, UNIT_STORE] } } });
  await prisma.receipt.deleteMany({ where: { warehouse: { in: [UNIT, UNIT_STORE] } } });
  await prisma.changeLog.deleteMany({ where: { user: { username: { startsWith: "qchk-" } } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "qchk-" } } });
  await prisma.bin.deleteMany({ where: { code: { startsWith: "QCHK-" } } });
  await prisma.warehouse.deleteMany({ where: { site: UNIT } });
  await prisma.warehouse.deleteMany({ where: { name: { in: [UNIT, CENTRAL] } } });
}

const call = (who: string, method: "GET" | "POST", url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined, headers: { cookie: cookies[who]!, ...(payload ? { "content-type": "application/json" } : {}) } });
const list = async (who = "qfs"): Promise<QualityChecksView> => (await call(who, "GET", "/api/quality-checks")).json();
const find = async (pred: (i: QualityCheckItem) => boolean, who = "qfs") => (await list(who)).items.find(pred);

beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: UNIT, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "QCHU" } });
  await prisma.warehouse.create({ data: { name: UNIT_STORE, site: UNIT } });
  await prisma.warehouse.create({ data: { name: CENTRAL, kind: "FACTORY", type: "CENTRAL", code: "QCHC" } });
  await prisma.bin.createMany({ data: [{ code: BIN, warehouseName: UNIT_STORE, source: "test" }, { code: NEW_BIN, warehouseName: UNIT_STORE, source: "test" }] });
  // 20 t in the Bin: a truck that passed quality, with its GRN complete.
  const r = await createReceipt(UNIT, "2026-11-01");
  await setBranch(r.id, "n-qfs", "pass");
  await setStageFields(r.id, "n-bin", { "Bin Number": BIN }, { bypassValidation: true });
  await setStageFields(r.id, "n-grn", { [GRN]: "20000", PRICE: "470" }, { bypassValidation: true });
  const users = [["wi", "warehouse_incharge", UNIT_STORE], ["qfs", "qfs_officer", UNIT_STORE], ["cqfs", "qfs_officer", CENTRAL]] as const;
  for (const [key, role, warehouse] of users) {
    await prisma.user.create({ data: { username: `qchk-${key}`, displayName: `QCHK ${key}`, role, warehouse, passwordHash: hashPassword(PW) } });
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `qchk-${key}`, password: PW } });
    cookies[key] = String(res.headers["set-cookie"]).split(";")[0]!;
  }
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

describe("the QFS Officer's list", () => {
  it("names the sections of their warehouse: a Unit warehouse has no production", async () => {
    const view = await list();
    expect(view).toMatchObject({ warehouse: UNIT, siteType: "UNIT" });
    expect(view.sections).toEqual(["reception", "unloading", "drying", "triage", "transfer_lot"]);
    expect((await list("cqfs")).sections).toContain("production");
  });
});

describe("drying, checked by the QFS Officer", () => {
  let round = "";

  it("lets the Incharge start drying without the quality, which then shows on the QFS Officer's list", async () => {
    const res = await call("wi", "POST", `/api/bins/${BIN}/drying`, { dryType: "SUN DRYING", issuedNetKg: "5000", issuedBags: "100" });
    expect(res.statusCode).toBe(201);
    round = res.json().id;
    const item = await find((i) => i.key === `drying_before-${round}`);
    expect(item).toMatchObject({ section: "drying", state: "to_do", reference: `Drying round 1 of Bin ${BIN}`, link: { kind: "form", submissionKind: "drying_before", targetId: round } });
  });

  it("holds the QFS Officer's reading until the Incharge approves it, one at a time", async () => {
    expect((await call("wi", "POST", "/api/quality-submissions", { kind: "drying_before", targetId: round, values: { inputMoisture: "12" } })).statusCode).toBe(403);
    const sent = await call("qfs", "POST", "/api/quality-submissions", { kind: "drying_before", targetId: round, values: { inputMoisture: "12.5", inputNutCount: "180" } });
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({ section: "drying", status: "submitted", reference: `Drying round 1 of Bin ${BIN}` });
    expect((await call("qfs", "POST", "/api/quality-submissions", { kind: "drying_before", targetId: round, values: { inputMoisture: "13" } })).json().error).toMatch(/already waiting/);
    expect((await prisma.dryingBatch.findUnique({ where: { id: round } }))!.inputMoisturePct).toBeNull();
    expect(await find((i) => i.key === `quality-${sent.json().id}`)).toMatchObject({ state: "waiting_approval", section: "drying" });

    expect((await call("qfs", "POST", `/api/quality-submissions/${sent.json().id}/approve`)).statusCode).toBe(403);
    expect((await call("wi", "POST", `/api/quality-submissions/${sent.json().id}/approve`)).statusCode).toBe(200);
    expect(Number((await prisma.dryingBatch.findUnique({ where: { id: round } }))!.inputMoisturePct)).toBe(12.5);
    expect(await find((i) => i.key === `drying_before-${round}`)).toBeUndefined();
  });

  it("asks for the check after drying once it came back; the Incharge names the new Bin when approving a pass", async () => {
    expect((await call("qfs", "POST", "/api/quality-submissions", { kind: "drying_after", targetId: round, values: { outputMoisture: "8.9", decision: "pass" } })).json().error).toMatch(/hasn't come back/);
    expect((await call("wi", "POST", `/api/drying-batches/${round}/return`, { receivedNetKg: "4800" })).statusCode).toBe(200);
    expect(await find((i) => i.key === `drying_after-${round}`)).toMatchObject({ state: "to_do", missing: ["Moisture after drying", "Result"] });

    const sent = (await call("qfs", "POST", "/api/quality-submissions", { kind: "drying_after", targetId: round, values: { outputMoisture: "8.9", outputNutCount: "182", decision: "pass" } })).json();
    expect((await call("wi", "POST", `/api/quality-submissions/${sent.id}/approve`)).json().error).toMatch(/new Bin/);
    expect((await call("wi", "POST", `/api/quality-submissions/${sent.id}/approve`, { destinationBin: NEW_BIN })).statusCode).toBe(200);
    const done = (await prisma.dryingBatch.findUnique({ where: { id: round } }))!;
    expect(done).toMatchObject({ status: "PASSED", destinationBinNo: NEW_BIN });
    expect(Number(done.outputMoisturePct)).toBe(8.9);
    expect(done.checkedBy).toMatch(/^QCHK qfs \(approved by QCHK wi\)$/);
  });
});

describe("a transfer lot's quality, by the QFS Officer", () => {
  it("weighs the lot without it, keeps it off trucks, and makes it ready once the reading is approved", async () => {
    const lot = (await call("wi", "POST", "/api/transfer-lots", { warehouse: UNIT, lotDate: "2026-11-20", bins: [{ binCode: BIN, bags: 50 }] })).json();
    const weighed = (await call("wi", "POST", `/api/transfer-lots/${lot.id}/weighing`, { grossWeightKg: "4050" })).json();
    expect(weighed).toMatchObject({ status: "waiting_quality", moisture: null });
    expect(await find((i) => i.key === `transfer_lot-${lot.id}`)).toMatchObject({ section: "transfer_lot", reference: `Transfer lot ${lot.lotNo}` });

    expect((await call("qfs", "POST", "/api/quality-submissions", { kind: "transfer_lot", targetId: String(lot.id), values: { moisture: "9" } })).json().error).toMatch(/KOR: Required/);
    const sent = (await call("qfs", "POST", "/api/quality-submissions", { kind: "transfer_lot", targetId: String(lot.id), values: { moisture: "9", kor: "47", nutCount: "190" } })).json();
    expect((await call("wi", "POST", `/api/quality-submissions/${sent.id}/approve`)).statusCode).toBe(200);
    expect((await call("wi", "GET", `/api/transfer-lots?warehouse=${UNIT}`)).json().find((l: { id: number }) => l.id === lot.id)).toMatchObject({ status: "ready", moisture: 9, kor: 47, nutCount: 190 });
  });
});

describe("the moisture after triage, by the QFS Officer", () => {
  it("records the triage without it; a rejected reading needs a reason and changes nothing", async () => {
    const entry = (await call("wi", "POST", "/api/warehouse-activity-ledger", { category: "triage", locationFrom: BIN, quantityBeforeKg: "1000", quantityAfterKg: "970" })).json();
    expect(entry).toMatchObject({ moisturePct: null });
    expect(await find((i) => i.key === `triage-${entry.id}`)).toMatchObject({ section: "triage", missing: ["Moisture after triage"] });

    const sent = (await call("qfs", "POST", "/api/quality-submissions", { kind: "triage", targetId: entry.id, values: { moisturePct: "9.1" } })).json();
    expect((await call("wi", "POST", `/api/quality-submissions/${sent.id}/reject`, {})).json().error).toMatch(/reason is required/);
    expect((await call("wi", "POST", `/api/quality-submissions/${sent.id}/reject`, { reason: "Sample taken before the triage ended" })).statusCode).toBe(200);
    expect((await prisma.warehouseActivityLedgerEntry.findUnique({ where: { id: entry.id } }))!.moisturePct).toBeNull();
    // Shown to its sender as rejected, with the reason; the check is to do again.
    expect(await find((i) => i.key === `quality-${sent.id}`)).toMatchObject({ state: "rejected", note: "Sample taken before the triage ended" });
    expect(await find((i) => i.key === `triage-${entry.id}`)).toMatchObject({ state: "to_do" });
  });
});

describe("the factory's checks", () => {
  it("are no longer refused to the QFS Officer: a sizing check reaches its own validation", async () => {
    const res = await call("cqfs", "POST", "/api/production/sizing-checks", {});
    expect(res.statusCode).not.toBe(403);
    expect(res.json().error).toMatch(/production run/);
    expect((await call("cqfs", "GET", "/api/production/batches/NO-SUCH-RUN/lots")).statusCode).toBe(404);
  });
});
