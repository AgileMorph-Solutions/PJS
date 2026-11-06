/**
 * Production Phase 1, step 1 (client's "Phase 1 — Batch & Intake" doc): a load is received from one bin of
 * its batch, gets an RR- ID, puts the batch In process, and — having no weight yet — moves no stock.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, setBranch, setStageFields } from "../src/services/receipts.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const SITE = "RRT-FACTORY";
const GRN = "GRN Weight (kept separate from Gross/Net/Paid)";
const cookies: Record<string, string> = {};

async function cleanup() {
  await prisma.rcnPallet.deleteMany({ where: { rcnReceipt: { batch: { warehouse: SITE } } } });
  await prisma.rcnEmptyPalletStack.deleteMany({ where: { rcnReceipt: { batch: { warehouse: SITE } } } });
  await prisma.rcnMoistureCheck.deleteMany({ where: { rcnReceipt: { batch: { warehouse: SITE } } } });
  await prisma.rcnReceipt.deleteMany({ where: { batch: { warehouse: SITE } } });
  await prisma.productionBatch.deleteMany({ where: { warehouse: SITE } });
  await prisma.receipt.deleteMany({ where: { warehouse: SITE } });
  await prisma.bin.deleteMany({ where: { code: { startsWith: "RRT-" } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "rrt-" } } });
  await prisma.warehouse.deleteMany({ where: { name: SITE } });
}

async function login(key: string, role: string) {
  await prisma.user.create({ data: { username: `rrt-${key}`, displayName: key, role, warehouse: SITE, passwordHash: hashPassword(PW) } });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `rrt-${key}`, password: PW } });
  cookies[key] = String(res.headers["set-cookie"]).split(";")[0]!;
}

async function lotInBin(bin: string, kg: string) {
  const r = await createReceipt(SITE, "2026-06-01");
  await setBranch(r.id, "n-qfs", "pass");
  await setStageFields(r.id, "n-bin", { "Bin Number": bin }, { bypassValidation: true });
  await setStageFields(r.id, "n-grn", { [GRN]: kg, PRICE: "470" }, { bypassValidation: true });
  await setBranch(r.id, "n-drying", "none");
  await setBranch(r.id, "n-xferdec", "production");
}

const call = (who: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined, headers: { cookie: cookies[who]!, ...(payload ? { "content-type": "application/json" } : {}) } });

beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: SITE, kind: "FACTORY", type: "CENTRAL", code: "RRT" } });
  for (const code of ["RRT-03B", "RRT-10", "RRT-11"]) await prisma.bin.create({ data: { code } });
  await lotInBin("RRT-03B", "2950400");
  await lotInBin("RRT-10", "878200");
  await lotInBin("RRT-11", "640000");
  await login("wi", "warehouse_incharge");
  await login("qfs", "qfs_officer");
  const batch = await call("wi", "POST", "/api/production/batches", { code: "RRT-ANA-03B", startDate: "2026-07-19", bins: ["RRT-03B", "RRT-10"] });
  expect(batch.statusCode).toBe(201);
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

describe("RCN Receipt: a load arrives from one bin of the batch", () => {
  it("issues RR-<code>-<year>-0001, waits for moisture, and puts the batch In process", async () => {
    expect((await call("wi", "GET", "/api/production/batches/RRT-ANA-03B")).json().status).toBe("open");

    const res = await call("wi", "POST", "/api/production/rcn-receipts", { batchCode: "rrt-ana-03b", date: "2026-07-19", btmNo: " 108 ", binCode: "rrt-03b" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: "RR-RRT-2026-0001", batchCode: "RRT-ANA-03B", date: "2026-07-19", btmNo: "108", binCode: "RRT-03B", status: "waiting_for_moisture", createdBy: "wi" });

    const batch = (await call("wi", "GET", "/api/production/batches/RRT-ANA-03B")).json();
    expect(batch.status).toBe("in_process");
    expect(batch.history[0].text).toBe("First RCN Receipt, BTM 108 from RRT-03B: batch In process");
  });

  it("moves no stock: with no weight recorded yet, the bins hold what they held", async () => {
    const batch = (await call("wi", "GET", "/api/production/batches/RRT-ANA-03B")).json();
    expect(batch.bins.map((b: { binCode: string; currentKg: number }) => [b.binCode, b.currentKg])).toEqual([["RRT-03B", 2_950_400], ["RRT-10", 878_200]]);
  });

  it("accepts the same BTM from the same bin again (the doc makes that a warning, not a refusal)", async () => {
    const res = await call("wi", "POST", "/api/production/rcn-receipts", { batchCode: "RRT-ANA-03B", date: "2026-07-20", btmNo: "108", binCode: "RRT-03B" });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe("RR-RRT-2026-0002");
  });

  it("refuses a bin outside the batch, an unknown batch, and missing fields — and says why", async () => {
    const ok = { batchCode: "RRT-ANA-03B", date: "2026-07-21", btmNo: "110", binCode: "RRT-10" };
    const cases: [object, RegExp][] = [
      [{ ...ok, binCode: "RRT-11" }, /RRT-11 is not in batch RRT-ANA-03B/],
      [{ ...ok, batchCode: "RRT-NOPE" }, /Batch RRT-NOPE doesn't exist/],
      [{ ...ok, batchCode: "" }, /Choose the batch/],
      [{ ...ok, date: "21/07/2026" }, /date is required/],
      [{ ...ok, btmNo: " " }, /BTM number/],
      [{ ...ok, binCode: "" }, /warehouse bin/],
    ];
    for (const [body, message] of cases) {
      const res = await call("wi", "POST", "/api/production/rcn-receipts", body);
      expect(res.statusCode, JSON.stringify(body)).toBe(422);
      expect(res.json().error).toMatch(message);
    }
    expect(await prisma.rcnReceipt.count({ where: { batchCode: "RRT-ANA-03B" } })).toBe(2);
  });

  it("lists the batch's receipts, newest first", async () => {
    const res = await call("wi", "GET", "/api/production/rcn-receipts?batch=RRT-ANA-03B");
    expect(res.json().map((r: { id: string }) => r.id)).toEqual(["RR-RRT-2026-0002", "RR-RRT-2026-0001"]);
  });

  it("is read-only to a QFS Officer: they can see loads, not create them", async () => {
    expect((await call("qfs", "GET", "/api/production/rcn-receipts")).statusCode).toBe(200);
    expect((await call("qfs", "POST", "/api/production/rcn-receipts", { batchCode: "RRT-ANA-03B", date: "2026-07-21", btmNo: "111", binCode: "RRT-10" })).statusCode).toBe(403);
  });
});

describe("Moisture check (Phase 1, step 2)", () => {
  // The client's "2. Input RCN Quality report", BTM 1001: KOR (lbs) 42.76924 in their file.
  const btm1001 = { moisture: "9.8", nutCount: "180", sampleG: "1000", gkG: "230", spotG: "12", immatureG: "13", oilG: "5", rejectionG: "32", voidsG: "25", shellG: "664", fruitWasteG: "19" };
  const status = async (id: string) =>
    (await call("wi", "GET", "/api/production/rcn-receipts?batch=RRT-ANA-03B")).json().find((r: { id: string }) => r.id === id).status;

  it("a QFS Officer's check waits for the Incharge, and the receipt doesn't move until approved", async () => {
    const res = await call("qfs", "POST", "/api/production/rcn-receipts/RR-RRT-2026-0001/moisture-checks", { ...btm1001, decision: "ok" });
    expect(res.statusCode).toBe(201);
    const check = res.json().moistureChecks[0];
    expect(res.json().status).toBe("moisture_pending");
    expect(check).toMatchObject({ status: "submitted", moisture: "9.8", grams: { gkG: "230", shellG: "664" }, submittedBy: "qfs" });
    expect(check.kor).toBeCloseTo(42.76924, 8);

    // A second check while one waits is refused, and the QFS Officer can't approve their own.
    expect((await call("wi", "POST", "/api/production/rcn-receipts/RR-RRT-2026-0001/moisture-checks", { ...btm1001, decision: "ok" })).statusCode).toBe(422);
    expect((await call("qfs", "POST", `/api/production/moisture-checks/${check.id}/approve`)).statusCode).toBe(403);

    const approved = await call("wi", "POST", `/api/production/moisture-checks/${check.id}/approve`);
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: "waiting_for_weighing", moistureChecks: [{ status: "approved", reviewedBy: "wi" }] });

    // Weighing is next: no further moisture check is due.
    expect((await call("qfs", "POST", "/api/production/rcn-receipts/RR-RRT-2026-0001/moisture-checks", { ...btm1001, decision: "ok" })).statusCode).toBe(422);
  });

  it("a rejected check applies nothing and needs a reason; Fail puts the load on hold until re-checked", async () => {
    const id = "RR-RRT-2026-0002";
    const sub = (await call("qfs", "POST", `/api/production/rcn-receipts/${id}/moisture-checks`, { moisture: "12.5", nutCount: "176", decision: "hold" })).json();
    const checkId = sub.moistureChecks[0].id;
    expect((await call("wi", "POST", `/api/production/moisture-checks/${checkId}/reject`, { reason: " " })).statusCode).toBe(422);
    const rejected = await call("wi", "POST", `/api/production/moisture-checks/${checkId}/reject`, { reason: "Wrong BTM" });
    expect(rejected.json()).toMatchObject({ status: "waiting_for_moisture", moistureChecks: [{ status: "rejected", rejectReason: "Wrong BTM" }] });

    // The Incharge's own entry applies at once — no approval.
    const held = await call("wi", "POST", `/api/production/rcn-receipts/${id}/moisture-checks`, { moisture: "12.5", nutCount: "176", decision: "hold" });
    expect(held.json().status).toBe("on_hold");
    expect(held.json().moistureChecks[1]).toMatchObject({ status: "approved", kor: null, sampleG: "" });

    const rechecked = await call("wi", "POST", `/api/production/rcn-receipts/${id}/moisture-checks`, { moisture: "9.1", nutCount: "176", decision: "ok" });
    expect(rechecked.json().status).toBe("waiting_for_weighing");
    expect(await status(id)).toBe("waiting_for_weighing");
  });

  it("refuses what the doc's form refuses", async () => {
    const r = (await call("wi", "POST", "/api/production/rcn-receipts", { batchCode: "RRT-ANA-03B", date: "2026-07-22", btmNo: "112", binCode: "RRT-10" })).json();
    for (const [body, message] of [
      [{ ...btm1001, moisture: "21", decision: "ok" }, /between 0 and 20/],
      [{ ...btm1001, shellG: "700", decision: "ok" }, /more than the 1000 g sample/],
      [{ ...btm1001, decision: "maybe" }, /OK or Fail/],
    ] as const) {
      const res = await call("wi", "POST", `/api/production/rcn-receipts/${r.id}/moisture-checks`, body);
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toMatch(message);
    }
    expect(await status(r.id)).toBe("waiting_for_moisture");
  });

  it("writes each step to the batch history, with who did it", async () => {
    const texts = (await call("wi", "GET", "/api/production/batches/RRT-ANA-03B")).json().history.map((h: { text: string; actor: string }) => `${h.text} · ${h.actor}`);
    expect(texts).toEqual(expect.arrayContaining([
      "BTM 108 moisture 9.8 %, OK: submitted for approval · qfs",
      "BTM 108 moisture check approved · wi",
      "BTM 108 moisture check rejected: Wrong BTM · wi",
      "BTM 108 moisture 12.5 %, Fail · hold for re-check · wi",
      "BTM 108 moisture 9.1 %, OK · wi",
    ]));
  });
});

describe("Weighing (Phase 1, steps 3–4)", () => {
  // The first pallets of BTM 130 in the client's tally sheet (BIN-10 → ANA-10), and its empty-pallet weighings.
  const id = "RR-RRT-2026-0001"; // moisture OK above, so waiting for weighing
  const pallet = (grossKg: string, bags: string, factoryBin = "ana-10") => ({ grossKg, bags, factoryBin });
  const receipt = async () =>
    (await call("wi", "GET", "/api/production/rcn-receipts?batch=RRT-ANA-03B")).json().find((r: { id: string }) => r.id === id);

  it("is refused before moisture is OK, and to a QFS Officer", async () => {
    const waiting = (await call("wi", "GET", "/api/production/rcn-receipts?batch=RRT-ANA-03B")).json().find((r: { status: string }) => r.status === "waiting_for_moisture");
    const res = await call("wi", "POST", `/api/production/rcn-receipts/${waiting.id}/pallets`, pallet("2308.9", "30"));
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/Waiting for moisture; it can't be weighed now/);
    expect((await call("qfs", "POST", `/api/production/rcn-receipts/${id}/pallets`, pallet("2308.9", "30"))).statusCode).toBe(403);
  });

  it("adds pallets in order, keeps them as typed, and the load is Weighing in progress", async () => {
    for (const [g, b] of [["2308.9", "30"], ["2270.3", "31"], ["964.8", "12"]]) {
      expect((await call("wi", "POST", `/api/production/rcn-receipts/${id}/pallets`, pallet(g!, b!))).statusCode).toBe(201);
    }
    const r = await receipt();
    expect(r.status).toBe("weighing");
    expect(r.pallets.map((p: { no: number; grossKg: string; bags: string; factoryBin: string }) => [p.no, p.grossKg, p.bags, p.factoryBin])).toEqual([
      [1, "2308.9", "30", "ANA-10"],
      [2, "2270.3", "31", "ANA-10"],
      [3, "964.8", "12", "ANA-10"],
    ]);
    expect(r.finalWeight).toBeNull();

    const bad = await call("wi", "POST", `/api/production/rcn-receipts/${id}/pallets`, pallet("2300", "30.5"));
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error).toMatch(/whole number/);
  });

  it("corrects and removes a pallet until the final weight is saved; the others renumber", async () => {
    const [, second, third] = (await receipt()).pallets;
    expect((await call("wi", "PUT", `/api/production/rcn-pallets/${second.id}`, pallet("2270.3", "31", "ana-03b"))).json().pallets[1].factoryBin).toBe("ANA-03B");
    await call("wi", "POST", `/api/production/rcn-receipts/${id}/pallets`, pallet("9999", "1"));
    const typo = (await receipt()).pallets[3];
    const after = (await call("wi", "DELETE", `/api/production/rcn-pallets/${typo.id}`)).json();
    expect(after.pallets.map((p: { id: number; no: number }) => [p.id, p.no])).toEqual([[expect.any(Number), 1], [second.id, 2], [third.id, 3]]);
  });

  it("needs the empty pallets' weight; saving the final weight makes it Intake done and closes the weighing", async () => {
    const missing = await call("wi", "POST", `/api/production/rcn-receipts/${id}/final-weight`, { emptyPallets: [], dustKg: "925.7" });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().error).toMatch(/empty pallets' weight/);

    const saved = await call("wi", "POST", `/api/production/rcn-receipts/${id}/final-weight`, {
      emptyPallets: [{ weightKg: "374.3", count: "" }, { weightKg: "211.2", count: "3" }, { weightKg: "", count: "" }],
      dustKg: "925.7",
      voidsKg: "",
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      status: "intake_done",
      finalWeight: { emptyPallets: [{ weightKg: "374.3", count: "" }, { weightKg: "211.2", count: "3" }], dustKg: "925.7", voidsKg: "", finalisedBy: "wi" },
    });

    const [first] = saved.json().pallets;
    expect((await call("wi", "POST", `/api/production/rcn-receipts/${id}/pallets`, pallet("2000", "30"))).statusCode).toBe(422);
    expect((await call("wi", "PUT", `/api/production/rcn-pallets/${first.id}`, pallet("2000", "30"))).statusCode).toBe(422);
    expect((await call("wi", "POST", `/api/production/rcn-receipts/${id}/final-weight`, { emptyPallets: [{ weightKg: "1" }] })).statusCode).toBe(422);
  });

  it("writes the weighed load to the batch history, with its totals", async () => {
    // gross 2308.9 + 2270.3 + 964.8 = 5544; bags 73 × 0.65 = 47.45; pallets 585.5 → net 4911.05; − dust 925.7 → 3985.35
    const texts = (await call("wi", "GET", "/api/production/batches/RRT-ANA-03B")).json().history.map((h: { text: string; actor: string }) => `${h.text} · ${h.actor}`);
    expect(texts).toContain("BTM 108 weighed: 3 pallets, net 4,911.05 kg, 3,985.35 kg to silos · wi");
  });
});
