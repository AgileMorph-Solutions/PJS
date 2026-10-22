/**
 * The dashboard's supplier analytics (GET /api/dashboard/suppliers). Three things must hold:
 *  - nothing is dropped or counted twice: the supplier lines + the "no supplier code" line add up to every truck, and the
 *    bags / kg match a direct database sum (checked against whatever data is loaded, seeded real data included);
 *  - a supplier's line equals the figures on its own page (same rows, same calculation);
 *  - a known set of trucks gives the numbers worked out by hand, and a date range / site narrows them correctly.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, setBranch, setStageFields } from "../src/services/receipts.js";
import { getSupplierDetail } from "../src/services/suppliers.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const SITE = "SUPX";
const GRN = "GRN Weight (kept separate from Gross/Net/Paid)";
const cookies: Record<string, string> = {};

async function cleanup() {
  await prisma.juteWarehouseMovement.deleteMany({ where: { supplierCode: { startsWith: "SUPX" } } });
  await prisma.receipt.deleteMany({ where: { warehouse: SITE } });
  await prisma.supplier.deleteMany({ where: { code: { startsWith: "SUPX" } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "supx-" } } });
  await prisma.warehouse.deleteMany({ where: { name: SITE } });
}
async function login(key: string, role: string, warehouse: string | null) {
  await prisma.user.create({ data: { username: `supx-${key}`, displayName: key, role, warehouse, passwordHash: hashPassword(PW) } });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `supx-${key}`, password: PW } });
  cookies[key] = String(res.headers["set-cookie"]).split(";")[0]!;
}
const get = (url: string, who: string) => app.inject({ method: "GET", url, headers: { cookie: cookies[who]! } });

/** One truck. Net weight is worked out by the app as loaded - empty - one kg per bag (contract receiptMath). */
async function truck(date: string, o: { code?: string; name: string; pass: boolean; good: number; damp: number; torn: number; gross: number; tare: number; grn?: number }) {
  const r = await createReceipt(SITE, date);
  await setStageFields(r.id, "n-verify", { ...(o.code ? { "LBA CODE": o.code } : {}), "SUPPLIERS NAME": o.name });
  if (o.pass) await setBranch(r.id, "n-qfs", "pass"); else await setBranch(r.id, "n-qfs", "fail", "Moisture too high");
  await setStageFields(r.id, "n-gross", { "Loaded truck weight (kg)": String(o.gross) });
  await setStageFields(r.id, "n-gross", { "Tare / empty truck weight (kg)": String(o.tare) });
  await setStageFields(r.id, "n-unload", { "BON SACS (good bags)": String(o.good), "HUMID SACS (damp bags)": String(o.damp), "Sacs déchirés (torn bags)": String(o.torn) });
  if (o.grn !== undefined) await setStageFields(r.id, "n-grn", { [GRN]: String(o.grn) });
}

beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: SITE, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "SUX" } });
  await login("admin", "admin", null);
  await login("wi", "warehouse_incharge", SITE);
  await login("bm", "branch_manager", SITE);
  await login("qfs", "qfs_officer", SITE);

  await prisma.supplier.create({ data: { code: "SUPX-A", name: "SUPX ALPHA", status: "suspended", statusReason: "Late deliveries" } });
  // SUPX-A: one clean truck with a GRN, one with damaged bags and no GRN yet, one rejected (its bags and kg must not count).
  await truck("2026-05-01", { code: "SUPX-A", name: "SUPX ALPHA", pass: true, good: 100, damp: 0, torn: 0, gross: 30000, tare: 20000, grn: 9500 });
  await truck("2026-05-10", { code: "SUPX-A", name: "SUPX ALPHA", pass: true, good: 90, damp: 5, torn: 5, gross: 30000, tare: 20000 });
  await truck("2026-05-12", { code: "SUPX-A", name: "SUPX ALPHA", pass: false, good: 50, damp: 0, torn: 0, gross: 20000, tare: 10000 });
  // SUPX-B: not in the register, so its name comes from its truck.
  await truck("2026-05-05", { code: "SUPX-B", name: "SUPX BRAVO", pass: true, good: 200, damp: 0, torn: 0, gross: 50000, tare: 30000, grn: 19000 });
  // No LBA code at all.
  await truck("2026-05-06", { name: "SUPX UNKNOWN", pass: true, good: 10, damp: 0, torn: 0, gross: 15000, tare: 5000 });
  await prisma.juteWarehouseMovement.create({ data: { seq: 9_100_001, activitiesType: "SUPX ALPHA", activityCategory: "SUPPLIER_ISSUE", supplierCode: "SUPX-A", whLocation: SITE, bagsIssued: 1200, movementDate: new Date("2026-05-03T00:00:00Z") } });
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

