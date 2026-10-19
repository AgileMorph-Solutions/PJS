/**
 * Client review, Oct 2026: "Drying should have a Yes/No option. If Yes, a separate form opens to capture all drying details."
 * The properties that matter: No changes nothing about the truck; Yes creates one real drying batch and moves the truck to
 * "in drying"; the loss figures are calculated; and only an accepted truck with a Lot, at the right warehouse, by the right role.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, setBranch, setStageFields } from "../src/services/receipts.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const A = "DRYF-A";
const OTHER = "DRYF-B";
const cookies: Record<string, string> = {};

async function cleanup() {
  await prisma.dryingBatch.deleteMany({ where: { warehouseSite: { in: [A, OTHER] } } });
  await prisma.receipt.deleteMany({ where: { warehouse: { in: [A, OTHER] } } });
  await prisma.bin.deleteMany({ where: { code: { startsWith: "DRYF-BIN" } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "dryf-" } } });
  await prisma.warehouse.deleteMany({ where: { name: { in: [A, OTHER] } } });
}
async function login(key: string, role: string, warehouse: string) {
  await prisma.user.create({ data: { username: `dryf-${key}`, displayName: key, role, warehouse, passwordHash: hashPassword(PW) } });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `dryf-${key}`, password: PW } });
  cookies[key] = String(res.headers["set-cookie"]).split(";")[0]!;
}
beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: A, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "DRA" } });
  await prisma.warehouse.create({ data: { name: OTHER, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "DRB" } });
  await prisma.bin.createMany({ data: [{ code: "DRYF-BIN-1" }, { code: "DRYF-BIN-2" }] });
  await login("wi", "warehouse_incharge", A);
  await login("wiOther", "warehouse_incharge", OTHER);
  await login("bm", "branch_manager", A);
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

const call = (who: string, method: "GET" | "POST", url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined, headers: { cookie: cookies[who]!, ...(payload ? { "content-type": "application/json" } : {}) } });
const receipt = async (id: string) => (await call("wi", "GET", `/api/receipts/${id}`)).json();

/** An accepted truck with a Lot (quality passed). */
async function acceptedTruck(warehouse = A) {
  const r = await createReceipt(warehouse, "2026-09-01");
  await setStageFields(r.id, "n-gate", { "VEHICLE NO.": "DRYF-1", "WH NO.": "BKE-001" });
  await setStageFields(r.id, "n-verify", { "LBA CODE": "LBA-DRYF", FICHE: "F-77" });
  await setBranch(r.id, "n-qfs", "pass");
  return r.id;
}
const START = { route: "direct", dryType: "SUN DRYING", issuedNetKg: 10000, issuedBags: 200, inputMoisture: 11.8, sourceBin: "DRYF-BIN-1" };

describe("answering No", () => {
  it("is just a recorded decision: no drying step, no batch, the truck's status unchanged", async () => {
    const id = await acceptedTruck();
    const before = (await receipt(id)).status;
    const res = await call("wi", "POST", `/api/receipts/${id}/branch`, { stageId: "n-drying", branchId: "none" });
    expect(res.statusCode).toBe(200);
    const after = await receipt(id);
    expect(after.branches["n-drying"]).toBe("none");
    expect(after.status).toBe(before);
    expect(after.stageData["n-drying"]).toBeUndefined();
    expect(await prisma.dryingBatch.count({ where: { warehouseSite: A } })).toBe(0);
  });
});

