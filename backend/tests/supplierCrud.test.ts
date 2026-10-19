/**
 * The supplier register (the client's LBA register): create / edit / remove, the "no RCN" rule, required fields,
 * the three statuses, who may see the supplier page (it carries bank details), and the figures it works out from
 * the supplier's trucks and plans. A request carries a JSON content-type only when it has a body, as the browser does.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, setBranch, setStageFields } from "../src/services/receipts.js";
import { createDeliveryPlan } from "../src/services/deliveryPlans.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const A = "SUPC-A";
const cookies: Record<string, string> = {};
const GRN = "GRN Weight (kept separate from Gross/Net/Paid)";

/** Every required register field (contract supplierProfile.ts), so a new supplier can be created. */
const REQUIRED = {
  zone: "Centre", managerName: "Kouassi Adama", phonePrimary: "+225 07 00 00 00 01", registrationRef: "CI-BKE-2024-B-00001",
  bankAccountHolder: "SUPC Holder", bankName: "SGBCI", bankAccountRef: "CI001 00001 0000000001 01",
};

async function cleanup() {
  await prisma.juteWarehouseMovement.deleteMany({ where: { supplierCode: { startsWith: "SUPC" } } });
  await prisma.juteSupplierMovement.deleteMany({ where: { supplierCode: { startsWith: "SUPC" } } });
  await prisma.receipt.deleteMany({ where: { warehouse: A } });
  await prisma.deliveryPlan.deleteMany({ where: { destinationWarehouse: A } });
  await prisma.supplier.deleteMany({ where: { OR: [{ code: { startsWith: "SUPC" } }, { name: { startsWith: "SUPC" } }, { code: { startsWith: "LBA-9" } }] } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "supc-" } } });
  await prisma.warehouse.deleteMany({ where: { name: A } });
}
async function login(key: string, role: string) {
  await prisma.user.create({ data: { username: `supc-${key}`, displayName: key === "wi" ? "Ama" : key, role, warehouse: A, passwordHash: hashPassword(PW) } });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `supc-${key}`, password: PW } });
  cookies[key] = String(res.headers["set-cookie"]).split(";")[0]!;
}
beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: A, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "SCA" } });
  await login("wi", "warehouse_incharge");
  await login("bm", "branch_manager");
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown, who = "wi") =>
  app.inject({ method, url, payload: payload as object | undefined, headers: { cookie: cookies[who]!, ...(payload ? { "content-type": "application/json" } : {}) } });

describe("creating a supplier", () => {
  it("needs every required register field, and says which are missing", async () => {
    const res = await call("POST", "/api/masters/suppliers", { code: "SUPC-000", name: "SUPC NOTHING" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/Zone is required.*Bank is required/);
  });

  it("stores the name without RCN, keeps the original, issues a permanent SUP- id and records who created it", async () => {
    const res = await call("POST", "/api/masters/suppliers", { code: "SUPC-001", name: "RCN SUPC ALPHA", ...REQUIRED });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ code: "SUPC-001", name: "SUPC ALPHA", formerName: "RCN SUPC ALPHA", status: "active" });
    expect(res.json().supplierNo).toMatch(/^SUP-\d{4,}$/);
    const detail = (await call("GET", "/api/masters/suppliers/SUPC-001")).json();
    expect(detail).toMatchObject({ createdBy: "Ama", completeness: { filled: 8, total: 8 }, missing: [], detailsSource: null });
  });

  it("suggests the next free LBA code from the name, and uses it when the code is left blank", async () => {
    await prisma.supplier.create({ data: { code: "LBA-900-OLD", name: "SUPC OLD" } });
    expect((await call("GET", "/api/masters/suppliers/suggest-code?name=RCN%20SCOOPS%20SUPCGAMMA")).json()).toEqual({ code: "LBA-901-SUP" });
    const auto = (await call("POST", "/api/masters/suppliers", { name: "SUPC DELTA", ...REQUIRED })).json();
    expect(auto.code).toMatch(/^LBA-\d{3}-SUP$/);
  });

  it("refuses an existing code instead of silently overwriting it", async () => {
    const res = await call("POST", "/api/masters/suppliers", { code: "SUPC-001", name: "SUPC SOMEONE ELSE", ...REQUIRED });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/already exists/);
  });
});

