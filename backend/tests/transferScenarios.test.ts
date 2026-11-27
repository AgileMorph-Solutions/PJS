/**
 * Two transfer flows end to end, as the Warehouse Incharges do them in the app (27 Nov 2026, user):
 *
 * 1. A lot is made from a Bin, half of it goes on a truck to the Central warehouse, and the rest is put back in the Bin.
 * 2. Two lots are made from a Bin, and one truck carries the first whole and half of the second.
 *
 * Through the HTTP routes, on throwaway warehouses, with a Bin holding real stock (an accepted truck's GRN), so every step
 * can be checked against the Bin's stock as the Warehouse activities page shows it, the lots as the Transfers page shows
 * them, and what reaches the Central warehouse's Reception.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, getReceipt, setBranch, setStageFields } from "../src/services/receipts.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const U = "TSCN-UNIT";
const C = "TSCN-CENTRAL";
const BIN = "TSCN-U-BIN-A";
const GRN = "GRN Weight (kept separate from Gross/Net/Paid)";
/** What the accepted truck put in the Bin. */
const STOCK_KG = 50_000;
const TODAY = new Date().toISOString().slice(0, 10);
const cookies: Record<string, string> = {};

const as = async (who: string, method: "GET" | "POST", url: string, payload?: unknown) => {
  const res = await app.inject({ method, url, payload: payload as object | undefined, headers: { cookie: cookies[who]! } });
  return { status: res.statusCode, body: res.statusCode === 204 ? null : res.json() };
};
/** The call must succeed: its answer, or the server's own words for why not. */
const ok = async (who: string, method: "GET" | "POST", url: string, payload?: unknown) => {
  const res = await as(who, method, url, payload);
  expect(res.status, `${method} ${url}: ${JSON.stringify(res.body)}`).toBeLessThan(300);
  return res.body;
};
/** The Bin's stock as the Warehouse activities page lists it. */
const binKg = async () => ((await ok("sender", "GET", `/api/bins?warehouse=${U}`)) as { binCode: string; kg: number }[]).find((b) => b.binCode === BIN)?.kg ?? 0;
const lotNow = async (id: number) => ((await ok("sender", "GET", `/api/transfer-lots?warehouse=${U}`)) as { id: number }[]).find((l) => l.id === id) as Record<string, any>;

let phone = 707070700;
/** A lot of `bags` from the Bin, weighed at net + 1 kg a bag on the scale, with its quality. */
async function weighedLot(bags: number, netKg: number) {
  const lot = await ok("sender", "POST", "/api/transfer-lots", { warehouse: U, lotDate: TODAY, bins: [{ binCode: BIN, bags }] });
  return ok("sender", "POST", `/api/transfer-lots/${lot.id}/weighing`, { grossWeightKg: String(netKg + bags), moisture: "9.5", kor: "46", nutCount: "180" });
}
/** A truck to the Central warehouse with these pieces of lots, dispatched with the loaded weight they add up to. */
async function truck(pieces: { lotId: number; bags: number }[], truckNo: string) {
  const t = await ok("sender", "POST", "/api/transfers", { transferDate: TODAY, fromWarehouse: U, toWarehouse: C, lines: pieces.map((p) => ({ transferLotId: p.lotId, bags: p.bags })) });
  const gross = (t.lines as { netWeightKg: number; bags: number }[]).reduce((a, l) => a + l.netWeightKg + l.bags, 0);
  return ok("sender", "POST", `/api/transfers/${t.id}/dispatch`, {
    whReceiptNo: "9101", truckNo, transporter: "KONE & FILS", driver: "Kone", driverPhone: String(++phone).padStart(10, "0"), dispatchedGrossKg: gross,
  });
}

async function cleanup() {
  const all = [U, C];
  await prisma.receipt.deleteMany({ where: { warehouse: { in: all } } });
  await prisma.transferRequest.deleteMany({ where: { OR: [{ fromWarehouse: { in: all } }, { toWarehouse: { in: all } }] } });
  await prisma.transferLotReturn.deleteMany({ where: { lot: { warehouse: { in: all } } } });
  await prisma.transferLot.deleteMany({ where: { warehouse: { in: all } } });
  await prisma.changeLog.deleteMany({ where: { user: { username: { startsWith: "tscn-" } } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "tscn-" } } });
  await prisma.bin.deleteMany({ where: { code: BIN } });
  await prisma.warehouse.deleteMany({ where: { name: { in: all } } });
}

beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: U, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "TSCU" } });
  await prisma.warehouse.create({ data: { name: C, kind: "FACTORY", type: "CENTRAL", code: "TSCC" } });
  await prisma.bin.create({ data: { code: BIN, warehouseName: U, source: "test" } });
  // The Bin's stock: a supplier truck that passed quality, unloaded into it, its GRN complete.
  const r = await createReceipt(U, TODAY);
  await setBranch(r.id, "n-qfs", "pass");
  await setStageFields(r.id, "n-bin", { "Bin Number": BIN }, { bypassValidation: true });
  await setStageFields(r.id, "n-grn", { [GRN]: String(STOCK_KG), PRICE: "470" }, { bypassValidation: true });
  for (const [key, wh] of [["sender", U], ["receiver", C]] as const) {
    await prisma.user.create({ data: { username: `tscn-${key}`, displayName: `TSCN ${key}`, role: "warehouse_incharge", warehouse: wh, passwordHash: hashPassword(PW) } });
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `tscn-${key}`, password: PW } });
    cookies[key] = String(res.headers["set-cookie"]).split(";")[0]!;
  }
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

describe("1. a lot from a Bin: half on a truck, the rest put back in the Bin", () => {
  let lotId = 0;
  let start = 0;

  it("makes the lot from the Bin, and takes it out of the Bin's stock once weighed", async () => {
    start = await binKg();
    expect(start).toBe(STOCK_KG);
    const lot = await weighedLot(200, 16_400); // 82 kg a bag
    lotId = lot.id;
    expect(lot).toMatchObject({ bags: 200, netKg: 16_400, status: "ready", leftBags: 200, leftKg: 16_400, bins: [{ binCode: BIN, bags: 200 }] });
    expect(await binKg()).toBe(start - 16_400);
  });

  it("sends half on a truck: 100 bags, their share of the weight by bags, with the lot's quality", async () => {
    const t = await truck([{ lotId, bags: 100 }], "TSCN-01");
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0]).toMatchObject({ transferLotId: lotId, bags: 100, netWeightKg: 8_200, moisture: 9.5, kor: 46, nutCount: 180 });
    expect(t.variance).toMatchObject({ bagsDispatched: 100, netDispatchedKg: 8_200 });
    expect(await lotNow(lotId)).toMatchObject({ status: "part_loaded", leftBags: 100, leftKg: 8_200 });
    // Still out of the Bin: the other half is on the warehouse floor, neither in the Bin nor on a truck.
    expect(await binKg()).toBe(start - 16_400);
  });

  it("puts the other half back in the Bin, at the weight the scale read for it; the lot is then done", async () => {
    const back = await ok("sender", "POST", `/api/transfer-lots/${lotId}/put-back`, { binCode: BIN, bags: 100, netWeightKg: "8150", date: TODAY });
    expect(back).toMatchObject({ status: "closed", leftBags: 0, returns: [{ binCode: BIN, bags: 100, netKg: 8_150 }] });
    // The Bin lost only what went on the truck, and what the put-back weighed less than its share (50 kg).
    expect(await binKg()).toBe(start - 16_400 + 8_150);
    // Nothing of it can go on another truck now.
    const more = await as("sender", "POST", "/api/transfers", { transferDate: TODAY, fromWarehouse: U, toWarehouse: C, lines: [{ transferLotId: lotId, bags: 1 }] });
    expect(more.status).toBe(422);
    expect(more.body.error).toMatch(/Nothing of this lot is left/);
  });

  it("arrives at the Central warehouse as the half that was sent, nothing of what was put back", async () => {
    const t = ((await ok("receiver", "GET", `/api/transfers?warehouse=${C}`)) as { id: string; truckNo: string }[]).find((x) => x.truckNo === "TSCN01")!;
    const { receiptIds } = await ok("receiver", "POST", `/api/transfers/${t.id}/receptions`);
    expect(receiptIds).toHaveLength(1);
    expect((await getReceipt(receiptIds[0]))!.transfer).toMatchObject({ fromWarehouse: U, sent: { bags: 100, netKg: 8_200, moisture: 9.5, kor: 46, nutCount: 180 } });
  });
});

