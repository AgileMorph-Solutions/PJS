/**
 * The change log (audit/changeLog.ts): every save outside a truck's steps is logged, against the person whose request made
 * it, inside the save's own transaction. The guards here are for what would go wrong silently: a log naming the wrong person
 * or no one, a rolled-back save that still left rows, a warehouse reading another's changes, and a secret written in clear.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { prisma as logged } from "../src/db.js";
import { createReceipt, setBranch, setStageFields } from "../src/services/receipts.js";
import { viaForPath, withAudit } from "../src/audit/context.js";
import { fieldLabel } from "../src/audit/labels.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const A = "CLTEST-A";
const B = "CLTEST-B";
const C = "CLTEST-C";
const D = "2034-04-04";
const cookies: Record<string, string> = {};
const as = (u: string, method: "GET" | "POST", url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as any, headers: { cookie: cookies[u]! } });

const logOf = (entity: string, recordId?: string) =>
  prisma.changeLog.findMany({ where: { entity, ...(recordId ? { recordId: { startsWith: recordId } } : {}) }, orderBy: { id: "asc" } });

async function cleanup() {
  const bkts = (await prisma.transferRequest.findMany({ where: { fromWarehouse: { in: [A, B, C] } }, select: { id: true } })).map((t) => t.id);
  await prisma.changeLog.deleteMany({ where: { OR: [{ warehouses: { hasSome: [A, B, C] } }, ...bkts.map((id) => ({ recordId: { startsWith: id } })), { recordId: { startsWith: "cltest-" } }] } });
  await prisma.transferRequest.deleteMany({ where: { fromWarehouse: { in: [A, B, C] } } });
  await prisma.receipt.deleteMany({ where: { warehouse: { in: [A, B, C] } } });
  await prisma.changeLog.deleteMany({ where: { user: { username: { startsWith: "cltest-" } } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "cltest-" } } });
  await prisma.warehouse.deleteMany({ where: { name: { in: [A, B, C] } } });
}

/** A Lot at A that passed quality, 200 bags / 39,800 kg, marked to transfer. */
async function lot(): Promise<string> {
  const id = (await createReceipt(A, D)).id;
  await setStageFields(id, "n-qfs", { "Final moisture (%)": "10", KOR: "47", "Final nut count": "170" });
  await setBranch(id, "n-qfs", "pass");
  await setStageFields(id, "n-unload", { "SACS (bags)": "200" }, { bypassValidation: true });
  await setStageFields(id, "n-netwt", { "NET WT KGS": "39800" }, { bypassValidation: true });
  await setBranch(id, "n-xferdec", "transfer");
  return id;
}

let senderId = "";
beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: A, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "CLA1" } });
  await prisma.warehouse.create({ data: { name: B, kind: "FACTORY", type: "CENTRAL", code: "CLB1" } });
  await prisma.warehouse.create({ data: { name: C, kind: "FACTORY", type: "CENTRAL", code: "CLC1" } });
  for (const [key, wh] of [["sender", A], ["receiver", B], ["stranger", C]] as const) {
    const u = await prisma.user.create({ data: { username: `cltest-${key}`, displayName: `cl ${key}`, role: "warehouse_incharge", warehouse: wh, passwordHash: hashPassword(PW) } });
    if (key === "sender") senderId = u.id;
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `cltest-${key}`, password: PW } });
    expect(res.statusCode, key).toBe(200);
    cookies[key] = String(res.headers["set-cookie"]).split(";")[0]!;
  }
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("a save through the app is logged against whoever made it", () => {
  let bkt = "";
  let receiptId = "";

  it("logs a new BKT and the amount of each Lot on it, by the sender", async () => {
    receiptId = await lot();
    const res = await as("sender", "POST", "/api/transfers", { transferDate: D, toWarehouse: B, lines: [{ receiptId, bags: 150, netWeightKg: 30000 }] });
    expect(res.statusCode).toBe(201);
    bkt = res.json().id;

    const line = await logOf("TransferRequestLine", bkt);
    expect(line.map((r) => [r.action, r.field, r.oldValue, r.newValue])).toEqual(expect.arrayContaining([
      ["create", "bags", null, "150"],
      ["create", "netWeightKg", null, "30000"],
    ]));
    expect(line.every((r) => r.userId === senderId && r.via === "direct" && r.recordId === `${bkt} · ${receiptId}`)).toBe(true);
    // A BKT belongs to both ends, so both can read its log.
    expect(line[0]!.warehouses.sort()).toEqual([A, B]);
    expect((await logOf("TransferRequest", bkt)).some((r) => r.field === "toWarehouse" && r.newValue === B)).toBe(true);
  });

  it("logs each field a dispatch changed: old → new", async () => {
    const res = await as("sender", "POST", `/api/transfers/${bkt}/dispatch`, { whReceiptNo: "WR-1", truckNo: "CL-RIG", transporter: "T", driver: "Kone", driverPhone: "01", dispatchedGrossKg: 30150 });
    expect(res.statusCode).toBe(200);
    const header = await logOf("TransferRequest", bkt);
    const updates = header.filter((r) => r.action === "update");
    expect(updates.map((r) => [r.field, r.oldValue, r.newValue])).toEqual(expect.arrayContaining([
      ["status", "requested", "dispatched"], ["truckNo", null, "CL-RIG"], ["driver", null, "Kone"], ["dispatchedGrossKg", null, "30150"],
    ]));
    // Timestamps say nothing a person chose.
    expect(updates.some((r) => r.field === "updatedAt")).toBe(false);
  });

  it("a truck's steps aren't logged twice: they have their own history", async () => {
    expect(await prisma.changeLog.count({ where: { entity: { startsWith: "Stage" }, recordId: receiptId } })).toBe(0);
  });

  it("the receiving warehouse reads the BKT's changes; a third warehouse reads none of them", async () => {
    const mine = (await as("receiver", "GET", `/api/change-log?from=2000-01-01`)).json() as { recordId: string | null; fieldLabel: string | null }[];
    expect(mine.some((r) => r.recordId?.startsWith(bkt))).toBe(true);
    // Columns read as on the screen.
    expect(mine.some((r) => r.fieldLabel === "Net weight (kg)")).toBe(true);
    const theirs = (await as("stranger", "GET", `/api/change-log?from=2000-01-01`)).json() as { recordId: string | null }[];
    expect(theirs.some((r) => r.recordId?.startsWith(bkt))).toBe(false);
  });
});

