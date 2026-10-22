/**
 * Client review, Oct 2026: "Drying should have a Yes/No option. If Yes, a separate form opens to capture all drying details", then
 * "a Sun Drying phase with pre- and post-drying weights, quality checks, redrying support, and status tracking", keeping the QFS
 * sample separate. The properties that matter: No changes nothing about the truck; Yes issues round 1 and moves the truck to
 * "in drying"; a round goes in drying → quality check → passed or re-dry, and re-dry opens the next round from what came back;
 * losses and KOR are calculated; QFS is never touched; and only an accepted truck with a Lot, at the right warehouse, by the right role.
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

describe("answering Yes: sun drying in rounds", () => {
  let id: string;
  let round1: string;
  let round2: string;

  it("issues round 1 with its weight and its own quality before drying, answers the decision, and moves the truck to 'in drying'", async () => {
    id = await acceptedTruck();
    // A QFS reception sample exists; the drying form must not copy it (it is a separate measurement).
    await setStageFields(id, "n-qfs", { "MOIS. (moisture)": "13.4", KOR: "46.1" });
    const res = await call("wi", "POST", `/api/receipts/${id}/drying`, { ...START, inputNutCount: 182, inputGoodKernelG: 230, inputImmatureG: 13, inputSpottedG: 12, inputKor: 50 });
    expect(res.statusCode).toBe(201);
    const r = res.json();
    expect(r.status).toBe("in_drying");
    expect(r.branches["n-drying"]).toBe("direct");
    expect(r.timeline.at(-1).note).toMatch(/issued for sun drying \(round 1\): 10000 kg at 11.8% moisture/);
    expect(r.stageData["n-qfs"]).toMatchObject({ "MOIS. (moisture)": "13.4", KOR: "46.1" }); // QFS untouched

    const b = await prisma.dryingBatch.findFirstOrThrow({ where: { warehouseSite: A } });
    round1 = b.id;
    expect(b).toMatchObject({
      sn: 1, round: 1, firstBatchId: null, status: "IN DRYING", dryType: "SUN DRYING", source: "entered", sourceBinNo: "DRYF-BIN-1", issuedBags: 200,
      ficheNoRaw: "F-77", supplierCodeRaw: "LBA-DRYF", warehouse: "BKE-001", startedBy: "wi",
    });
    expect([Number(b.issuedNetWeightKg), Number(b.inputMoisturePct), Number(b.inputNutCount)]).toEqual([10000, 11.8, 182]);
    // KOR follows the cut test (the typed 50 is ignored once the grams are in), with the same formula as QFS.
    expect(Number(b.inputKor)).toBe(42.77);
    expect([Number(b.inputGoodKernelG), Number(b.inputImmatureG), Number(b.inputSpottedG)]).toEqual([230, 13, 12]);
    expect(b.dryingDateRaw).toBe(new Date().toISOString().slice(0, 10)); // the date fills itself
    const links = (await call("wi", "GET", `/api/receipts/${id}/links`)).json();
    expect(links.dryingBatches.find((x: { id: string }) => x.id === round1)).toMatchObject({ round: 1, status: "IN DRYING", inputGrams: { goodKernel: 230, immature: 13, spotted: 12, rejection: null } });
  });

  it("won't issue the same Lot again while a round is open, and won't check quality before the weight is back", async () => {
    const again = await call("wi", "POST", `/api/receipts/${id}/drying`, START);
    expect(again.statusCode).toBe(422);
    expect(again.json().error).toMatch(/already in drying/);
    const early = await call("wi", "POST", `/api/drying-batches/${round1}/check`, { decision: "pass", outputMoisture: 8 });
    expect(early.statusCode).toBe(422);
    expect(early.json().error).toMatch(/Record what came back/);
  });

  it("recording what came back works out the weight loss, refuses more back than went in, and waits for the quality check", async () => {
    const tooMuch = await call("wi", "POST", `/api/drying-batches/${round1}/return`, { receivedNetKg: 12000 });
    expect(tooMuch.statusCode).toBe(422);
    expect(tooMuch.json().error).toMatch(/can't be more than/);

    const ok = await call("wi", "POST", `/api/drying-batches/${round1}/return`, { receivedNetKg: 9300, receivedBags: 196, destinationBin: "DRYF-BIN-2" });
    expect(ok.statusCode).toBe(200);
    const b = await prisma.dryingBatch.findUniqueOrThrow({ where: { id: round1 } });
    expect(b).toMatchObject({ status: "QUALITY CHECK", receivedBags: 196, destinationBinNo: "DRYF-BIN-2", returnedBy: "wi" });
    expect([Number(b.dryingLossKg), Number(b.dryingLossPct)]).toEqual([700, 7]); // calculated, never typed

    const twice = await call("wi", "POST", `/api/drying-batches/${round1}/return`, { receivedNetKg: 9000 });
    expect(twice.statusCode).toBe(422);
    expect(twice.json().error).toMatch(/already recorded/);
  });

  it("a quality check that finds it still too wet opens round 2, issued with what came back and starting from that quality", async () => {
    const noMoisture = await call("wi", "POST", `/api/drying-batches/${round1}/check`, { decision: "redry" });
    expect(noMoisture.json().error).toMatch(/Moisture after drying is required/);
    const res = await call("wi", "POST", `/api/drying-batches/${round1}/check`, { decision: "redry", outputMoisture: 10.4, outputNutCount: 184, outputKor: 46.9 });
    expect(res.statusCode).toBe(200);
    const r1 = await prisma.dryingBatch.findUniqueOrThrow({ where: { id: round1 } });
    expect(r1).toMatchObject({ status: "RE-DRY", checkedBy: "wi" });
    expect([Number(r1.outputMoisturePct), Number(r1.outputKor), Number(r1.moistureLossPct)]).toEqual([10.4, 46.9, 1.4]);

    const r2 = await prisma.dryingBatch.findFirstOrThrow({ where: { firstBatchId: round1 } });
    round2 = r2.id;
    expect(r2).toMatchObject({ round: 2, status: "IN DRYING", issuedBags: 196, sourceBinNo: "DRYF-BIN-2", lotNo: r1.lotNo, source: "entered" });
    expect([Number(r2.issuedNetWeightKg), Number(r2.inputMoisturePct), Number(r2.inputKor), Number(r2.inputNutCount)]).toEqual([9300, 10.4, 46.9, 184]);
    expect((await receipt(id)).timeline.at(-1).note).toMatch(/round 1 needs re-drying .*round 2 issued with 9300 kg/);
  });

  it("round 2 passes; the drying is finished and the Lot can be dried again later as a new round 1", async () => {
    await call("wi", "POST", `/api/drying-batches/${round2}/return`, { receivedNetKg: 9150 });
    const pass = await call("wi", "POST", `/api/drying-batches/${round2}/check`, { decision: "pass", outputMoisture: 8.2, outputGoodKernelG: 240, outputImmatureG: 10, outputSpottedG: 8 });
    expect(pass.statusCode).toBe(200);
    expect(pass.json().next).toBeNull();
    const r2 = await prisma.dryingBatch.findUniqueOrThrow({ where: { id: round2 } });
    expect(r2.status).toBe("PASSED");
    expect(Number(r2.outputKor)).toBe(43.92); // (240 + ½ × 18) × 0.17637
    expect((await call("wi", "POST", `/api/drying-batches/${round2}/check`, { decision: "pass", outputMoisture: 8 })).json().error).toMatch(/already finished/);

    const again = await call("wi", "POST", `/api/receipts/${id}/drying`, { ...START, route: "indirect", inputMoisture: 12 });
    expect(again.statusCode).toBe(201);
    const rounds = await prisma.dryingBatch.findMany({ where: { warehouseSite: A }, orderBy: { sn: "asc" } });
    expect(rounds.map((b) => [b.sn, b.round, b.status])).toEqual([[1, 1, "RE-DRY"], [2, 2, "PASSED"], [3, 1, "IN DRYING"]]);
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
      [{ ...START, inputGoodKernelG: 700, inputShellG: 400 }, /more than the 1000 g sample/],
      [{ ...START, route: "none" }, /Choose how the Lot goes to drying/],
      [{ ...START, sourceBin: "NOPE-BIN" }, /isn't in the Bin master/],
      [{ ...START, date: "30/09/2026" }, /real date/],
    ];
    for (const [body, message] of cases) {
      const res = await call("wi", "POST", `/api/receipts/${id}/drying`, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(422);
      expect(res.json().error).toMatch(message);
    }
    expect(await prisma.dryingBatch.count({ where: { lotNo: { startsWith: "LOT-DRA" }, status: "IN DRYING", sn: { gt: 3 } } })).toBe(0);
  });

  it("the Branch Manager can't start drying, and another warehouse's incharge can't touch this truck or its batch", async () => {
    const id = await acceptedTruck();
    expect((await call("bm", "POST", `/api/receipts/${id}/drying`, START)).statusCode).toBe(403);
    expect((await call("wiOther", "POST", `/api/receipts/${id}/drying`, START)).statusCode).toBe(403);
    const batch = await prisma.dryingBatch.findFirstOrThrow({ where: { warehouseSite: A } });
    expect((await call("wiOther", "POST", `/api/drying-batches/${batch.id}/return`, { receivedNetKg: 1 })).statusCode).toBe(403);
    expect((await call("wiOther", "POST", `/api/drying-batches/${batch.id}/check`, { decision: "pass", outputMoisture: 8 })).statusCode).toBe(403);
    expect((await call("bm", "POST", `/api/drying-batches/${batch.id}/return`, { receivedNetKg: 1 })).statusCode).toBe(403);
  });
});