describe("answering Yes: the drying form", () => {
  let id: string;
  let batchId: string;

  it("creates one drying batch with what is issued, answers the decision, and moves the truck to 'in drying'", async () => {
    id = await acceptedTruck();
    const res = await call("wi", "POST", `/api/receipts/${id}/drying`, START);
    expect(res.statusCode).toBe(201);
    const r = res.json();
    expect(r.status).toBe("in_drying");
    expect(r.branches["n-drying"]).toBe("direct");
    expect(r.timeline.at(-1).note).toMatch(/issued for drying: 10000 kg/);

    const b = await prisma.dryingBatch.findFirstOrThrow({ where: { warehouseSite: A } });
    batchId = b.id;
    expect(b).toMatchObject({
      sn: 1, status: "IN PROGRESS", dryType: "SUN DRYING", source: "entered", sourceBinNo: "DRYF-BIN-1", issuedBags: 200,
      ficheNoRaw: "F-77", supplierCodeRaw: "LBA-DRYF", warehouse: "BKE-001",
    });
    expect(Number(b.issuedNetWeightKg)).toBe(10000);
    expect(Number(b.inputMoisturePct)).toBe(11.8);
    expect(b.lotNo).toMatch(/^LOT-DRA-/);
    expect(b.dryingDateRaw).toBe(new Date().toISOString().slice(0, 10)); // the date fills itself
    // It shows on the truck by the Lot it shares, like every other drying row.
    const links = (await call("wi", "GET", `/api/receipts/${id}/links`)).json();
    expect(links.dryingBatches.map((x: { id: string }) => x.id)).toContain(batchId);
  });

  it("won't issue the same Lot twice while it is still drying", async () => {
    const again = await call("wi", "POST", `/api/receipts/${id}/drying`, START);
    expect(again.statusCode).toBe(422);
    expect(again.json().error).toMatch(/already in drying/);
  });

  it("completing it works out the loss itself, refuses more back than went in, and closes the batch", async () => {
    const tooMuch = await call("wi", "POST", `/api/drying-batches/${batchId}/complete`, { receivedNetKg: 12000, outputMoisture: 8.6 });
    expect(tooMuch.statusCode).toBe(422);
    expect(tooMuch.json().error).toMatch(/can't be more than/);

    const ok = await call("wi", "POST", `/api/drying-batches/${batchId}/complete`, { receivedNetKg: 9300, receivedBags: 196, outputMoisture: 8.6, destinationBin: "DRYF-BIN-2" });
    expect(ok.statusCode).toBe(200);
    const b = await prisma.dryingBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(b).toMatchObject({ status: "COMPLETED", receivedBags: 196, destinationBinNo: "DRYF-BIN-2" });
    expect([Number(b.dryingLossKg), Number(b.dryingLossPct), Number(b.moistureLossPct)]).toEqual([700, 7, 3.2]); // calculated, never typed

    const twice = await call("wi", "POST", `/api/drying-batches/${batchId}/complete`, { receivedNetKg: 9000, outputMoisture: 8 });
    expect(twice.statusCode).toBe(422);
    expect(twice.json().error).toMatch(/already completed/);
  });

  it("once completed, the Lot can be dried again, as batch 2", async () => {
    const res = await call("wi", "POST", `/api/receipts/${id}/drying`, { ...START, route: "indirect" });
    expect(res.statusCode).toBe(201);
    expect((await prisma.dryingBatch.findMany({ where: { warehouseSite: A }, orderBy: { sn: "asc" } })).map((b) => b.sn)).toEqual([1, 2]);
    expect((await receipt(id)).branches["n-drying"]).toBe("indirect");
  });
});

describe("what the form refuses", () => {
  it("a truck that isn't accepted or has no Lot, and a missing or impossible field, each with a plain reason", async () => {
    const rejected = await createReceipt(A, "2026-09-01");
    await setStageFields(rejected.id, "n-gate", { "VEHICLE NO.": "DRYF-R" });
    await setBranch(rejected.id, "n-qfs", "fail", "Moisture too high");
    expect((await call("wi", "POST", `/api/receipts/${rejected.id}/drying`, START)).json().error).toMatch(/accepted truck that has a Lot/);

    const id = await acceptedTruck();
    const cases: [object, RegExp][] = [
      [{ ...START, dryType: "" }, /Drying type is required/],
      [{ ...START, issuedNetKg: "" }, /Net kg issued for drying is required/],
      [{ ...START, inputMoisture: 140 }, /Moisture before drying must be a number between 0 and 100/],
      [{ ...START, inputMoisture: "" }, /Moisture before drying is required/],
      [{ ...START, route: "none" }, /Choose how the Lot goes to drying/],
      [{ ...START, sourceBin: "NOPE-BIN" }, /isn't in the Bin master/],
      [{ ...START, date: "30/09/2026" }, /real date/],
    ];
    for (const [body, message] of cases) {
      const res = await call("wi", "POST", `/api/receipts/${id}/drying`, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(422);
      expect(res.json().error).toMatch(message);
    }
    expect(await prisma.dryingBatch.count({ where: { lotNo: { startsWith: "LOT-DRA" }, status: "IN PROGRESS", sn: { gt: 2 } } })).toBe(0);
  });

  it("the Branch Manager can't start drying, and another warehouse's incharge can't touch this truck or its batch", async () => {
    const id = await acceptedTruck();
    expect((await call("bm", "POST", `/api/receipts/${id}/drying`, START)).statusCode).toBe(403);
    expect((await call("wiOther", "POST", `/api/receipts/${id}/drying`, START)).statusCode).toBe(403);
    const batch = await prisma.dryingBatch.findFirstOrThrow({ where: { warehouseSite: A } });
    expect((await call("wiOther", "POST", `/api/drying-batches/${batch.id}/complete`, { receivedNetKg: 1, outputMoisture: 8 })).statusCode).toBe(403);
  });
});
