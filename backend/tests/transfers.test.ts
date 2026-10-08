/**
 * The client's BKT rules, Oct 2026: one BKT is one truck / voyage; Bouaké records what it SENDS, and
 * only the receiving warehouse records what ARRIVES (blank until then), after which the system works
 * out the variance and the in-transit / closed / discrepancy state. Through the service layer and the
 * HTTP layer (who may dispatch, who may receive), on throwaway warehouses.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, setBranch, setStageFields } from "../src/services/receipts.js";
import { createTransfer, dispatchTransfer, receiveTransfer, getTransfer, addTransferLines } from "../src/services/transfers.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const A = "BKTTEST-A";
const B = "BKTTEST-B";
const C = "BKTTEST-C";
const BIN1 = "BKTTEST-A-STORE-BIN-001";
const BIN2 = "BKTTEST-A-STORE-BIN-002";
const D = "2033-03-03";
const cookies: Record<string, string> = {};
const as = (u: string, method: "GET" | "POST", url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as any, headers: { cookie: cookies[u]! } });

async function cleanup() {
  await prisma.transferRequest.deleteMany({ where: { OR: [{ fromWarehouse: { in: [A, B, C] } }, { toWarehouse: { in: [A, B, C] } }] } });
  await prisma.receipt.deleteMany({ where: { warehouse: { in: [A, B, C] } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "bkttest-" } } });
  await prisma.bin.deleteMany({ where: { code: { in: [BIN1, BIN2] } } });
  await prisma.warehouse.deleteMany({ where: { site: { in: [A, B, C] } } });
  await prisma.warehouse.deleteMany({ where: { name: { in: [A, B, C] } } });
}

/** A Lot that passed quality at A, with 100 bags — ready to put on a truck. */
async function lot(bin?: string, bags = 100): Promise<string> {
  const id = (await createReceipt(A, D)).id;
  await setBranch(id, "n-qfs", "pass");
  if (bin) await setStageFields(id, "n-bin", { "Bin Number": bin });
  void bags;
  return id;
}

beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: A, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "BKA1" } });
  await prisma.warehouse.create({ data: { name: B, kind: "FACTORY", type: "CENTRAL", code: "BKB1" } });
  await prisma.warehouse.create({ data: { name: C, kind: "FACTORY", type: "CENTRAL", code: "BKC1" } });
  await prisma.bin.createMany({ data: [{ code: BIN1, source: "test" }, { code: BIN2, source: "test" }] });
  for (const [key, role, wh] of [["sender", "warehouse_incharge", A], ["receiver", "warehouse_incharge", B], ["stranger", "warehouse_incharge", C], ["bm", "branch_manager", A], ["admin", "admin", null]] as const) {
    await prisma.user.create({ data: { username: `bkttest-${key}`, displayName: key, role, warehouse: wh, passwordHash: hashPassword(PW) } });
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `bkttest-${key}`, password: PW } });
    expect(res.statusCode, key).toBe(200);
    cookies[key] = String(res.headers["set-cookie"]).split(";")[0]!;
  }
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("a BKT is one truck, sent and then received", () => {
  it("takes the Lots' Bin(s) onto each line, so a truck loaded from several Bins shows them all", async () => {
    const a = await lot(BIN1);
    const b = await lot(`${BIN1} / ${BIN2}`);
    const t = await createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines: [{ receiptId: a, bags: 344 }, { receiptId: b, bags: 150 }] });
    expect(t.lines.map((l) => l.binCode)).toEqual([BIN1, `${BIN1} / ${BIN2}`]);
  });

  it("can't be dispatched without a truck — one BKT is one truck — or without Lots", async () => {
    const t = await createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines: [{ receiptId: await lot(), bags: 10 }] });
    await expect(dispatchTransfer(t.id, {})).rejects.toThrow(/truck number/);
    await expect(dispatchTransfer(t.id, { truckNo: "   " })).rejects.toThrow(/truck number/);
  });

  it("records what leaves on the header, and leaves everything about arrival blank", async () => {
    const t = await createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines: [{ receiptId: await lot(), bags: 590 }] });
    const sent = await dispatchTransfer(t.id, { truckNo: "SENT-RIG-1", transporter: "KONE & FILS", driver: "Kone", driverPhone: "0102030405", dispatchedGrossKg: 48880 });
    expect(sent).toMatchObject({
      status: "dispatched", state: "in_transit", truckNo: "SENT-RIG-1", transporter: "KONE & FILS", dispatchedGrossKg: 48880,
      // The point the client made: nothing about arrival exists at dispatch.
      bagsReceived: null, receivedGrossKg: null, receivedAt: null, damagedBags: null,
      variance: { bagsDispatched: 590, netDispatchedKg: 48290, bagsReceived: null, bagVariance: null, netAtArrivalKg: null, weightVarianceKg: null },
    });
    expect(sent.dispatchedAt).not.toBeNull();
  });

  it("reproduces the client's BKT001 on arrival: −16 bags, −44 kg, a discrepancy", async () => {
    const t = await createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines: [{ receiptId: await lot(), bags: 590 }] });
    await dispatchTransfer(t.id, { truckNo: "BKT001-RIG", dispatchedGrossKg: 48880 });
    const got = await receiveTransfer(t.id, { bagsReceived: 574, receivedGrossKg: 48820, damagedBags: 3, korReceived: 47.2, moistureReceived: 9.8, nutCountReceived: 172, receivedComment: "short", receivedLotNoRaw: "LOT-YAK-2026-0002" });
    expect(got).toMatchObject({
      status: "received", state: "discrepancy", bagsReceived: 574, damagedBags: 3, receivedGrossKg: 48820, korReceived: 47.2, receivedLotNoRaw: "LOT-YAK-2026-0002",
      variance: { bagVariance: -16, netDispatchedKg: 48290, netAtArrivalKg: 48246, weightVarianceKg: -44 },
    });
    expect(got.receivedAt).not.toBeNull();
  });

  it("closes when what arrived matches what left", async () => {
    const t = await createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines: [{ receiptId: await lot(), bags: 500 }] });
    await dispatchTransfer(t.id, { truckNo: "CLOSE-RIG", dispatchedGrossKg: 40500 });
    expect((await receiveTransfer(t.id, { bagsReceived: 500, receivedGrossKg: 40500 })).state).toBe("closed");
  });

  it("needs the arrival's bags and gross weight, sane damaged bags, and a dispatched truck", async () => {
    const t = await createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines: [{ receiptId: await lot(), bags: 100 }] });
    await expect(receiveTransfer(t.id, { bagsReceived: 100, receivedGrossKg: 9000 })).rejects.toThrow(/hasn't been dispatched/);
    await dispatchTransfer(t.id, { truckNo: "NEED-RIG" });
    await expect(receiveTransfer(t.id, { receivedGrossKg: 9000 })).rejects.toThrow(/bags received/);
    await expect(receiveTransfer(t.id, { bagsReceived: 100 })).rejects.toThrow(/gross weight/);
    await expect(receiveTransfer(t.id, { bagsReceived: "9.5", receivedGrossKg: 9000 })).rejects.toThrow(/whole number/);
    await expect(receiveTransfer(t.id, { bagsReceived: 10, damagedBags: 11, receivedGrossKg: 900 })).rejects.toThrow(/More damaged bags/);
    expect((await getTransfer(t.id))!.status).toBe("dispatched"); // nothing half-written
  });

  it("a truck can't be on two voyages at once, but is free again once its BKT has arrived", async () => {
    const t1 = await createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines: [{ receiptId: await lot(), bags: 10 }] });
    const t2 = await createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines: [{ receiptId: await lot(), bags: 10 }] });
    await dispatchTransfer(t1.id, { truckNo: "1796 GC 01 / 3922-BB-04" });
    await expect(dispatchTransfer(t2.id, { truckNo: "1796GC01/3922BB04" })).rejects.toThrow(new RegExp(`still on ${t1.id}`)); // same rig, spelled differently
    await receiveTransfer(t1.id, { bagsReceived: 10, receivedGrossKg: 10 });
    expect((await dispatchTransfer(t2.id, { truckNo: "1796GC01/3922BB04" })).status).toBe("dispatched");
  });

  it("puts the voyage on each Lot's own timeline", async () => {
    const id = await lot();
    const t = await createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines: [{ receiptId: id, bags: 10 }] });
    await dispatchTransfer(t.id, { truckNo: "TL-RIG" });
    await receiveTransfer(t.id, { bagsReceived: 10, receivedGrossKg: 10 });
    const notes = (await prisma.timelineEntry.findMany({ where: { receiptId: id }, orderBy: { id: "asc" } })).map((e) => e.note);
    expect(notes.slice(-3)).toEqual([`Added to transfer ${t.id}`, `Dispatched on ${t.id} (truck TL-RIG)`, `Received at ${B} on ${t.id}`]);
  });

  it("can't take more Lots once it has left", async () => {
    const t = await createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines: [{ receiptId: await lot(), bags: 10 }] });
    await dispatchTransfer(t.id, { truckNo: "LATE-RIG" });
    await expect(addTransferLines(t.id, [{ receiptId: await lot() }])).rejects.toThrow(/already dispatched/);
  });
});

