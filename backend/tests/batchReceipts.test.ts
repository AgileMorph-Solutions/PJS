/**
 * Batch entry ("several trucks at once"). The property that matters is all-or-nothing: a bad row
 * must leave NO receipts behind, otherwise the Warehouse Incharge fixes row 7 and resubmits, and
 * rows 1-6 exist twice.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { BATCH_MAX_ROWS } from "@anagroci/contract/data/batchEntry";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const P = "batchtest-";
const VEHICLE = "BATCHTEST-";
const cookies: Record<string, string> = {};

async function mkUser(key: string, role: string, warehouse: string | null) {
  const u = await prisma.user.create({
    data: { username: P + key, displayName: key, role, warehouse, passwordHash: hashPassword(PW) },
  });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: u.username, password: PW } });
  cookies[key] = String(res.headers["set-cookie"]).split(";")[0];
  return u;
}
const post = (who: string, payload: unknown) =>
  app.inject({ method: "POST", url: "/api/receipts/batch", payload: payload as any, headers: { cookie: cookies[who] } });
const truck = (n: number, extra: Record<string, Record<string, string>> = {}) => ({
  "n-gate": { "DATE OF ARRIVAL": "2026-09-30", "VEHICLE NO.": `${VEHICLE}${n}`, "CREDIT/CASH": "CASH" },
  "n-verify": { "SUPPLIERS NAME": "Batch Supplier", "LBA CODE": "LBA-BATCH", FICHE: `F-${n}` },
  ...extra,
});
const batchReceipts = () => prisma.receipt.findMany({ where: { vehicleNo: { startsWith: VEHICLE } }, orderBy: { id: "asc" } });

async function cleanup() {
  await prisma.receipt.deleteMany({ where: { vehicleNo: { startsWith: VEHICLE } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: P } } });
}

let wiId: string;
beforeAll(async () => {
  await cleanup();
  wiId = (await mkUser("wi", "warehouse_incharge", "BOUAKE")).id;
  await mkUser("wiY", "warehouse_incharge", "YAKRO FACTORY");
  await mkUser("bm", "branch_manager", "BOUAKE");
  await mkUser("admin", "admin", null);
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

describe("POST /api/receipts/batch", () => {
  it("opens every row as a receipt at the incharge's warehouse, with the gate data on each", async () => {
    const res = await post("wi", { rows: [truck(1), truck(2), truck(3)] });
    expect(res.statusCode).toBe(201);
    const { ids } = res.json();
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);

    const rows = await batchReceipts();
    expect(rows.map((r) => r.id)).toEqual([...ids].sort());
    expect(rows.every((r) => r.warehouse === "BOUAKE" && r.source === "entered" && r.arrivalDate === "2026-09-30")).toBe(true);
    expect(rows[0]).toMatchObject({ supplierName: "Batch Supplier", lbaCode: "LBA-BATCH", vehicleNo: `${VEHICLE}1` });

    // Reads back exactly like a wizard-entered receipt: stage data present, status derived.
    const one = (await app.inject({ method: "GET", url: `/api/receipts/${ids[0]}`, headers: { cookie: cookies.wi } })).json();
    expect(one.stageData["n-gate"]).toMatchObject({ "VEHICLE NO.": `${VEHICLE}1`, "CREDIT/CASH": "CASH" });
    expect(one.stageData["n-verify"]).toMatchObject({ FICHE: "F-1", "LBA CODE": "LBA-BATCH" });
    expect(one.status).toBe("pending_qa");
    expect(one.timeline[0]).toMatchObject({ status: "planned" });
  });

  it("audits the fields and attributes the receipt to the incharge", async () => {
    const [first] = await batchReceipts();
    const changes = await prisma.stageFieldChange.findMany({ where: { receiptId: first.id } });
    expect(changes.length).toBeGreaterThanOrEqual(6);
    expect(changes.every((c) => c.via === "direct" && c.userId === wiId)).toBe(true);
    expect((await prisma.timelineEntry.findFirst({ where: { receiptId: first.id } }))!.actorId).toBe(wiId);
  });

  it("skips a row's optional stage: a gate-only truck has no supplier documents yet", async () => {
    const res = await post("wi", { rows: [{ "n-gate": { "VEHICLE NO.": `${VEHICLE}GATEONLY` } }] });
    expect(res.statusCode).toBe(201);
    const r = (await app.inject({ method: "GET", url: `/api/receipts/${res.json().ids[0]}`, headers: { cookie: cookies.wi } })).json();
    expect(r.stageData["n-verify"]).toBeUndefined();
    expect(r.status).toBe("arrived");
    expect(r.arrivalDate).toBe(new Date().toISOString().slice(0, 10)); // defaults to today
  });

  it("is all-or-nothing: one bad row creates none of them", async () => {
    const before = (await batchReceipts()).length;
    const res = await post("wi", { rows: [truck(10), truck(11), { "n-gate": { "CREDIT/CASH": "CASH" } }, truck(13)] });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/Row 3: VEHICLE NO\. is required/);
    expect((await batchReceipts()).length).toBe(before);
  });

  it("rejects a bad date, a column outside the grid, and an empty or oversized batch", async () => {
    const before = (await batchReceipts()).length;
    const badDate = await post("wi", { rows: [truck(20, { "n-gate": { "VEHICLE NO.": `${VEHICLE}20`, "DATE OF ARRIVAL": "30/09/2026" } })] });
    expect(badDate.statusCode).toBe(422);
    expect(badDate.json().error).toMatch(/Row 1: DATE OF ARRIVAL/);
    const notReal = await post("wi", { rows: [truck(21, { "n-gate": { "VEHICLE NO.": `${VEHICLE}21`, "DATE OF ARRIVAL": "2026-02-31" } })] });
    expect(notReal.statusCode).toBe(422);
    const outside = await post("wi", { rows: [{ "n-gross": { "GROSS WT KGS": "1" }, "n-gate": { "VEHICLE NO.": `${VEHICLE}22` } }] });
    expect(outside.statusCode).toBe(422);
    expect((await post("wi", { rows: [] })).statusCode).toBe(422);
    const many = Array.from({ length: BATCH_MAX_ROWS + 1 }, (_, i) => truck(1000 + i));
    expect((await post("wi", { rows: many })).statusCode).toBe(422);
    expect((await batchReceipts()).length).toBe(before);
  });

  it("keeps other roles and warehouses out", async () => {
    const before = (await batchReceipts()).length;
    expect((await post("bm", { rows: [truck(30)] })).statusCode).toBe(403);
    // A Warehouse Incharge is pinned to their own warehouse, whatever the body says.
    expect((await post("wi", { warehouse: "YAKRO FACTORY", rows: [truck(31)] })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/receipts/batch", payload: { rows: [truck(32)] } })).statusCode).toBe(401);
    expect((await batchReceipts()).length).toBe(before);
  });

  it("lets an admin name the warehouse, and requires one", async () => {
    expect((await post("admin", { rows: [truck(40)] })).statusCode).toBe(400);
    expect((await post("admin", { warehouse: "NO SUCH SITE", rows: [truck(41)] })).statusCode).toBe(422);
    const ok = await post("admin", { warehouse: "YAKRO FACTORY", rows: [truck(42)] });
    expect(ok.statusCode).toBe(201);
    expect((await prisma.receipt.findUnique({ where: { id: ok.json().ids[0] } }))!.warehouse).toBe("YAKRO FACTORY");
  });

  it("numbers receipts continuously across batches", async () => {
    const a = (await post("wi", { rows: [truck(50), truck(51)] })).json().ids as string[];
    const b = (await post("wi", { rows: [truck(52)] })).json().ids as string[];
    const n = (id: string) => Number(id.split("-")[2]);
    expect(n(a[1])).toBe(n(a[0]) + 1);
    expect(n(b[0])).toBe(n(a[1]) + 1);
  });
});
