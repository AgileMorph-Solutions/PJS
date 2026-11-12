/**
 * Production Phase 0 (client's "Phase 1 — Batch & Intake" doc): a batch is built from the factory's
 * procurement bins as they really stand, a bin can be in only one batch, and a batch moves no stock.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, setBranch, setStageFields } from "../src/services/receipts.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const SITE = "PBT-FACTORY";
const GRN = "GRN Weight (kept separate from Gross/Net/Paid)";
const cookies: Record<string, string> = {};

async function cleanup() {
  await prisma.rcnReceipt.deleteMany({ where: { batch: { warehouse: SITE } } });
  await prisma.productionBatch.deleteMany({ where: { warehouse: SITE } });
  await prisma.receipt.deleteMany({ where: { warehouse: SITE } });
  await prisma.bin.deleteMany({ where: { code: { startsWith: "PBT-" } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "pbt-" } } });
  await prisma.warehouse.deleteMany({ where: { name: SITE } });
}

async function login(key: string, role: string) {
  await prisma.user.create({ data: { username: `pbt-${key}`, displayName: key, role, warehouse: SITE, passwordHash: hashPassword(PW) } });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `pbt-${key}`, password: PW } });
  cookies[key] = String(res.headers["set-cookie"]).split(";")[0]!;
}

/** A truck whose procurement is finished: in `bin`, GRN weight and price recorded, no drying, staying here. */
async function lotInBin(bin: string, kg: string, opts: { price?: boolean; decided?: boolean } = {}) {
  const r = await createReceipt(SITE, "2026-06-01");
  await setBranch(r.id, "n-qfs", "pass");
  await setStageFields(r.id, "n-bin", { "Bin Number": bin }, { bypassValidation: true });
  await setStageFields(r.id, "n-grn", { [GRN]: kg, ...(opts.price === false ? {} : { PRICE: "470" }) }, { bypassValidation: true });
  if (opts.decided !== false) {
    await setBranch(r.id, "n-drying", "none");
    await setBranch(r.id, "n-xferdec", "production", undefined, { bypassValidation: opts.price === false });
  }
  return r.id;
}

beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: SITE, kind: "FACTORY", type: "CENTRAL", code: "PBT" } });
  for (const code of ["PBT-03B", "PBT-10", "PBT-EMPTY"]) await prisma.bin.create({ data: { code } });
  await lotInBin("PBT-03B", "2000000");
  await lotInBin("PBT-03B", "950400");
  await lotInBin("PBT-10", "878200");
  await lotInBin("PBT-10", "5000", { price: false }); // GRN not complete: not stock yet
  await lotInBin("PBT-10", "7000", { decided: false }); // GRN complete, drying/transfer unanswered: not ready yet
  await login("wi", "warehouse_incharge");
  await login("qfs", "qfs_officer");
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

const call = (who: string, method: "GET" | "POST", url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined, headers: { cookie: cookies[who]!, ...(payload ? { "content-type": "application/json" } : {}) } });

