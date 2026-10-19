/**
 * Client review, Oct 2026: dates fill themselves, the bin allocation date is stamped when the bin is finalised, and a
 * record locks once its GRN is complete. The properties that matter: the lock covers the reception record and NOT the
 * steps after the GRN; Admin alone reopens, with a reason; and nothing that already existed is locked behind anyone's back.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, setBranch, setStageFields, patchReceipt } from "../src/services/receipts.js";
import { LOCKED_MESSAGE } from "@anagroci/contract/domain/recordLock";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const A = "LOCK-A";
const GRN = "GRN Weight (kept separate from Gross/Net/Paid)";
const cookies: Record<string, string> = {};
const today = () => new Date().toISOString().slice(0, 10);

async function cleanup() {
  await prisma.receipt.deleteMany({ where: { warehouse: A } });
  await prisma.bin.deleteMany({ where: { code: { startsWith: "LOCK-BIN" } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "lock-" } } });
  await prisma.warehouse.deleteMany({ where: { name: A } });
}
async function login(key: string, role: string) {
  await prisma.user.create({ data: { username: `lock-${key}`, displayName: key, role, warehouse: role === "admin" ? null : A, passwordHash: hashPassword(PW) } });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `lock-${key}`, password: PW } });
  cookies[key] = String(res.headers["set-cookie"]).split(";")[0]!;
}
beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: A, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "LCK" } });
  await prisma.bin.create({ data: { code: "LOCK-BIN-1" } });
  await login("admin", "admin");
  await login("wi", "warehouse_incharge");
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

const call = (who: string, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined, headers: { cookie: cookies[who]!, ...(payload ? { "content-type": "application/json" } : {}) } });
const get = async (id: string) => (await call("wi", "GET", `/api/receipts/${id}`)).json();

/** A truck that has passed quality and been unloaded, with every weight in, so only the GRN is left. */
async function truckToGrn() {
  const r = await createReceipt(A, "2026-09-01");
  await setStageFields(r.id, "n-gate", { "VEHICLE NO.": "LOCK-1" });
  await setBranch(r.id, "n-qfs", "pass");
  return r.id;
}

describe("dates that fill themselves", () => {
  it("fills the gate's arrival date from the receipt's own, and the offloading date with today, on first save", async () => {
    const id = await truckToGrn();
    expect((await get(id)).stageData["n-gate"]["DATE OF ARRIVAL"]).toBe("2026-09-01"); // the arrival date the receipt was opened with, not today
    await setStageFields(id, "n-unload", { "BON SACS (good bags)": "100" });
    expect((await get(id)).stageData["n-unload"]["DATE OF OFFLOADING"]).toBe(today());
  });

  it("leaves a date the person typed, and one already stored, alone", async () => {
    const r = await createReceipt(A, "2026-09-01");
    await setStageFields(r.id, "n-gate", { "VEHICLE NO.": "LOCK-2", "DATE OF ARRIVAL": "2026-08-30" });
    await setStageFields(r.id, "n-gate", { "VEHICLE NO.": "LOCK-2B" });
    expect((await get(r.id)).stageData["n-gate"]["DATE OF ARRIVAL"]).toBe("2026-08-30");
  });
});

describe("bin finalised", () => {
  it("needs a Lot and a Bin first; then stamps today's date and who, once", async () => {
    const id = await truckToGrn();
    expect((await call("wi", "POST", `/api/receipts/${id}/bin/finalise`)).json().error).toMatch(/Bin first/);
    await setStageFields(id, "n-bin", { "Bin Number": "LOCK-BIN-1" });
    const res = await call("wi", "POST", `/api/receipts/${id}/bin/finalise`);
    expect(res.statusCode).toBe(200);
    expect(res.json().stageData["n-bin"]).toMatchObject({ "Bin allocation date": today(), "Finalised by": "wi" });
    const again = await call("wi", "POST", `/api/receipts/${id}/bin/finalise`);
    expect(again.statusCode).toBe(422);
    expect(again.json().error).toMatch(/already finalised/);
  });

  it("can't be changed after finalising, the date can't be typed, and an Admin reopens it with a reason", async () => {
    const [{ id }] = await prisma.receipt.findMany({ where: { warehouse: A, bin: { allocationDate: { not: null } } }, select: { id: true } });
    await expect(setStageFields(id, "n-bin", { "Bin Number": "LOCK-BIN-1", "Basis for allocation (moisture / quality / KOR / space)": "Space" })).rejects.toThrow(/finalised/);
    await expect(setStageFields(id, "n-bin", { "Bin allocation date": "2026-01-01" })).rejects.toThrow(/stamped when the allocation is finalised/);

    expect((await call("wi", "POST", `/api/receipts/${id}/reopen`, { reason: "x" })).statusCode).toBe(403);
    expect((await call("admin", "POST", `/api/receipts/${id}/reopen`, {})).statusCode).toBe(422);
    const ok = await call("admin", "POST", `/api/receipts/${id}/reopen`, { reason: "Wrong bin chosen" });
    expect(ok.json().stageData["n-bin"]["Bin allocation date"]).toBe("");
    expect(ok.json().timeline.at(-1).note).toMatch(/Reopened by admin: Wrong bin chosen/);
    await setStageFields(id, "n-bin", { "Basis for allocation (moisture / quality / KOR / space)": "Space" });
  });
});