describe("2. two lots from a Bin on one truck: the first whole, half of the second", () => {
  let first = 0;
  let second = 0;
  let start = 0;

  it("makes two lots from the same Bin, each out of its stock once weighed", async () => {
    start = await binKg();
    first = (await weighedLot(100, 8_200)).id;
    second = (await weighedLot(200, 16_400)).id;
    const lots = [await lotNow(first), await lotNow(second)];
    expect(lots.map((l) => l.lotNo)).toEqual([expect.stringMatching(/^LOT-TSCU-\d{4}-\d{4}$/), expect.stringMatching(/^LOT-TSCU-\d{4}-\d{4}$/)]);
    expect(lots[0].lotNo).not.toBe(lots[1].lotNo);
    expect(await binKg()).toBe(start - 8_200 - 16_400);
  });

  it("loads both on one truck: two lines, the first lot whole and 100 bags of the second", async () => {
    const t = await truck([{ lotId: first, bags: 100 }, { lotId: second, bags: 100 }], "TSCN-02");
    expect(t.lines).toHaveLength(2);
    expect(t.lines).toMatchObject([
      { transferLotId: first, bags: 100, netWeightKg: 8_200 },
      { transferLotId: second, bags: 100, netWeightKg: 8_200 },
    ]);
    expect(t.variance).toMatchObject({ bagsDispatched: 200, netDispatchedKg: 16_400 });
    expect(await lotNow(first)).toMatchObject({ status: "loaded", leftBags: 0, leftKg: 0 });
    expect(await lotNow(second)).toMatchObject({ status: "part_loaded", leftBags: 100, leftKg: 8_200 });
  });

  it("won't load more of either than is left: the first is all gone, the second has 100 bags", async () => {
    const firstAgain = await as("sender", "POST", "/api/transfers", { transferDate: TODAY, fromWarehouse: U, toWarehouse: C, lines: [{ transferLotId: first, bags: 1 }] });
    expect(firstAgain.body.error).toMatch(/Nothing of this lot is left/);
    const tooMuch = await as("sender", "POST", "/api/transfers", { transferDate: TODAY, fromWarehouse: U, toWarehouse: C, lines: [{ transferLotId: second, bags: 101 }] });
    expect(tooMuch.body.error).toMatch(/Only 100 bags of this lot are left/);
  });

  it("arrives at the Central warehouse as one reception per lot on the truck, each with what was sent of it", async () => {
    const t = ((await ok("receiver", "GET", `/api/transfers?warehouse=${C}`)) as { id: string; truckNo: string }[]).find((x) => x.truckNo === "TSCN02")!;
    const { receiptIds } = await ok("receiver", "POST", `/api/transfers/${t.id}/receptions`);
    expect(receiptIds).toHaveLength(2);
    const sent = await Promise.all((receiptIds as string[]).map(async (id) => (await getReceipt(id))!.transfer));
    expect(sent).toMatchObject([
      { truckNo: "TSCN02", sent: { bags: 100, netKg: 8_200 } },
      { truckNo: "TSCN02", sent: { bags: 100, netKg: 8_200 } },
    ]);
    expect(sent[0]!.sentAs).not.toBe(sent[1]!.sentAs);
  });

  it("can still send the rest of the second lot on another truck", async () => {
    const t = await truck([{ lotId: second, bags: 100 }], "TSCN-03");
    expect(t.lines[0]).toMatchObject({ transferLotId: second, bags: 100, netWeightKg: 8_200 });
    expect(await lotNow(second)).toMatchObject({ status: "loaded", leftBags: 0 });
    // The Bin gave the two lots once, whatever trucks they went on.
    expect(await binKg()).toBe(start - 8_200 - 16_400);
  });
});
