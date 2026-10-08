/**
 * End-to-end through the HTTP layer (the repo's first buildApp().inject() test): sign-in, warehouse
 * scoping, role gates, and the submit → approve/reject flow. Runs against the live seeded database
 * like every other file here, with sentinel rows removed afterwards.
 *
 * The invariants that matter most: a PENDING submission must not move derived status or touch a
 * stage table; approval applies exactly the submitted values with an audit row; rejection is
 * terminal and applies nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, setStageFields } from "../src/services/receipts.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const P = "umtest-";
const SUPPLIER = "UMTEST-SUP";

const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};
let receiptA: string; // BOUAKE, the receipt the flows run on
let receiptB: string; // BOUAKE, the QFS jute-check flows run on
const createdReceipts: string[] = [];

async function login(username: string) {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: PW } });
  expect(res.statusCode, `login ${username}`).toBe(200);
  const set = String(res.headers["set-cookie"]);
  cookies[username] = set.split(";")[0];
}
const as = (u: string, method: "GET" | "POST" | "PATCH" | "PUT", url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as any, headers: { cookie: cookies[u] } });

async function mkUser(key: string, role: string, warehouse: string | null) {
  const u = await prisma.user.create({
    data: { username: P + key, displayName: key, role, warehouse, passwordHash: hashPassword(PW) },
  });
  ids[key] = u.id;
  await login(u.username);
}

async function cleanup() {
  await prisma.receipt.deleteMany({ where: { id: { in: createdReceipts } } });
  await prisma.supplierRequest.deleteMany({ where: { requestedBy: { username: { startsWith: P } } } });
  // assignedById has no cascade: an assigner can't be deleted while their assignments remain.
  await prisma.branchManagerSupplier.deleteMany({ where: { OR: [{ user: { username: { startsWith: P } } }, { assignedBy: { username: { startsWith: P } } }] } });
  await prisma.user.deleteMany({ where: { username: { startsWith: P } } });
  await prisma.supplier.deleteMany({ where: { code: { in: [SUPPLIER, "UMTEST-REQ"] } } });
}

beforeAll(async () => {
  await cleanup();
  await prisma.supplier.create({ data: { code: SUPPLIER, name: "UM Test Supplier" } });
  await mkUser("admin", "admin", null);
  await mkUser("wi", "warehouse_incharge", "BOUAKE");
  await mkUser("wiY", "warehouse_incharge", "YAKRO FACTORY");
  await mkUser("bm", "branch_manager", "BOUAKE");
  await mkUser("qfs", "qfs_officer", "BOUAKE");

  for (const key of ["a", "b"]) {
    const r = await createReceipt("BOUAKE");
    createdReceipts.push(r.id);
    if (key === "a") receiptA = r.id; else receiptB = r.id;
  }
  await setStageFields(receiptA, "n-gate", { "VEHICLE NO.": "GATE-1" });
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

const bmForm = (extra: Record<string, Record<string, string>> = {}) => ({
  values: {
    "n-gate": { "VEHICLE NO.": "TRUCK-42" },
    "n-verify": { "SUPPLIERS NAME": "UM Test Supplier", "LBA CODE": SUPPLIER, FICHE: "F-100" },
    "n-grn": { PRICE: "470" },
    ...extra,
  },
});

describe("sign-in and scoping", () => {
  it("is 401 without a session, except health and login", async () => {
    expect((await app.inject({ method: "GET", url: "/api/receipts" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: P + "wi", password: "nope" } })).statusCode).toBe(401);
  });

  it("returns the user's warehouse and its Unit/Central type", async () => {
    const me = (await as(P + "wi", "GET", "/api/auth/me")).json();
    expect(me).toMatchObject({ role: "warehouse_incharge", warehouse: "BOUAKE", warehouseType: "UNIT" });
  });

  it("pins non-admins to their own warehouse and lets admin see both", async () => {
    expect((await as(P + "wi", "GET", "/api/receipts?warehouse=YAKRO FACTORY")).statusCode).toBe(403);
    const mine = await as(P + "wi", "GET", "/api/receipts");
    expect(mine.statusCode).toBe(200);
    expect(mine.json().every((r: any) => ["BOUAKE"].includes(r.warehouse) || r.warehouse.startsWith("BKE"))).toBe(true);
    expect((await as(P + "admin", "GET", "/api/receipts?warehouse=YAKRO FACTORY")).statusCode).toBe(200);
  });

  it("blocks a Warehouse Incharge from another warehouse's receipt", async () => {
    expect((await as(P + "wiY", "GET", `/api/receipts/${receiptA}`)).statusCode).toBe(403);
    expect((await as(P + "wiY", "PATCH", `/api/receipts/${receiptA}/stages/n-gross`, { fields: { "GROSS WT KGS": "1" } })).statusCode).toBe(403);
  });

  it("keeps Branch Manager and QFS off direct writes", async () => {
    const patch = { fields: { "GROSS WT KGS": "1" } };
    expect((await as(P + "bm", "PATCH", `/api/receipts/${receiptA}/stages/n-gross`, patch)).statusCode).toBe(403);
    expect((await as(P + "qfs", "PATCH", `/api/receipts/${receiptA}/stages/n-gross`, patch)).statusCode).toBe(403);
    expect((await as(P + "bm", "GET", "/api/jute-ledgers")).statusCode).toBe(403);
  });
});

describe("user administration", () => {
  it("is admin-only", async () => {
    expect((await as(P + "wi", "GET", "/api/users")).statusCode).toBe(403);
    expect((await as(P + "admin", "GET", "/api/users")).statusCode).toBe(200);
  });

  it("refuses a warehouse without a Unit/Central type, and a store", async () => {
    const body = { username: P + "x", password: PW, role: "warehouse_incharge" };
    const untyped = await as(P + "admin", "POST", "/api/users", { ...body, warehouse: "YAMOUSSOUKRO" });
    expect(untyped.statusCode).toBe(422);
    const store = await as(P + "admin", "POST", "/api/users", { ...body, warehouse: "ANAGROCI-01" });
    expect(store.statusCode).toBe(422);
    expect(await prisma.user.count({ where: { username: P + "x" } })).toBe(0);
  });

  it("creates a user on a typed site", async () => {
    const res = await as(P + "admin", "POST", "/api/users", { username: P + "made", password: PW, role: "qfs_officer", warehouse: "BOUAKE" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ warehouse: "BOUAKE", warehouseType: "UNIT" });
  });
});

describe("Branch Manager submission → Warehouse Incharge approval", () => {
  let submissionId: string;

  it("refuses a supplier that isn't assigned to the Branch Manager", async () => {
    const res = await as(P + "bm", "POST", `/api/receipts/${receiptA}/submissions`, bmForm());
    expect(res.statusCode).toBe(403);
  });

  it("only lets a Warehouse Incharge assign suppliers, and only known ones", async () => {
    expect((await as(P + "bm", "PUT", `/api/branch-managers/${ids.bm}/suppliers`, { codes: [SUPPLIER] })).statusCode).toBe(403);
    expect((await as(P + "wi", "PUT", `/api/branch-managers/${ids.bm}/suppliers`, { codes: ["NO-SUCH"] })).statusCode).toBe(422);
    expect((await as(P + "wiY", "PUT", `/api/branch-managers/${ids.bm}/suppliers`, { codes: [SUPPLIER] })).statusCode).toBe(403);
    expect((await as(P + "wi", "PUT", `/api/branch-managers/${ids.bm}/suppliers`, { codes: [SUPPLIER] })).statusCode).toBe(200);
    expect((await as(P + "bm", "GET", "/api/my-suppliers")).json().map((s: any) => s.code)).toEqual([SUPPLIER]);
  });

  it("rejects fields outside the Branch Manager form — including the Lot and the weights the system now produces", async () => {
    const outside = await as(P + "bm", "POST", `/api/receipts/${receiptA}/submissions`, { values: { "n-tare": { "Tare / empty truck weight (kg)": "1" } } });
    expect(outside.statusCode).toBe(422);
    // Lot is issued on quality pass; gross and net are calculated — nobody submits them any more.
    const extras: Record<string, Record<string, string>>[] = [
      { "n-lot": { "Lot Number": "UMTEST-LOT-1" } },
      { "n-gross": { "GROSS WT KGS": "41000" } },
      { "n-netwt": { "NET WT KGS": "40500" } },
    ];
    for (const extra of extras) {
      const res = await as(P + "bm", "POST", `/api/receipts/${receiptA}/submissions`, bmForm(extra));
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toMatch(/isn't part of the Branch Manager/);
    }
  });

  it("stores a pending submission without touching the receipt", async () => {
    const before = (await as(P + "wi", "GET", `/api/receipts/${receiptA}`)).json();
    const res = await as(P + "bm", "POST", `/api/receipts/${receiptA}/submissions`, bmForm());
    expect(res.statusCode).toBe(201);
    submissionId = res.json().id;

    const after = (await as(P + "wi", "GET", `/api/receipts/${receiptA}`)).json();
    expect(after.status).toBe(before.status);
    expect(after.stageData).toEqual(before.stageData);
    expect(after.stageData["n-grn"]).toBeUndefined();
    expect(await prisma.stageFieldChange.count({ where: { receiptId: receiptA } })).toBe(0);
  });

  it("refuses a second submission of the same form", async () => {
    expect((await as(P + "bm", "POST", `/api/receipts/${receiptA}/submissions`, bmForm())).statusCode).toBe(422);
  });

  it("keeps a Branch Manager from approving, and shows the queue to the Warehouse Incharge", async () => {
    expect((await as(P + "bm", "POST", `/api/submissions/${submissionId}/approve`)).statusCode).toBe(403);
    const queue = (await as(P + "wi", "GET", "/api/submissions?status=submitted")).json();
    expect(queue.some((s: any) => s.id === submissionId)).toBe(true);
    expect((await as(P + "wiY", "POST", `/api/submissions/${submissionId}/approve`)).statusCode).toBe(403);
  });

  it("applies exactly the submitted values on approval, with audit and actor", async () => {
    expect((await as(P + "wi", "POST", `/api/submissions/${submissionId}/approve`)).statusCode).toBe(200);

    const r = (await as(P + "wi", "GET", `/api/receipts/${receiptA}`)).json();
    expect(r.stageData["n-grn"]["PRICE"]).toBe("470");
    expect(r.stageData["n-verify"]["FICHE"]).toBe("F-100");
    // Approving the Branch Manager's form never hands out a Lot — that happens on quality pass.
    expect(r.lotNo ?? "").toBe("");
    expect(r).toMatchObject({ lbaCode: SUPPLIER, supplierName: "UM Test Supplier", vehicleNo: "TRUCK-42",
      // A price alone no longer makes a truck GRN-completed (Oct 2026: the GRN quantity must be recorded), so the
      // approved price leaves it where its other stages put it — it never unloaded or passed quality in this test.
      status: "pending_qa" });

    const changes = await prisma.stageFieldChange.findMany({ where: { receiptId: receiptA } });
    expect(changes.length).toBeGreaterThanOrEqual(5);
    expect(changes.every((c) => c.via === "approval" && c.userId === ids.wi)).toBe(true);
    // The gate's vehicle number changed GATE-1 -> TRUCK-42, and the audit says so.
    expect(changes.find((c) => c.label === "VEHICLE NO.")).toMatchObject({ oldValue: "GATE-1", newValue: "TRUCK-42" });

    const last = r.timeline[r.timeline.length - 1];
    expect(last.note).toMatch(/Approved/);
    expect((await prisma.timelineEntry.findFirst({ where: { receiptId: receiptA }, orderBy: { id: "desc" } }))!.actorId).toBe(ids.wi);
  });

  it("can't approve or reject it twice", async () => {
    expect((await as(P + "wi", "POST", `/api/submissions/${submissionId}/approve`)).statusCode).toBe(422);
    expect((await as(P + "wi", "POST", `/api/submissions/${submissionId}/reject`, { reason: "late" })).statusCode).toBe(422);
  });

  it("audits a Warehouse Incharge's direct correction", async () => {
    const res = await as(P + "wi", "PATCH", `/api/receipts/${receiptA}/stages/n-grn`, { fields: { PRICE: "480" } });
    expect(res.statusCode).toBe(200);
    const c = await prisma.stageFieldChange.findFirst({ where: { receiptId: receiptA, via: "direct" } });
    expect(c).toMatchObject({ label: "PRICE", oldValue: "470", newValue: "480" });
  });
});

describe("QFS Officer submission and terminal rejection", () => {
  // The total (SACS) isn't submitted: it is calculated from the three counts.
  const form = { values: { "n-unload": { "BON SACS (good bags)": "463", "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "15" } } };
  let id: string;

  it("stores the jute check as pending", async () => {
    const res = await as(P + "qfs", "POST", `/api/receipts/${receiptB}/submissions`, form);
    expect(res.statusCode).toBe(201);
    id = res.json().id;
    expect((await as(P + "wi", "GET", `/api/receipts/${receiptB}`)).json().stageData["n-unload"]).toBeUndefined();
  });

  it("requires a reason to reject", async () => {
    expect((await as(P + "wi", "POST", `/api/submissions/${id}/reject`, {})).statusCode).toBe(422);
  });

  it("rejects terminally: nothing applied, no resubmission", async () => {
    expect((await as(P + "wi", "POST", `/api/submissions/${id}/reject`, { reason: "Count doesn't match the tally sheet" })).statusCode).toBe(200);
    expect((await as(P + "wi", "GET", `/api/receipts/${receiptB}`)).json().stageData["n-unload"]).toBeUndefined();
    const again = await as(P + "qfs", "POST", `/api/receipts/${receiptB}/submissions`, form);
    expect(again.statusCode).toBe(422);
    expect(again.json().error).toMatch(/rejected/);
    expect((await as(P + "qfs", "GET", "/api/submissions")).json()[0]).toMatchObject({ status: "rejected", rejectReason: "Count doesn't match the tally sheet" });
  });

  it("lets the Warehouse Incharge fix the data afterwards", async () => {
    const res = await as(P + "wi", "PATCH", `/api/receipts/${receiptB}/stages/n-unload`, { fields: { "BON SACS (good bags)": "460" } });
    expect(res.statusCode).toBe(200);
  });
});

describe("QFS Officer quality analysis", () => {
  let receiptId: string;
  let submissionId: string;
  const quality = { "MOIS. (moisture)": "10.3", "NUT COUNT": "165", KOR: "40.03599", "FINAL KOR": "40.1" };

  beforeAll(async () => {
    receiptId = (await createReceipt("BOUAKE")).id;
    createdReceipts.push(receiptId);
    // Reached QFS: gate + supplier docs done, no decision yet.
    await setStageFields(receiptId, "n-gate", { "VEHICLE NO.": "QFS-1" });
    await setStageFields(receiptId, "n-verify", { "LBA CODE": SUPPLIER });
  });

  it("takes the four measurements together with the bag counts in one submission", async () => {
    const res = await as(P + "qfs", "POST", `/api/receipts/${receiptId}/submissions`, {
      values: { "n-qfs": quality, "n-unload": { "BON SACS (good bags)": "463", "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "15" } },
    });
    expect(res.statusCode).toBe(201);
    submissionId = res.json().id;
  });

  it("applies the measurements on approval but records no Pass/Fail decision", async () => {
    const before = (await as(P + "wi", "GET", `/api/receipts/${receiptId}`)).json();
    expect(before.stageData["n-qfs"]).toBeUndefined();

    expect((await as(P + "wi", "POST", `/api/submissions/${submissionId}/approve`)).statusCode).toBe(200);
    const after = (await as(P + "wi", "GET", `/api/receipts/${receiptId}`)).json();
    expect(after.stageData["n-qfs"]).toMatchObject(quality);
    // Approval wrote the three counts; the total is the system's own sum of them.
    expect(after.stageData["n-unload"]["SACS (bags)"]).toBe("478");
    // The decision is the Warehouse Incharge's: nothing here sets it.
    expect(after.branches["n-qfs"]).toBeUndefined();
  });

  it("records the cut-test grams, and KOR then follows them when the Incharge approves", async () => {
    const id = (await createReceipt("BOUAKE")).id;
    createdReceipts.push(id);
    await setStageFields(id, "n-gate", { "VEHICLE NO.": "QFS-2" });
    await setStageFields(id, "n-verify", { "LBA CODE": SUPPLIER });
    const grams = { "Sample – Good Kernel (g)": "270", "Sample – Immature (g)": "30", "Sample – Spotted (g)": "20", "Sample – Void (g)": "12" };
    const res = await as(P + "qfs", "POST", `/api/receipts/${id}/submissions`, { values: { "n-qfs": { "MOIS. (moisture)": "10.3", ...grams } } });
    expect(res.statusCode).toBe(201);
    expect((await as(P + "wi", "POST", `/api/submissions/${res.json().id}/approve`)).statusCode).toBe(200);
    const after = (await as(P + "wi", "GET", `/api/receipts/${id}`)).json();
    expect(after.stageData["n-qfs"]).toMatchObject({ ...grams, KOR: "52.03" }); // (270 + ½ × 50) × 0.17637
  });

  it("refuses a typed KOR sent with the grams that decide it — at submit, where the submitter can fix it", async () => {
    const id = (await createReceipt("BOUAKE")).id;
    createdReceipts.push(id);
    await setStageFields(id, "n-verify", { "LBA CODE": SUPPLIER });
    const grams = { "Sample – Good Kernel (g)": "270", "Sample – Immature (g)": "30", "Sample – Spotted (g)": "20" };
    const res = await as(P + "qfs", "POST", `/api/receipts/${id}/submissions`, { values: { "n-qfs": { ...grams, KOR: "40" } } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/KOR is calculated/);
    // Grams already on the receipt count too: KOR typed alone afterwards is refused the same way.
    await setStageFields(id, "n-qfs", grams);
    const alone = await as(P + "qfs", "POST", `/api/receipts/${id}/submissions`, { values: { "n-qfs": { KOR: "40" } } });
    expect(alone.statusCode).toBe(422);
    // …and without grams a typed KOR is exactly what a 2026 truck has, and is accepted.
    const bare = (await createReceipt("BOUAKE")).id;
    createdReceipts.push(bare);
    await setStageFields(bare, "n-verify", { "LBA CODE": SUPPLIER });
    expect((await as(P + "qfs", "POST", `/api/receipts/${bare}/submissions`, { values: { "n-qfs": { KOR: "47.69" } } })).statusCode).toBe(201);
  });

  it("still refuses QFS a field outside its form, and the Pass/Fail decision itself", async () => {
    const other = (await createReceipt("BOUAKE")).id;
    createdReceipts.push(other);
    const outside = await as(P + "qfs", "POST", `/api/receipts/${other}/submissions`, { values: { "n-gross": { "GROSS WT KGS": "1" } } });
    expect(outside.statusCode).toBe(422);
    expect((await as(P + "qfs", "POST", `/api/receipts/${other}/branch`, { stageId: "n-qfs", branchId: "pass" })).statusCode).toBe(403);
  });
});

describe("supplier requests", () => {
  it("runs request → approval, adding the supplier and assigning it", async () => {
    const req = await as(P + "bm", "POST", "/api/supplier-requests", { name: "UM Requested Supplier", code: "UMTEST-REQ" });
    expect(req.statusCode).toBe(201);
    const id = req.json().id;
    expect((await as(P + "bm", "POST", `/api/supplier-requests/${id}/approve`)).statusCode).toBe(403);
    expect((await as(P + "wi", "POST", `/api/supplier-requests/${id}/approve`, {})).statusCode).toBe(200);
    expect((await prisma.supplier.findUnique({ where: { code: "UMTEST-REQ" } }))?.name).toBe("UM Requested Supplier");
    expect((await as(P + "bm", "GET", "/api/my-suppliers")).json().map((s: any) => s.code)).toContain("UMTEST-REQ");
  });
});