describe("editing a supplier", () => {
  it("an existing supplier with no details yet can still be saved; it just can't lose a required field it has", async () => {
    await prisma.supplier.create({ data: { code: "SUPC-OLD", name: "SUPC IMPORTED", detailsSource: "sample", zone: "Nord" } });
    expect((await call("PATCH", "/api/masters/suppliers/SUPC-OLD", { region: "Poro" })).statusCode).toBe(200);
    const emptied = await call("PATCH", "/api/masters/suppliers/SUPC-OLD", { zone: "" });
    expect(emptied.statusCode).toBe(422);
    expect(emptied.json().error).toMatch(/Zone is required and can't be emptied/);
  });

  it("saving details by hand ends the 'sample' marking, and records who changed it", async () => {
    const d = (await call("GET", "/api/masters/suppliers/SUPC-OLD")).json();
    expect(d).toMatchObject({ detailsSource: null, updatedBy: "Ama", profile: { region: "Poro", zone: "Nord" } });
    expect(d.missing).toContain("Primary phone number");
  });

  it("suspended or inactive needs a reason; back to active clears it", async () => {
    expect((await call("PATCH", "/api/masters/suppliers/SUPC-OLD", { status: "suspended" })).statusCode).toBe(422);
    const s = (await call("PATCH", "/api/masters/suppliers/SUPC-OLD", { status: "suspended", statusReason: "Quality complaints" })).json();
    expect(s).toMatchObject({ status: "suspended", statusReason: "Quality complaints" });
    // A suspended supplier stays in the pickers (with a warning); only inactive ones leave them.
    const list = (await call("GET", "/api/masters")).json().suppliers;
    expect(list.find((x: { code: string }) => x.code === "SUPC-OLD")).toMatchObject({ status: "suspended", active: true });
    expect((await call("PATCH", "/api/masters/suppliers/SUPC-OLD", { status: "active" })).json()).toMatchObject({ status: "active", statusReason: null });
    expect((await call("PATCH", "/api/masters/suppliers/SUPC-OLD", { status: "paused" })).statusCode).toBe(422);
  });

  it("refuses to change a code that trucks already carry", async () => {
    const r = await createReceipt(A, "2026-06-01");
    await prisma.receipt.update({ where: { id: r.id }, data: { lbaCode: "SUPC-001" } });
    const refused = await call("PATCH", "/api/masters/suppliers/SUPC-001", { code: "SUPC-001X" });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error).toMatch(/can't be changed/);
  });
});

describe("removing a supplier", () => {
  it("a supplier that is used becomes inactive instead, with the reason, and history is untouched", async () => {
    const res = await call("DELETE", "/api/masters/suppliers/SUPC-001");
    expect(res.json()).toMatchObject({ deleted: false, deactivated: true, references: { receipts: 1 } });
    expect(await prisma.supplier.findUnique({ where: { code: "SUPC-001" } })).toMatchObject({ status: "inactive", statusReason: expect.stringMatching(/still used/) });
    expect((await call("GET", "/api/masters")).json().suppliers.find((x: { code: string }) => x.code === "SUPC-001").active).toBe(false);
    await call("PATCH", "/api/masters/suppliers/SUPC-001", { status: "active" });
  });

  it("an unused supplier really is deleted, and an unknown one is a 404", async () => {
    const created = (await call("POST", "/api/masters/suppliers", { code: "SUPC-GONE", name: "SUPC GONE", ...REQUIRED })).json();
    expect((await call("DELETE", `/api/masters/suppliers/${created.code}`)).json()).toMatchObject({ deleted: true });
    expect((await call("DELETE", "/api/masters/suppliers/NOPE-NOPE")).statusCode).toBe(404);
  });
});

describe("who sees what", () => {
  it("the supplier page (bank details included) is for admin and Warehouse Incharge only", async () => {
    expect((await call("GET", "/api/masters/suppliers/SUPC-001", undefined, "bm")).statusCode).toBe(403);
    expect((await call("PATCH", "/api/masters/suppliers/SUPC-001", { zone: "x" }, "bm")).statusCode).toBe(403);
  });

  it("the supplier list every role reads carries no contact or bank details", async () => {
    const row = (await call("GET", "/api/masters", undefined, "bm")).json().suppliers.find((x: { code: string }) => x.code === "SUPC-001");
    expect(Object.keys(row).sort()).toEqual(["active", "code", "formerName", "name", "status", "supplierNo"]);
  });
});

describe("figures worked out from the supplier's transactions", () => {
  it("target and achievement from its delivery plans, quality weighted by kg, rejections, last delivery", async () => {
    await call("POST", "/api/masters/suppliers", { code: "SUPC-PERF", name: "SUPC PERF", ...REQUIRED });
    const plan = await createDeliveryPlan({ supplierName: "SUPC PERF", supplierCode: "SUPC-PERF", expectedQuantityKg: 50000, expectedArrivalDate: "2026-05-01", destinationWarehouse: A });
    const truck = async (date: string, opts: { plan?: boolean; pass: boolean; grn?: string; kor?: string; mois?: string }) => {
      const r = await createReceipt(A, date, opts.plan ? plan.id : undefined);
      await setStageFields(r.id, "n-verify", { "LBA CODE": "SUPC-PERF", "SUPPLIERS NAME": "SUPC PERF" });
      await setStageFields(r.id, "n-qfs", { ...(opts.kor ? { KOR: opts.kor } : {}), ...(opts.mois ? { "MOIS. (moisture)": opts.mois } : {}) });
      if (opts.pass) {
        await setBranch(r.id, "n-qfs", "pass");
        await setStageFields(r.id, "n-unload", { "BON SACS (good bags)": "100" });
        if (opts.grn) await setStageFields(r.id, "n-grn", { [GRN]: opts.grn });
      } else await setBranch(r.id, "n-qfs", "fail", "Moisture too high");
    };
    await truck("2026-05-02", { plan: true, pass: true, grn: "30000", kor: "48", mois: "9" });
    await truck("2026-05-04", { plan: true, pass: true, grn: "10000", kor: "44", mois: "11" });
    await truck("2026-05-06", { pass: false, kor: "30", mois: "15" });
    await truck("2026-05-05", { pass: true, grn: "5000" }); // unplanned, no readings
    // Weighed on arrival (net weight), GRN not entered yet.
    const weighed = await createReceipt(A, "2026-05-08");
    await setStageFields(weighed.id, "n-verify", { "LBA CODE": "SUPC-PERF", "SUPPLIERS NAME": "SUPC PERF" });
    await setStageFields(weighed.id, "n-qfs", { KOR: "46", "MOIS. (moisture)": "10" });
    await setBranch(weighed.id, "n-qfs", "pass");
    await setStageFields(weighed.id, "n-gross", { "Loaded truck weight (kg)": "30000" });
    await setStageFields(weighed.id, "n-tare", { "Tare / empty truck weight (kg)": "20000" });
    // Net weight is worked out from all three bag counts (contract receiptMath), so all three are given.
    await setStageFields(weighed.id, "n-unload", { "BON SACS (good bags)": "98", "HUMID SACS (damp bags)": "1", "Sacs déchirés (torn bags)": "1" });
    // Jute: 1,200 bags issued to the supplier on the warehouse ledger, 300 returned via deliveries on the supplier ledger.
    await prisma.juteWarehouseMovement.create({ data: { seq: 9_000_001, activitiesType: "SUPC PERF", activityCategory: "SUPPLIER_ISSUE", supplierCode: "SUPC-PERF", whLocation: A, bagsIssued: 1200 } });
    await prisma.juteSupplierMovement.create({ data: { supplierCode: "SUPC-PERF", returnedViaDeliveries: 300 } });

    const p = (await call("GET", "/api/masters/suppliers/SUPC-PERF")).json().performance;
    expect(p).toMatchObject({
      targetKg: 50000, receivedOnPlansKg: 40000, achievementPct: 80, volumeDeliveredKg: 45000,
      // The weighed truck (net 10,000 gross - 100 bags = 9,900 kg) has no GRN: it is counted as weighed and awaiting GRN, never in the GRN volume.
      weighedOnArrivalKg: 9900, trucksAwaitingGrn: 1,
      averageKor: 46.8, korTrucks: 3, averageMoisture: 9.6, moistureTrucks: 3, trucksArrived: 5, rejectedTrucks: 1, rejectionRatePct: 20,
      lastDeliveryDate: "2026-05-08", juteBagsIssued: 1200, juteBagsReturned: 300, juteBagBalance: 900, fundingExposure: null, outstandingAmount: null,
    });
  });
});