describe("New batch: bins and their stock come from procurement", () => {
  it("offers the factory's bins with the GRN weight of their completed Lots", async () => {
    const res = await call("wi", "GET", "/api/production/batch-bins");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { binCode: "PBT-03B", store: null, kg: 2_950_400, lotCount: 2, lotsWithoutKg: 0, lotsKept: 0, inBatch: null, inMaster: true },
      { binCode: "PBT-10", store: null, kg: 878_200, lotCount: 1, lotsWithoutKg: 0, lotsKept: 0, inBatch: null, inMaster: true },
    ]);
  });

  it("creates the batch as Open, with each bin's planned kg as it stood, and the plan worked out", async () => {
    const res = await call("wi", "POST", "/api/production/batches", { code: " pbt-ana-03b ", startDate: "2026-07-19", proposedBy: "Deepak", bins: ["PBT-03B", "PBT-10"] });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      code: expect.stringMatching(/^PR-PBT-2026-\d{3}$/), name: "PBT-ANA-03B", status: "open", plannedKg: 3_828_600, days: 26, endDate: "2026-08-14", proposedBy: "Deepak", createdBy: "wi",
    });
    expect(res.json().bins.map((b: { binCode: string; plannedKg: number; lots: unknown[] }) => [b.binCode, b.plannedKg, b.lots.length])).toEqual([
      ["PBT-03B", 2_950_400, 2],
      ["PBT-10", 878_200, 1],
    ]);
    // A plan moves nothing: the bins still hold the same stock, now shown as taken.
    const bins = (await call("wi", "GET", "/api/production/batch-bins")).json();
    expect(bins.map((b: { binCode: string; kg: number; inBatch: string }) => [b.binCode, b.kg, b.inBatch])).toEqual([
      ["PBT-03B", 2_950_400, res.json().code],
      ["PBT-10", 878_200, res.json().code],
    ]);
  });

  it("refuses a bin already in a batch, a bin with no stock, an unknown bin, a reused name, and missing fields — and says why", async () => {
    const cases: [object, RegExp][] = [
      [{ code: "PBT-B", startDate: "2026-08-20", bins: ["PBT-10"] }, /PBT-10 is already in production run PR-PBT-2026-\d{3} \(PBT-ANA-03B\)/],
      [{ code: "PBT-B", startDate: "2026-08-20", bins: ["PBT-EMPTY"] }, /No procurement stock in PBT-EMPTY/],
      [{ code: "PBT-B", startDate: "2026-08-20", bins: ["PBT-NOPE"] }, /Not in Masters › Bins: PBT-NOPE/],
      [{ code: "PBT-ANA-03B", startDate: "2026-08-20", bins: ["PBT-EMPTY"] }, /No procurement stock/],
      [{ code: "PR-PBT-2026-009", startDate: "2026-08-20", bins: ["PBT-03B"] }, /looks like a production run ID/],
      // No name: the run gets a system ID, and is then refused for the bin like any other.
      [{ code: "", startDate: "2026-08-20", bins: ["PBT-03B"] }, /PBT-03B is already in production run/],
      [{ code: "PBT B", startDate: "2026-08-20", bins: ["PBT-03B"] }, /letters, digits/],
      [{ code: "PBT-B", startDate: "", bins: ["PBT-03B"] }, /start date/],
      [{ code: "PBT-B", startDate: "2026-08-20", bins: [] }, /at least one/],
    ];
    for (const [body, message] of cases) {
      const res = await call("wi", "POST", "/api/production/batches", body);
      expect(res.statusCode, JSON.stringify(body)).toBe(422);
      expect(res.json().error).toMatch(message);
    }
    expect(await prisma.productionBatch.count({ where: { warehouse: SITE } })).toBe(1);
  });

  it("issues a run started without a name its own system ID, so nobody has to invent one", async () => {
    await prisma.bin.create({ data: { code: "PBT-20" } });
    await lotInBin("PBT-20", "4000");
    const res = await call("wi", "POST", "/api/production/batches", { startDate: "2026-08-20", bins: ["PBT-20"] });
    expect(res.statusCode, res.body).toBe(201);
    // The next free number for the factory and year, and no name: the ID is what everyone uses.
    expect(res.json()).toMatchObject({ code: expect.stringMatching(/^PR-PBT-2026-\d{3}$/), name: null });
    expect(res.json().code).not.toBe((await call("wi", "GET", "/api/production/batches/PBT-ANA-03B")).json().code);
  });

  it("starts a run with the loads already brought from its bins, in one save — or with none of it if a load is wrong", async () => {
    for (const code of ["PBT-30", "PBT-31"]) {
      await prisma.bin.create({ data: { code } });
      await lotInBin(code, "6000");
    }
    const runs = async () => prisma.productionBatch.count({ where: { warehouse: SITE } });
    const before = await runs();

    // A load from a bin the run doesn't take: the run isn't created either, and the message names the row.
    const bad = await call("wi", "POST", "/api/production/batches", {
      startDate: "2026-08-21", bins: ["PBT-30", "PBT-31"],
      loads: [{ date: "2026-08-21", btmNo: "301", binCode: "PBT-30" }, { date: "2026-08-21", btmNo: "302", binCode: "PBT-03B" }],
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error).toMatch(/^Load 2: PBT-03B is not in production run/);
    expect(await runs()).toBe(before);

    // Two loads and a row left blank: the blank one is ignored.
    const ok = await call("wi", "POST", "/api/production/batches", {
      startDate: "2026-08-21", bins: ["PBT-30", "PBT-31"],
      loads: [{ date: "2026-08-21", btmNo: "301", binCode: "PBT-30" }, { date: "", btmNo: "", binCode: "" }, { date: "2026-08-22", btmNo: "302", binCode: "PBT-31" }],
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().status).toBe("in_process");
    const loads = await prisma.rcnReceipt.findMany({ where: { batchCode: ok.json().code }, orderBy: { id: "asc" } });
    expect(loads.map((l) => [l.btmNo, l.binCode, l.date])).toEqual([["301", "PBT-30", "2026-08-21"], ["302", "PBT-31", "2026-08-22"]]);
    expect(loads.every((l) => /^RR-PBT-2026-\d{4}$/.test(l.id))).toBe(true);
  });

  it("is the Warehouse Incharge's to do: a QFS Officer reads batches (for the moisture check) but can't create one", async () => {
    expect((await call("qfs", "GET", "/api/production/batches")).statusCode).toBe(200);
    expect((await call("qfs", "GET", "/api/production/batch-bins")).statusCode).toBe(403);
    expect((await call("qfs", "POST", "/api/production/batches", { code: "X", startDate: "2026-07-19", bins: ["PBT-03B"] })).statusCode).toBe(403);
  });
});