describe("each warehouse writes only its own half", () => {
  let id: string;
  beforeAll(async () => {
    const r = await as("sender", "POST", "/api/transfers", { transferDate: D, toWarehouse: B, lines: [{ receiptId: await lot(), bags: 590 }] });
    expect(r.statusCode).toBe(201);
    id = r.json().id;
  });

  it("only the sending warehouse dispatches", async () => {
    const body = { truckNo: "HTTP-RIG", dispatchedGrossKg: 48880 };
    expect((await as("receiver", "POST", `/api/transfers/${id}/dispatch`, body)).statusCode).toBe(403);
    expect((await as("stranger", "POST", `/api/transfers/${id}/dispatch`, body)).statusCode).toBe(403);
    expect((await as("sender", "POST", `/api/transfers/${id}/dispatch`, body)).statusCode).toBe(200);
  });

  it("only the destination records the arrival — the sender can't fill in what 'arrived'", async () => {
    const body = { bagsReceived: 574, receivedGrossKg: 48820 };
    expect((await as("sender", "POST", `/api/transfers/${id}/receive`, body)).statusCode).toBe(403);
    expect((await as("stranger", "POST", `/api/transfers/${id}/receive`, body)).statusCode).toBe(403);
    const ok = await as("receiver", "POST", `/api/transfers/${id}/receive`, body);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ state: "discrepancy", variance: { bagVariance: -16, weightVarianceKg: -44 } });
  });

  it("a refusal is a plain 422, not a crash", async () => {
    const res = await as("receiver", "POST", `/api/transfers/${id}/receive`, { bagsReceived: 1, receivedGrossKg: 1 });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/already received/);
  });

  it("both ends can read the BKT — the receiving warehouse sees the Lots it is getting — and a third warehouse can't", async () => {
    const mine = await as("receiver", "GET", `/api/transfers/${id}`);
    expect(mine.statusCode).toBe(200);
    expect(mine.json().lines[0]).toMatchObject({ bags: 590, lotNumber: expect.stringMatching(/^LOT-BKA1-/) });
    expect((await as("sender", "GET", `/api/transfers/${id}`)).statusCode).toBe(200);
    expect((await as("stranger", "GET", `/api/transfers/${id}`)).statusCode).toBe(403);
    expect((await as("stranger", "GET", "/api/transfers")).json()).toEqual([]);
  });

  it("an admin can do either half, and a Branch Manager can't touch transfers at all", async () => {
    const r = await as("admin", "POST", "/api/transfers", { transferDate: D, fromWarehouse: A, toWarehouse: B, lines: [{ receiptId: await lot(), bags: 5 }] });
    const t = r.json().id;
    expect((await as("admin", "POST", `/api/transfers/${t}/dispatch`, { truckNo: "ADMIN-RIG" })).statusCode).toBe(200);
    expect((await as("admin", "POST", `/api/transfers/${t}/receive`, { bagsReceived: 5, receivedGrossKg: 5 })).statusCode).toBe(200);
    expect((await as("bm", "GET", "/api/transfers")).statusCode).toBe(403);
    expect((await as("bm", "POST", `/api/transfers/${t}/dispatch`, { truckNo: "X" })).statusCode).toBe(403);
  });

  it("the old one-button status step is gone — it could dispatch a BKT with no truck", async () => {
    expect((await as("sender", "POST", `/api/transfers/${id}`, {})).statusCode).toBe(404);
  });
});