describe("record locking", () => {
  it("locks when the GRN quantity and the price are both in, whichever comes first", async () => {
    const quantityFirst = await truckToGrn();
    await setStageFields(quantityFirst, "n-grn", { [GRN]: "30000" });
    expect((await get(quantityFirst)).lockedAt).toBeUndefined(); // the price is still to come, so the Branch Manager isn't shut out
    await setStageFields(quantityFirst, "n-grn", { PRICE: "470" }, { actor: { id: (await prisma.user.findFirstOrThrow({ where: { username: "lock-wi" } })).id, via: "approval" } });
    const locked = await get(quantityFirst);
    expect(locked.lockedAt).toBeTruthy();
    expect(locked.lockedBy).toBe("wi");
    expect(locked.timeline.at(-1).note).toMatch(/Record locked/);

    const priceFirst = await truckToGrn();
    await setStageFields(priceFirst, "n-grn", { PRICE: "470" });
    expect((await get(priceFirst)).lockedAt).toBeUndefined();
    await setStageFields(priceFirst, "n-grn", { [GRN]: "20000" });
    expect((await get(priceFirst)).lockedAt).toBeTruthy();
  });

  it("refuses changes to the locked record: its stages, its decision and its own columns", async () => {
    const [{ id }] = await prisma.receipt.findMany({ where: { warehouse: A, lockedAt: { not: null } }, select: { id: true } });
    await expect(setStageFields(id, "n-gate", { "VEHICLE NO.": "CHANGED" })).rejects.toThrow(LOCKED_MESSAGE);
    await expect(setStageFields(id, "n-grn", { PRICE: "999" })).rejects.toThrow(/locked/);
    await expect(setBranch(id, "n-qfs", "fail", "changed my mind")).rejects.toThrow(/locked/);
    await expect(patchReceipt(id, { supplierName: "Someone else" })).rejects.toThrow(/locked/);
    const http = await call("wi", "PATCH", `/api/receipts/${id}/stages/n-gate`, { fields: { "VEHICLE NO.": "CHANGED" } });
    expect(http.statusCode).toBe(422);
    expect(http.json().error).toBe(LOCKED_MESSAGE);
  });

  it("leaves the steps after the GRN open: stock, the drying decision, and other activities", async () => {
    const [{ id }] = await prisma.receipt.findMany({ where: { warehouse: A, lockedAt: { not: null } }, select: { id: true } });
    await setStageFields(id, "n-stock", { "Warehouse stock ledger entry": "Stock in" });
    await setBranch(id, "n-drying", "direct");
    expect((await get(id)).branches["n-drying"]).toBe("direct");
  });

  it("only an Admin can reopen it, with a reason; the reason stays on the timeline, and it locks again when the GRN is completed again", async () => {
    const [{ id }] = await prisma.receipt.findMany({ where: { warehouse: A, lockedAt: { not: null } }, select: { id: true } });
    expect((await call("wi", "POST", `/api/receipts/${id}/reopen`, { reason: "typo" })).statusCode).toBe(403);
    const res = await call("admin", "POST", `/api/receipts/${id}/reopen`, { reason: "Price typed wrong" });
    expect(res.statusCode).toBe(200);
    expect(res.json().lockedAt).toBeUndefined();
    expect(res.json().timeline.at(-1).note).toMatch(/Reopened by admin: Price typed wrong/);
    await setStageFields(id, "n-grn", { PRICE: "480" });
    expect((await get(id)).lockedAt).toBeTruthy();
    expect((await call("admin", "POST", `/api/receipts/${id}/reopen`, { reason: "again" })).statusCode).toBe(200);
  });

  it("does not lock a receipt that already had a complete GRN before locking existed", async () => {
    const r = await createReceipt(A, "2026-02-01");
    // As the seeder and importers write: no validation, no lock.
    await setStageFields(r.id, "n-grn", { PRICE: "470", [GRN]: "30000" }, { bypassValidation: true });
    expect((await get(r.id)).lockedAt).toBeUndefined();
    await setStageFields(r.id, "n-gate", { "VEHICLE NO.": "STILL-EDITABLE" });
  });
});