describe("nothing is dropped or counted twice (all data loaded)", () => {
  it("the supplier lines plus the no-code line are every truck, and bags and kg match a direct sum", async () => {
    const a = (await get("/api/dashboard/suppliers", "admin")).json();
    const lines = [...a.rows, ...(a.noCode ? [a.noCode] : [])];
    const sum = (pick: (p: Record<string, number>) => number) => lines.reduce((n: number, l: { performance: Record<string, number> }) => n + pick(l.performance), 0);
    const everyTruck = await prisma.receipt.count();
    expect(sum((p) => p.trucksArrived!)).toBe(everyTruck);
    expect(a.totals.trucksArrived).toBe(everyTruck);

    // The same sums straight from the stage tables, on accepted trucks only (a truck failed at QFS is not delivery).
    const accepted = { receipt: { branches: { none: { stageId: "n-qfs", branchId: "fail" } } } };
    const bags = await prisma.stageUnload.aggregate({ _sum: { sacsNum: true }, where: accepted });
    const grn = await prisma.stageGrn.aggregate({ _sum: { grnWeightNum: true }, where: accepted });
    const net = await prisma.stageNetWeight.aggregate({ _sum: { netWtKgsNum: true }, where: accepted });
    expect(a.totals.bagsDelivered).toBe(Number(bags._sum.sacsNum ?? 0));
    expect(a.totals.volumeDeliveredKg).toBe(Number(grn._sum.grnWeightNum ?? 0));
    expect(a.totals.weighedOnArrivalKg).toBe(Number(net._sum.netWtKgsNum ?? 0));
    expect(sum((p) => p.bagsDelivered!)).toBe(a.totals.bagsDelivered);
    expect(sum((p) => p.volumeDeliveredKg!)).toBe(a.totals.volumeDeliveredKg);
    expect(sum((p) => p.weighedOnArrivalKg!)).toBe(a.totals.weighedOnArrivalKg);
  });

  it("a supplier's line is exactly what its own page shows", async () => {
    const a = (await get("/api/dashboard/suppliers", "admin")).json();
    const biggest = [...a.rows].sort((x, y) => y.performance.trucksArrived - x.performance.trucksArrived).slice(0, 5);
    expect(biggest.length).toBeGreaterThan(0);
    for (const row of biggest) {
      const detail = await getSupplierDetail(row.code);
      // A truck can carry a code that was never registered: it has a line here and no page to compare with.
      if (detail) expect(row.performance).toEqual(JSON.parse(JSON.stringify(detail.performance)));
    }
    const mine = await getSupplierDetail("SUPX-A");
    expect(a.rows.find((r: { code: string }) => r.code === "SUPX-A").performance).toEqual(JSON.parse(JSON.stringify(mine!.performance)));
  });
});