describe("what the log never does", () => {
  it("keeps no row for a save that was rolled back", async () => {
    const good = await lot();
    const before = await prisma.changeLog.count({ where: { entity: "TransferRequest" } });
    // The second line is refused after the BKT and its first line were written inside the same transaction.
    const res = await as("sender", "POST", "/api/transfers", { transferDate: D, toWarehouse: B, lines: [{ receiptId: good, bags: 10, netWeightKg: 1000 }, { receiptId: "REC-NO-SUCH", bags: 1 }] });
    expect(res.statusCode).toBe(422);
    expect(await prisma.changeLog.count({ where: { entity: "TransferRequest" } })).toBe(before);
    expect(await prisma.changeLog.count({ where: { entity: "TransferRequestLine", recordId: { contains: good } } })).toBe(0);
  });

  it("never writes a password, only that it changed", async () => {
    const u = await withAudit({ userId: senderId, via: "direct" }, async () => {
      const made = await logged.user.create({ data: { username: "cltest-pw", displayName: "pw", role: "admin", passwordHash: hashPassword("first-pass-1") } });
      await logged.user.update({ where: { id: made.id }, data: { passwordHash: hashPassword("second-pass-2") } });
      return made;
    });
    const rows = await prisma.changeLog.findMany({ where: { entity: "User", recordId: u.id, field: "passwordHash" } });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.oldValue === null && r.newValue === "(changed)")).toBe(true);
    // A user belongs to no warehouse: only an admin reads their log.
    expect(rows.every((r) => r.userId === senderId && r.warehouses.length === 0)).toBe(true);
    await prisma.changeLog.deleteMany({ where: { entity: "User", recordId: u.id } });
  });

  it("logs only a person's changes: a write nobody signed in made (scripts, the seeder) leaves no row", async () => {
    const u = await logged.user.create({ data: { username: "cltest-script", displayName: "script", role: "admin", passwordHash: hashPassword("script-pass-1") } });
    await logged.user.update({ where: { id: u.id }, data: { displayName: "script 2" } });
    expect(await prisma.changeLog.count({ where: { recordId: u.id } })).toBe(0);
  });
});

describe("how a request writes, and how a column reads", () => {
  it("an upload's commit is an upload, an approve is an approved form, the rest a direct edit", () => {
    expect(viaForPath("POST", "/api/workbook/abc123/commit")).toBe("import");
    expect(viaForPath("POST", "/api/production/workbook/abc/commit")).toBe("import");
    expect(viaForPath("POST", "/api/submissions/42/approve")).toBe("approval");
    expect(viaForPath("POST", "/api/production/factory-lots/F1/entries/approve-all")).toBe("approval");
    expect(viaForPath("POST", "/api/transfers")).toBe("direct");
  });

  it("names a column the way its screen does, and any other in plain words", () => {
    expect(fieldLabel("TransferRequestLine", "netWeightKg", null)).toBe("Net weight (kg)");
    expect(fieldLabel("DeliveryPlan", "expectedQuantityKg", null)).toBe("Expected quantity (kg)");
    expect(fieldLabel("ReceiptBranch", "branchId", "REC-1 · n-qfs")).toMatch(/^Decision: /);
  });
});
