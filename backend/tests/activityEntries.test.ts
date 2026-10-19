/**
 * Other warehouse activities recorded in the app: classified, tied to a Lot and a place, triage with its own checks, and the
 * workbook's imported rows left exactly as they were.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, setBranch, setStageFields } from "../src/services/receipts.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const A = "ACTV-A";
const OTHER = "ACTV-B";
const STORE1 = "ACTV-A-S1";
const STORE2 = "ACTV-A-S2";
const cookies: Record<string, string> = {};
let lot = "";

async function cleanup() {
  await prisma.warehouseActivityLedgerEntry.deleteMany({ where: { warehouse: { in: [A, OTHER] } } });
  await prisma.receipt.deleteMany({ where: { warehouse: { in: [A, OTHER] } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "actv-" } } });
  await prisma.warehouse.deleteMany({ where: { name: { in: [STORE1, STORE2] } } });
  await prisma.warehouse.deleteMany({ where: { name: { in: [A, OTHER] } } });
}
async function login(key: string, role: string, warehouse: string) {
  await prisma.user.create({ data: { username: `actv-${key}`, displayName: key, role, warehouse, passwordHash: hashPassword(PW) } });
  cookies[key] = String((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `actv-${key}`, password: PW } })).headers["set-cookie"]).split(";")[0]!;
}
beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: A, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "ACA" } });
  await prisma.warehouse.create({ data: { name: OTHER, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "ACB" } });
  await prisma.warehouse.createMany({ data: [{ name: STORE1, site: A }, { name: STORE2, site: A }] });
  await login("wi", "warehouse_incharge", A);
  await login("bm", "branch_manager", A);
  const r = await createReceipt(A, "2026-09-01");
  await setStageFields(r.id, "n-verify", { FICHE: "F-ACT-1" });
  lot = (await setBranch(r.id, "n-qfs", "pass")).lotNo!;
});
afterAll(async () => { await cleanup(); await prisma.$disconnect(); await app.close(); });

const post = (who: string, payload: unknown) => app.inject({ method: "POST", url: "/api/warehouse-activity-ledger", payload: payload as object, headers: { cookie: cookies[who]!, "content-type": "application/json" } });
const GOOD = { category: "stacking", lotNo: "", locationFrom: STORE1, bags: 120 };

describe("recording an activity", () => {
  it("is stored under its category, tied to the Lot (with its fiche) and the place, at the user's warehouse, dated today", async () => {
    const res = await post("wi", { ...GOOD, lotNo: lot });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      activityType: "Stacking", lotNo: lot, ficheNo: "F-ACT-1", particulars: STORE1, locationFrom: STORE1, warehouse: A, bags: "120", source: "entered",
      activityDateRaw: new Date().toISOString().slice(0, 10), moisturePct: null,
    });
    const listed = (await app.inject({ method: "GET", url: "/api/warehouse-activity-ledger", headers: { cookie: cookies.wi } })).json();
    expect(listed.some((e: { id: string }) => e.id === res.json().id)).toBe(true);
  });

  it("a movement records where it went from and to; triage records its moisture and quantity before and after", async () => {
    const move = await post("wi", { category: "movement", lotNo: lot, locationFrom: STORE1, locationTo: STORE2 });
    expect(move.json()).toMatchObject({ activityType: "Movement between locations", particulars: `${STORE1} → ${STORE2}`, locationTo: STORE2 });
    const triage = await post("wi", { category: "triage", lotNo: lot, locationFrom: STORE1, moisturePct: 9.5, quantityBeforeKg: 1000, quantityAfterKg: 940 });
    expect(triage.statusCode).toBe(201);
    expect([Number(triage.json().moisturePct), Number(triage.json().quantityBeforeKg), Number(triage.json().quantityAfterKg)]).toEqual([9.5, 1000, 940]);
  });

  it("refuses, with the reason: no kind, no Lot, triage without its checks, drying (it has its own form), an unknown Lot or place", async () => {
    const cases: [object, RegExp][] = [
      [{}, /Choose the kind of activity/],
      [{ category: "stacking", locationFrom: STORE1 }, /recorded against a Lot/],
      [{ category: "triage", lotNo: lot, locationFrom: STORE1 }, /Triage changes the moisture/],
      [{ category: "drying", lotNo: lot, locationFrom: STORE1 }, /recorded on the truck itself/],
      [{ ...GOOD, lotNo: "LOT-NOPE-2026-0001" }, /isn't a Lot at ACTV-A/],
      [{ ...GOOD, lotNo: lot, locationFrom: "NOWHERE" }, /isn't a store of ACTV-A or a Bin/],
      [{ ...GOOD, lotNo: lot, date: "30/09/2026" }, /real date/],
    ];
    for (const [body, message] of cases) {
      const res = await post("wi", body);
      expect(res.statusCode, JSON.stringify(body)).toBe(422);
      expect(res.json().error).toMatch(message);
    }
  });

  it("a Lot of another warehouse isn't accepted, and the Branch Manager can't record activities", async () => {
    const r = await createReceipt(OTHER, "2026-09-01");
    const foreign = (await setBranch(r.id, "n-qfs", "pass")).lotNo!;
    expect((await post("wi", { ...GOOD, lotNo: foreign })).json().error).toMatch(/isn't a Lot at ACTV-A/);
    expect((await post("bm", { ...GOOD, lotNo: lot })).statusCode).toBe(403);
  });

  it("leaves imported rows untouched: no warehouse, no place, no checks invented", async () => {
    const imported = await prisma.warehouseActivityLedgerEntry.create({ data: { activityType: "Staking", source: "workbook", sheetRow: 999001 } });
    expect(imported).toMatchObject({ warehouse: null, locationFrom: null, moisturePct: null, createdById: null });
    await prisma.warehouseActivityLedgerEntry.delete({ where: { id: imported.id } });
  });
});