describe("a known set of trucks (one site)", () => {
  it("works out bags, kg, rejections and jute per supplier, biggest delivery first", async () => {
    const a = (await get("/api/dashboard/suppliers", "wi")).json();
    expect(a.rows.map((r: { code: string }) => r.code)).toEqual(["SUPX-B", "SUPX-A"]);
    const [b, alpha] = a.rows;
    expect(b).toMatchObject({ name: "SUPX BRAVO", status: null });
    expect(b.performance).toMatchObject({ trucksArrived: 1, acceptedTrucks: 1, bagsDelivered: 200, damagedBagPct: 0, volumeDeliveredKg: 19000, weighedOnArrivalKg: 19800, trucksAwaitingGrn: 0 });
    expect(alpha).toMatchObject({ name: "SUPX ALPHA", status: "suspended" });
    expect(alpha.performance).toMatchObject({
      trucksArrived: 3, rejectedTrucks: 1, acceptedTrucks: 2, rejectionRatePct: 33.3,
      // The rejected truck's 50 bags and its kg are not delivery.
      bagsDelivered: 200, goodBags: 190, dampBags: 5, tornBags: 5, damagedBagPct: 5,
      volumeDeliveredKg: 9500, weighedOnArrivalKg: 19800, trucksAwaitingGrn: 1, averageNetKgPerTruck: 9900,
      lastDeliveryDate: "2026-05-10", juteBagsIssued: 1200,
    });
    expect(a.noCode).toMatchObject({ code: "", name: "No supplier code" });
    expect(a.noCode.performance).toMatchObject({ trucksArrived: 1, bagsDelivered: 10, weighedOnArrivalKg: 9990 });
    expect(a.totals).toMatchObject({ trucksArrived: 5, acceptedTrucks: 4, rejectedTrucks: 1, bagsDelivered: 410, volumeDeliveredKg: 28500, weighedOnArrivalKg: 49590, juteBagsIssued: 1200 });
  });

  it("a date range narrows trucks and jute together, and drops a supplier with nothing in it", async () => {
    const a = (await get("/api/dashboard/suppliers?from=2026-05-04&to=2026-05-06", "wi")).json();
    expect(a.rows.map((r: { code: string }) => r.code)).toEqual(["SUPX-B"]); // SUPX-A: trucks and jute fall outside the range
    expect(a.noCode.performance.trucksArrived).toBe(1);
    expect(a.totals).toMatchObject({ trucksArrived: 2, bagsDelivered: 210, juteBagsIssued: 0 });
    expect(a.period).toEqual({ from: "2026-05-04", to: "2026-05-06" });

    const early = (await get("/api/dashboard/suppliers?from=2026-05-01&to=2026-05-04", "wi")).json();
    expect(early.rows.map((r: { code: string }) => r.code)).toEqual(["SUPX-A"]);
    expect(early.rows[0].performance).toMatchObject({ trucksArrived: 1, bagsDelivered: 100, juteBagsIssued: 1200 });
    expect(early.noCode).toBeNull();
  });

  it("a site only sees its own trucks", async () => {
    const other = (await get("/api/dashboard/suppliers?warehouse=SUPX", "admin")).json();
    expect(other.totals.trucksArrived).toBe(5);
    const nowhere = (await get("/api/dashboard/suppliers?warehouse=BOUAKE&from=2026-05-01&to=2026-05-12", "admin")).json();
    expect(nowhere.rows.find((r: { code: string }) => r.code.startsWith("SUPX"))).toBeUndefined();
  });
});

describe("who may read it", () => {
  it("is for Warehouse Incharge and admin only", async () => {
    expect((await get("/api/dashboard/suppliers", "wi")).statusCode).toBe(200);
    expect((await get("/api/dashboard/suppliers", "admin")).statusCode).toBe(200);
    expect((await get("/api/dashboard/suppliers", "bm")).statusCode).toBe(403);
    expect((await get("/api/dashboard/suppliers", "qfs")).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/dashboard/suppliers" })).statusCode).toBe(401);
  });
  it("an incharge cannot ask for another warehouse's figures", async () => {
    expect((await get("/api/dashboard/suppliers?warehouse=BOUAKE", "wi")).statusCode).toBe(403);
  });
});
