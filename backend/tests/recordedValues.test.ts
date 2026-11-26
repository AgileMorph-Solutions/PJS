/**
 * Team rule, 22 Nov 2026: once a value is recorded, only the Warehouse Incharge or an Admin changes it. A Branch Manager or QFS
 * Officer fills an empty field; to correct a recorded one they ask the Incharge or an Admin, so a recorded value can't be quietly
 * rewritten afterwards. Through the HTTP routes each role really uses: the Branch Manager's price, the QFS Officer's form and its
 * approval, and the Incharge's own edits.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, setBranch, setStageFields } from "../src/services/receipts.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const SITE = "RVX";
const SUPPLIER = "RVX-SUP-A";
const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};

async function cleanup() {
  await prisma.branchManagerSupplier.deleteMany({ where: { supplierCode: { startsWith: "RVX" } } });
  await prisma.formSubmission.deleteMany({ where: { receipt: { warehouse: SITE } } });
  await prisma.receipt.deleteMany({ where: { warehouse: SITE } });
  await prisma.supplier.deleteMany({ where: { code: { startsWith: "RVX" } } });
  await prisma.changeLog.deleteMany({ where: { user: { username: { startsWith: "rvx-" } } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "rvx-" } } });
  await prisma.warehouse.deleteMany({ where: { name: SITE } });
}
async function login(key: string, role: string, warehouse: string | null) {
  const u = await prisma.user.create({ data: { username: `rvx-${key}`, displayName: key, role, warehouse, passwordHash: hashPassword(PW) } });
  ids[key] = u.id;
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `rvx-${key}`, password: PW } });
  cookies[key] = String(res.headers["set-cookie"]).split(";")[0]!;
}
const call = (who: string, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined, headers: { cookie: cookies[who]!, ...(payload ? { "content-type": "application/json" } : {}) } });

/**
 * A truck of the Branch Manager's supplier with every reception step up to the GRN filled (the phase order opens Quality and
 * the GRN only after the steps before them), so each test is about who may change a value, not about the order.
 */
async function truck() {
  const r = await createReceipt(SITE, "2026-11-20");
  const by = { bypassValidation: true };
  await setStageFields(r.id, "n-gate", { "DATE OF ARRIVAL": "2026-11-20", "CREDIT/CASH": "CASH", "WH LOCATION": SITE, "VEHICLE NO.": "RVX-1" }, by);
  await setStageFields(r.id, "n-verify", { "LBA CODE": SUPPLIER, "SUPPLIERS NAME": SUPPLIER, "FICHE CODE": "F", FICHE: "1", ORIGIN: "O" }, by);
  await setStageFields(r.id, "n-gross", { "Loaded truck weight (kg)": "56300", "Tare / empty truck weight (kg)": "15000" }, by);
  await setBranch(r.id, "n-qfs", "pass");
  await setStageFields(r.id, "n-unload", {
    "DATE OF OFFLOADING": "2026-11-20", "BON SACS (good bags)": "463", "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "15",
    "Reconditioning of torn bags": "0", Refraction: "60",
  }, by);
  await setStageFields(r.id, "n-bin", { "Bin Number": "RVX-BIN-1", "Basis for allocation (moisture / quality / KOR / space)": "Space", "Bin allocation date": "2026-11-20" }, by);
  return r.id;
}
const stageOf = async (who: string, id: string, stageId: string) => {
  const body = (await call(who, "GET", `/api/receipts/${id}`)).json();
  return (body.data ?? body).stageData[stageId] ?? {};
};

beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: SITE, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "RVX" } });
  await prisma.supplier.create({ data: { code: SUPPLIER, name: "RVX A" } });
  await login("admin", "admin", null);
  await login("wi", "warehouse_incharge", SITE);
  await login("bm", "branch_manager", SITE);
  await login("qfs", "qfs_officer", SITE);
  await prisma.branchManagerSupplier.create({ data: { userId: ids.bm!, supplierCode: SUPPLIER, assignedById: ids.admin! } });
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

describe("the Branch Manager's price", () => {
  it("is set once; changing or clearing it afterwards is an Admin's, and the same price again changes nothing", async () => {
    const id = await truck();
    // The GRN, where the price is, opens once the final quality readings are in too.
    await setStageFields(id, "n-qfs", {
      "Final moisture (%)": "8.5", "Final nut count": "180", "Final – Good Kernel (g)": "270", "Final – Immature (g)": "30", "Final – Spotted (g)": "20",
    }, { bypassValidation: true });
    const first = await call("bm", "PUT", `/api/receipts/${id}/price`, { price: "470" });
    expect(first.statusCode, first.body).toBe(200);
    const change = await call("bm", "PUT", `/api/receipts/${id}/price`, { price: "500" });
    expect(change.statusCode).toBe(422);
    expect(change.json().error).toMatch(/Already recorded: PRICE \(470\).*only be changed by an Admin/);
    expect((await call("bm", "PUT", `/api/receipts/${id}/price`, { price: "" })).statusCode).toBe(422);
    expect((await call("bm", "PUT", `/api/receipts/${id}/price`, { price: "470" })).statusCode).toBe(200);
    expect((await call("admin", "PUT", `/api/receipts/${id}/price`, { price: "500" })).statusCode).toBe(200);
    expect((await stageOf("admin", id, "n-grn")).PRICE).toBe("500");
  });
});

describe("the QFS Officer's form", () => {
  it("fills what is empty, and can't change a value the Incharge already recorded — sending it unchanged is fine", async () => {
    const id = await truck();
    await setStageFields(id, "n-qfs", { "Sample moisture (%)": "9.5" }, { actor: { id: ids.wi!, via: "direct", role: "warehouse_incharge" } });
    const changed = await call("qfs", "POST", `/api/receipts/${id}/submissions`, { values: { "n-qfs": { "Sample moisture (%)": "10", "Sample nut count": "172" } } });
    expect(changed.statusCode).toBe(422);
    expect(changed.json().error).toMatch(/Already recorded: Sample moisture \(%\) \(9\.5\).*Warehouse Incharge or an Admin/);

    const ok = await call("qfs", "POST", `/api/receipts/${id}/submissions`, { values: { "n-qfs": { "Sample moisture (%)": "9.5", "Sample nut count": "172" } } });
    expect(ok.statusCode, ok.body).toBe(201);
    // Only the new value is the submission's; the recorded one stays the Incharge's.
    expect(ok.json().values).toEqual({ "n-qfs": { "Sample nut count": "172" } });
  });

  it("isn't approved over a value recorded after it was submitted: the Incharge rejects it or changes the value", async () => {
    const id = await truck();
    const sub = await call("qfs", "POST", `/api/receipts/${id}/submissions`, { values: { "n-qfs": { "Final moisture (%)": "8.0" } } });
    expect(sub.statusCode, sub.body).toBe(201);
    await setStageFields(id, "n-qfs", { "Final moisture (%)": "7.5" }, { actor: { id: ids.wi!, via: "direct", role: "warehouse_incharge" } });
    const approve = await call("wi", "POST", `/api/submissions/${sub.json().id}/approve`);
    expect(approve.statusCode).toBe(422);
    expect(approve.json().error).toMatch(/Since this was submitted, Final moisture \(%\) \(now 7\.5\) was recorded/);
    expect((await stageOf("wi", id, "n-qfs"))["Final moisture (%)"]).toBe("7.5");
  });
});

describe("the Warehouse Incharge and Admin", () => {
  it("change a recorded value directly, as before", async () => {
    const id = await truck();
    await setStageFields(id, "n-gate", { "VEHICLE NO.": "AB-1" }, { actor: { id: ids.wi!, via: "direct", role: "warehouse_incharge" } });
    await setStageFields(id, "n-gate", { "VEHICLE NO.": "AB-2" }, { actor: { id: ids.wi!, via: "direct", role: "warehouse_incharge" } });
    await setStageFields(id, "n-gate", { "VEHICLE NO.": "AB-3" }, { actor: { id: ids.admin!, via: "direct", role: "admin" } });
    expect((await stageOf("admin", id, "n-gate"))["VEHICLE NO."]).toBe("AB-3");
  });
});

// 23 Nov 2026: a QFS Officer who sent part of the form (moisture first) sends the rest later (the cut-test grams).
describe("sending the form again", () => {
  const send = (id: string, values: Record<string, Record<string, string>>) => call("qfs", "POST", `/api/receipts/${id}/submissions`, { values });

  it("waits while one is pending, then after its approval takes what is still empty — never a recorded value", async () => {
    const id = await truck();
    const first = await send(id, { "n-qfs": { "Sample moisture (%)": "8" } });
    expect(first.statusCode).toBe(201);
    const early = await send(id, { "n-qfs": { "Sample nut count": "200" } });
    expect(early.statusCode).toBe(422);
    expect(early.json().error).toMatch(/already waiting for approval/);

    expect((await call("wi", "POST", `/api/submissions/${first.json().id}/approve`)).statusCode).toBe(200);
    const rest = await send(id, { "n-qfs": { "Sample nut count": "200", "Sample – Good Kernel (g)": "100" } });
    expect(rest.statusCode).toBe(201);
    expect((await send(id, { "n-qfs": { "Sample moisture (%)": "9" } })).statusCode).toBe(422); // pending again
    expect((await call("wi", "POST", `/api/submissions/${rest.json().id}/approve`)).statusCode).toBe(200);
    expect(await stageOf("wi", id, "n-qfs")).toMatchObject({ "Sample moisture (%)": "8", "Sample nut count": "200", "Sample – Good Kernel (g)": "100" });

    // The approved moisture is recorded now: a third submission can't change it.
    const change = await send(id, { "n-qfs": { "Sample moisture (%)": "9" } });
    expect(change.statusCode).toBe(422);
    expect(change.json().error).toMatch(/Already recorded/);
  });

  it("stays closed after a rejection: the Warehouse Incharge corrects the data from there", async () => {
    const id = await truck();
    const sub = await send(id, { "n-qfs": { "Sample moisture (%)": "8" } });
    expect((await call("wi", "POST", `/api/submissions/${sub.json().id}/reject`, { reason: "Wrong truck" })).statusCode).toBe(200);
    const again = await send(id, { "n-qfs": { "Sample nut count": "200" } });
    expect(again.statusCode).toBe(422);
    expect(again.json().error).toMatch(/rejected and can't be resubmitted/);
  });
});
