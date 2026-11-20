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
import { createTransfer, dispatchTransfer as dispatchInto, receiveTransfer as receiveInto, getTransfer, addTransferLines, type DispatchInput, type ReceiveInput } from "../src/services/transfers.js";
import { listAvailableBins, procurementBinStock } from "../src/services/production/batches.js";
import { getReceiptLinks } from "../src/services/receiptLinks.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const A = "BKTTEST-A";
const B = "BKTTEST-B";
const C = "BKTTEST-C";
/** A second Unit warehouse: its people must never learn the number of A's BKTs. */
const E = "BKTTEST-E";
/** E's own destination, so its BKT shows in nobody else's list. */
const F = "BKTTEST-F";
const BIN1 = "BKTTEST-A-STORE-BIN-001";
const BIN2 = "BKTTEST-A-STORE-BIN-002";
const D = "2033-03-03";
const B_STORE = "BKTTEST-B-STORE";
const B_BIN = "BKTTEST-B-STORE-BIN-001";
const cookies: Record<string, string> = {};
const as = (u: string, method: "GET" | "POST", url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as any, headers: { cookie: cookies[u]! } });

async function cleanup() {
  await prisma.transferRequest.deleteMany({ where: { OR: [{ fromWarehouse: { in: [A, B, C, E, F] } }, { toWarehouse: { in: [A, B, C, E, F] } }] } });
  await prisma.receipt.deleteMany({ where: { warehouse: { in: [A, B, C, E, F] } } });
  // The change log keeps what these test users did over HTTP; it goes with them, or it would read as a deleted user's.
  await prisma.changeLog.deleteMany({ where: { user: { username: { startsWith: "bkttest-" } } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "bkttest-" } } });
  await prisma.bin.deleteMany({ where: { code: { in: [BIN1, BIN2, B_BIN] } } });
  await prisma.warehouse.deleteMany({ where: { site: { in: [A, B, C, E, F] } } });
  await prisma.warehouse.deleteMany({ where: { name: { in: [A, B, C, E, F] } } });
}

/** Who drives it: required to dispatch, and the same on every test truck. */
const CREW = { transporter: "KONE & FILS", driver: "Kone", driverPhone: "0102030405" };

/**
 * Dispatch with the crew filled in, and — unless the test gives one — a loaded weight of 1 kg per bag (0 kg of RCN), which
 * the tests' "N bags, N kg" arrivals match. The required-fields rule has its own test below.
 */
async function dispatchTransfer(id: string, input: DispatchInput) {
  if ("dispatchedGrossKg" in input) return dispatchInto(id, { ...CREW, ...input });
  const bags = ((await getTransfer(id))?.lines ?? []).reduce((a, l) => a + (l.bags ?? 0), 0);
  return dispatchInto(id, { ...CREW, dispatchedGrossKg: bags, ...input });
}

/** Receive with every Lot unloaded into one bin — the bin rule has its own tests below. */
async function receiveTransfer(id: string, input: ReceiveInput) {
  const t = await getTransfer(id);
  return receiveInto(id, { lines: (t?.lines ?? []).map((l) => ({ receiptId: l.receiptId, binCode: B_BIN })), ...input });
}
const bins = async (id: string) => (await getTransfer(id))!.lines.map((l) => ({ receiptId: l.receiptId, binCode: B_BIN }));

/** A Lot that passed quality at A (or `at`), with 100 bags — ready to put on a truck. */
async function lot(bin?: string, bags = 100, at = A): Promise<string> {
  const id = (await createReceipt(at, D)).id;
  // The quality check's result, which a dispatch takes unless it is measured again.
  await setStageFields(id, "n-qfs", { "Final moisture (%)": "10.2", KOR: "47.5", "Final nut count": "170" });
  await setBranch(id, "n-qfs", "pass");
  if (bin) await setStageFields(id, "n-bin", { "Bin Number": bin });
  await setBranch(id, "n-xferdec", "transfer");
  void bags;
  return id;
}

beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: A, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "BKA1" } });
  await prisma.warehouse.create({ data: { name: B, kind: "FACTORY", type: "CENTRAL", code: "BKB1" } });
  await prisma.warehouse.create({ data: { name: C, kind: "FACTORY", type: "CENTRAL", code: "BKC1" } });
  await prisma.warehouse.create({ data: { name: E, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "BKE9" } });
  await prisma.warehouse.create({ data: { name: F, kind: "FACTORY", type: "CENTRAL", code: "BKF9" } });
  await prisma.bin.createMany({ data: [{ code: BIN1, source: "test" }, { code: BIN2, source: "test" }] });
  await prisma.warehouse.create({ data: { name: B_STORE, site: B } });
  await prisma.bin.create({ data: { code: B_BIN, warehouseName: B_STORE, source: "test" } });
  for (const [key, role, wh] of [["sender", "warehouse_incharge", A], ["receiver", "warehouse_incharge", B], ["stranger", "warehouse_incharge", C], ["otherSender", "warehouse_incharge", E], ["bm", "branch_manager", A], ["admin", "admin", null]] as const) {
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
    await expect(dispatchTransfer(t.id, { whReceiptNo: "WR-D", truckNo: "   " })).rejects.toThrow(/truck number/);
  });

  it("records what leaves on the header, and leaves everything about arrival blank", async () => {
    const t = await createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines: [{ receiptId: await lot(), bags: 590 }] });
    const sent = await dispatchTransfer(t.id, { whReceiptNo: "WR-D", truckNo: "SENT-RIG-1", transporter: "KONE & FILS", driver: "Kone", driverPhone: "0102030405", dispatchedGrossKg: 48880 });
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
    await dispatchTransfer(t.id, { whReceiptNo: "WR-D", truckNo: "BKT001-RIG", dispatchedGrossKg: 48880 });
    const got = await receiveTransfer(t.id, { whReceiptNo: "WR-R", bagsReceived: 574, receivedGrossKg: 48820, damagedBags: 3, korReceived: 47.2, moistureReceived: 9.8, nutCountReceived: 172, receivedComment: "short", receivedLotNoRaw: "LOT-YAK-2026-0002" });
    expect(got).toMatchObject({
      status: "received", state: "discrepancy", bagsReceived: 574, damagedBags: 3, receivedGrossKg: 48820, korReceived: 47.2, receivedLotNoRaw: "LOT-YAK-2026-0002",
      variance: { bagVariance: -16, netDispatchedKg: 48290, netAtArrivalKg: 48246, weightVarianceKg: -44 },
    });
    expect(got.receivedAt).not.toBeNull();
  });

  it("closes when what arrived matches what left", async () => {
    const t = await createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines: [{ receiptId: await lot(), bags: 500 }] });
    await dispatchTransfer(t.id, { whReceiptNo: "WR-D", truckNo: "CLOSE-RIG", dispatchedGrossKg: 40500 });
    expect((await receiveTransfer(t.id, { whReceiptNo: "WR-R", bagsReceived: 500, receivedGrossKg: 40500 })).state).toBe("closed");
  });

  it("needs the arrival's bags and gross weight, sane damaged bags, and a dispatched truck", async () => {
    const t = await createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines: [{ receiptId: await lot(), bags: 100 }] });
    await expect(receiveTransfer(t.id, { whReceiptNo: "WR-R", bagsReceived: 100, receivedGrossKg: 9000 })).rejects.toThrow(/hasn't been dispatched/);
    await dispatchTransfer(t.id, { whReceiptNo: "WR-D", truckNo: "NEED-RIG" });
    await expect(receiveTransfer(t.id, { whReceiptNo: "WR-R", receivedGrossKg: 9000 })).rejects.toThrow(/bags received/);
    await expect(receiveTransfer(t.id, { whReceiptNo: "WR-R", bagsReceived: 100 })).rejects.toThrow(/gross weight/);
    await expect(receiveTransfer(t.id, { whReceiptNo: "WR-R", bagsReceived: "9.5", receivedGrossKg: 9000 })).rejects.toThrow(/whole number/);
    await expect(receiveTransfer(t.id, { whReceiptNo: "WR-R", bagsReceived: 10, damagedBags: 11, receivedGrossKg: 900 })).rejects.toThrow(/More damaged bags/);
    expect((await getTransfer(t.id))!.status).toBe("dispatched"); // nothing half-written
  });

  it("a truck can't be on two voyages at once, but is free again once its BKT has arrived", async () => {
    const t1 = await createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines: [{ receiptId: await lot(), bags: 10 }] });
    const t2 = await createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines: [{ receiptId: await lot(), bags: 10 }] });
    await dispatchTransfer(t1.id, { whReceiptNo: "WR-D", truckNo: "1796 GC 01 / 3922-BB-04" });
    await expect(dispatchTransfer(t2.id, { whReceiptNo: "WR-D", truckNo: "1796GC01/3922BB04" })).rejects.toThrow(new RegExp(`still on ${t1.id}`)); // same rig, spelled differently
    await receiveTransfer(t1.id, { whReceiptNo: "WR-R", bagsReceived: 10, receivedGrossKg: 10 });
    expect((await dispatchTransfer(t2.id, { whReceiptNo: "WR-D", truckNo: "1796GC01/3922BB04" })).status).toBe("dispatched");
  });

  it("names and links the BKT the truck is still on only for people who may open it", async () => {
    const out = await createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines: [{ receiptId: await lot(), bags: 10 }] });
    await dispatchTransfer(out.id, { whReceiptNo: "WR-D", truckNo: "SHARED-RIG" });
    const send = { whReceiptNo: "WR-D", truckNo: "shared rig", ...CREW, dispatchedGrossKg: 10 };

    // A's own Incharge sent it: the message names it, and the detail says which sections list it (A's and B's).
    const mine = await createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines: [{ receiptId: await lot(), bags: 10 }] });
    const res = await as("sender", "POST", `/api/transfers/${mine.id}/dispatch`, send);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe(
      `Truck shared rig can't be dispatched yet: it is still on ${out.id}, which hasn't been received at ${B}. ` +
      `A truck carries one BKT at a time. Record the arrival on ${out.id} first, or check the truck number.`,
    );
    expect(res.json().detail).toEqual({ kind: "truck_on_the_road", transferId: out.id, sites: [A, B] });

    // Another Unit warehouse's Incharge using the same truck number: refused too, but never told A's BKT number.
    const theirs = await createTransfer({ transferDate: D, fromWarehouse: E, toWarehouse: F, lines: [{ receiptId: await lot(undefined, 100, E), bags: 10 }] });
    const other = await as("otherSender", "POST", `/api/transfers/${theirs.id}/dispatch`, send);
    expect(other.statusCode).toBe(422);
    expect(other.json().error).toMatch(/still on another warehouse's BKT/);
    expect(other.json().error).not.toContain(out.id);
    expect(other.json().detail).toBeUndefined();
    // And the BKT itself stays closed to them.
    expect((await as("otherSender", "GET", `/api/transfers/${out.id}`)).statusCode).toBe(403);
  });

  it("puts the voyage on each Lot's own timeline", async () => {
    const id = await lot();
    const t = await createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines: [{ receiptId: id, bags: 10 }] });
    await dispatchTransfer(t.id, { whReceiptNo: "WR-D", truckNo: "TL-RIG" });
    await receiveTransfer(t.id, { whReceiptNo: "WR-R", bagsReceived: 10, receivedGrossKg: 10 });
    const notes = (await prisma.timelineEntry.findMany({ where: { receiptId: id }, orderBy: { id: "asc" } })).map((e) => e.note);
    expect(notes.slice(-3)).toEqual([`Added to transfer ${t.id}`, `Dispatched on ${t.id} (truck TL-RIG)`, `Received at ${B} on ${t.id}, into ${B_BIN}`]);
  });

  it("can't take more Lots once it has left", async () => {
    const t = await createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines: [{ receiptId: await lot(), bags: 10 }] });
    await dispatchTransfer(t.id, { whReceiptNo: "WR-D", truckNo: "LATE-RIG" });
    await expect(addTransferLines(t.id, [{ receiptId: await lot() }])).rejects.toThrow(/already dispatched/);
  });
});

describe("the receipt's Yes / No decides whether a Lot can go on a BKT", () => {
  const send = (receiptId: string) => createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines: [{ receiptId, bags: 10 }] });

  it("refuses a Lot marked 'No — stays', and one nobody has decided on", async () => {
    const stays = await lot();
    await setBranch(stays, "n-xferdec", "stays");
    await expect(send(stays)).rejects.toThrow(/isn't marked for transfer/);

    const undecided = (await createReceipt(A, D)).id;
    await setBranch(undecided, "n-qfs", "pass");
    await expect(send(undecided)).rejects.toThrow(/isn't marked for transfer/);
  });

  it("'Yes' alone creates no BKT, and changing back to 'No' before one exists is allowed", async () => {
    const id = await lot();
    expect(await prisma.transferRequestLine.count({ where: { receiptId: id } })).toBe(0);
    await setBranch(id, "n-xferdec", "stays");
    await expect(send(id)).rejects.toThrow(/isn't marked for transfer/);
    await setBranch(id, "n-xferdec", "transfer");
    expect((await send(id)).lines[0]!.receiptId).toBe(id);
  });

  it("can't change to 'No — stays' once the Lot is on a BKT", async () => {
    const id = await lot();
    const t = await send(id);
    await expect(setBranch(id, "n-xferdec", "stays")).rejects.toThrow(new RegExp(`already on transfer ${t.id}`));
  });
});

describe("RCN moves one way: Unit to Central", () => {
  /** A Lot at the Central site B, past everything "Ready for production" needs when `complete`. */
  async function centralLot(complete = true): Promise<string> {
    const id = (await createReceipt(B, D)).id;
    await setBranch(id, "n-qfs", "pass");
    if (complete) {
      await setStageFields(id, "n-bin", { "Bin Number": B_BIN }, { bypassValidation: true });
      await setStageFields(id, "n-grn", { "GRN Weight (kept separate from Gross/Net/Paid)": "1000", PRICE: "470" }, { bypassValidation: true });
      await setBranch(id, "n-drying", "none");
    }
    return id;
  }

  it("refuses a new BKT from Central back to Unit, and between two Central sites", async () => {
    const id = await centralLot();
    await expect(createTransfer({ transferDate: D, fromWarehouse: B, toWarehouse: A, lines: [{ receiptId: id, bags: 5 }] })).rejects.toThrow(/from a Unit warehouse to a Central warehouse/);
    await expect(createTransfer({ transferDate: D, fromWarehouse: B, toWarehouse: C, lines: [{ receiptId: id, bags: 5 }] })).rejects.toThrow(/from a Unit warehouse to a Central warehouse/);
  });

  it("won't dispatch or add to a BKT already created the wrong way round, and nothing is written", async () => {
    await prisma.transferRequest.create({ data: { id: "BKT-2033-901", transferDate: D, fromWarehouse: B, toWarehouse: A } });
    await expect(dispatchTransfer("BKT-2033-901", { whReceiptNo: "WR", truckNo: "BACK-RIG" })).rejects.toThrow(/from a Unit warehouse to a Central warehouse/);
    await expect(addTransferLines("BKT-2033-901", [{ receiptId: await centralLot() }])).rejects.toThrow(/from a Unit warehouse to a Central warehouse/);
    expect((await getTransfer("BKT-2033-901"))!.status).toBe("requested");
  });

  it("Central can't answer 'transfers out', and Unit can't answer 'ready for production'", async () => {
    await expect(setBranch(await centralLot(), "n-xferdec", "transfer")).rejects.toThrow(/Central warehouse can't be transferred/);
    await expect(setBranch(await lot(), "n-xferdec", "production")).rejects.toThrow(/Only a Lot at a Central warehouse/);
  });

  it("a Lot can only be marked ready once nothing is open, and says what is missing", async () => {
    await expect(setBranch(await centralLot(false), "n-xferdec", "production")).rejects.toThrow(/allocate a Bin, complete the GRN .*, answer the Drying step/);
    const ready = await setBranch(await centralLot(), "n-xferdec", "production");
    expect(ready.status).toBe("ready_for_production");
  });

  it("only a Lot marked ready counts in its bin; a kept one stays out and is reported on the bin", async () => {
    const keep = await centralLot();
    await setBranch(keep, "n-xferdec", "stays");
    const go = await centralLot();
    await setBranch(go, "n-xferdec", "production");
    const lots = (await procurementBinStock(B)).get(B_BIN)!.lots.map((l) => l.receiptId);
    expect(lots).toContain(go);
    expect(lots).not.toContain(keep);
    expect((await listAvailableBins(B)).find((b) => b.binCode === B_BIN)!.lotsKept).toBeGreaterThanOrEqual(1);
  });

  it("the receipt's links report its real BKT, and a batch only through the bin it reached", async () => {
    const id = await lot(BIN1);
    expect(await getReceiptLinks(id)).toMatchObject({ bkts: [], batchCode: null });
    const t = await createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines: [{ receiptId: id, bags: 5 }] });
    expect((await getReceiptLinks(id)).bkts).toEqual([{ id: t.id, dispatchedAt: null, receivedAt: null }]); // "Yes" and a BKT aren't a dispatch
    await dispatchTransfer(t.id, { whReceiptNo: "WR-D", truckNo: `LINK-RIG-${t.id}` });
    expect((await getReceiptLinks(id)).bkts[0]!.dispatchedAt).not.toBeNull();
    await receiveTransfer(t.id, { whReceiptNo: "WR-R", bagsReceived: 5, receivedGrossKg: 5 });
    expect((await getReceiptLinks(id)).bkts[0]!.receivedAt).not.toBeNull();
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
    const body = { whReceiptNo: "WR-D", truckNo: "HTTP-RIG", dispatchedGrossKg: 48880, ...CREW };
    expect((await as("receiver", "POST", `/api/transfers/${id}/dispatch`, body)).statusCode).toBe(403);
    expect((await as("stranger", "POST", `/api/transfers/${id}/dispatch`, body)).statusCode).toBe(403);
    expect((await as("sender", "POST", `/api/transfers/${id}/dispatch`, body)).statusCode).toBe(200);
  });

  it("only the destination records the arrival — the sender can't fill in what 'arrived'", async () => {
    const body = { whReceiptNo: "WR-R", bagsReceived: 574, receivedGrossKg: 48820, receivedComment: "16 bags short", lines: await bins(id) };
    expect((await as("sender", "POST", `/api/transfers/${id}/receive`, body)).statusCode).toBe(403);
    expect((await as("stranger", "POST", `/api/transfers/${id}/receive`, body)).statusCode).toBe(403);
    const ok = await as("receiver", "POST", `/api/transfers/${id}/receive`, body);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ state: "discrepancy", variance: { bagVariance: -16, weightVarianceKg: -44 } });
  });

  it("a refusal is a plain 422, not a crash", async () => {
    const res = await as("receiver", "POST", `/api/transfers/${id}/receive`, { whReceiptNo: "WR-R", bagsReceived: 1, receivedGrossKg: 1 });
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
    expect((await as("admin", "POST", `/api/transfers/${t}/dispatch`, { whReceiptNo: "WR-D", truckNo: "ADMIN-RIG", dispatchedGrossKg: 5, ...CREW })).statusCode).toBe(200);
    expect((await as("admin", "POST", `/api/transfers/${t}/receive`, { whReceiptNo: "WR-R", bagsReceived: 5, receivedGrossKg: 5, lines: await bins(t) })).statusCode).toBe(200);
    expect((await as("bm", "GET", "/api/transfers")).statusCode).toBe(403);
    expect((await as("bm", "POST", `/api/transfers/${t}/dispatch`, { whReceiptNo: "WR-D", truckNo: "X" })).statusCode).toBe(403);
  });

  it("a Warehouse Incharge sends only from their own warehouse, and can still see where to send to", async () => {
    const line = async () => [{ receiptId: await lot(), bags: 5 }];
    const other = await as("sender", "POST", "/api/transfers", { transferDate: D, fromWarehouse: C, toWarehouse: B, lines: await line() });
    expect(other.statusCode).toBe(403);
    // The master shows them only their own warehouse; where they may send comes from its own read.
    const names = (await as("sender", "GET", "/api/masters")).json().warehouses.map((w: { name: string }) => w.name);
    expect(names).toContain(A);
    expect(names).not.toContain(B);
    // Each Central site with its stores (the warehouses a truck can be sent to); never the sender's own site.
    const destinations = (await as("sender", "GET", "/api/transfers/destinations")).json() as { site: string; stores: string[] }[];
    expect(destinations).toContainEqual({ site: B, stores: expect.arrayContaining([B_STORE]) });
    expect(destinations.map((d) => d.site)).not.toContain(A);
  });

  it("a store chosen as the destination is kept, while its site still decides who sees and receives the BKT", async () => {
    const res = await as("sender", "POST", "/api/transfers", { transferDate: D, toWarehouse: B_STORE, lines: [{ receiptId: await lot(), bags: 5 }] });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ fromWarehouse: A, toWarehouse: B, toStore: B_STORE });
    expect((await as("receiver", "GET", `/api/transfers/${res.json().id}`)).statusCode).toBe(200);
    await dispatchTransfer(res.json().id, { whReceiptNo: "WR-D", truckNo: `STORE-RIG-${res.json().id}` });
    const got = await as("receiver", "POST", `/api/transfers/${res.json().id}/receive`, { whReceiptNo: "WR-R", bagsReceived: 5, receivedGrossKg: 5, lines: await bins(res.json().id) });
    expect(got.statusCode).toBe(200);
    expect(got.json().toStore).toBe(B_STORE);
  });

  it("a BKT naming only the site has no store, and the sender's own store is refused", async () => {
    const site = await createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines: [{ receiptId: await lot(), bags: 5 }] });
    expect(site.toStore).toBeNull();
    await prisma.warehouse.create({ data: { name: "BKTTEST-A-OWN", site: A } });
    await expect(createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: "BKTTEST-A-OWN", lines: [{ receiptId: await lot(), bags: 5 }] })).rejects.toThrow(/different warehouse/);
  });

  it("an admin can send from any warehouse", async () => {
    const res = await as("admin", "POST", "/api/transfers", { transferDate: D, fromWarehouse: A, toWarehouse: C, lines: [{ receiptId: await lot(), bags: 5 }] });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ fromWarehouse: A, toWarehouse: C });
  });

  it("the old one-button status step is gone — it could dispatch a BKT with no truck", async () => {
    expect((await as("sender", "POST", `/api/transfers/${id}`, {})).statusCode).toBe(404);
  });
});

describe("dispatch carries quality and the warehouse receipt number; receiving explains a difference", () => {
  const send = async (lines: { receiptId: string; bags?: number }[]) => createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines });

  it("won't dispatch without a warehouse receipt number", async () => {
    const t = await send([{ receiptId: await lot(), bags: 100 }]);
    await expect(dispatchTransfer(t.id, { truckNo: "WR-RIG-1" })).rejects.toThrow(/warehouse receipt number/);
    expect((await getTransfer(t.id))!.status).toBe("requested");
  });

  it("puts each Lot's own quality-check result on the dispatch, and the receipt number on both ends", async () => {
    const t = await send([{ receiptId: await lot(), bags: 100 }]);
    const sent = await dispatchTransfer(t.id, { whReceiptNo: "WR-0412", truckNo: "WR-RIG-2", dispatchedGrossKg: 10100 });
    expect(sent.dispatchWhReceiptNo).toBe("WR-0412");
    expect(sent.lines[0]).toMatchObject({ moisture: 10.2, kor: 47.5, nutCount: 170 }); // from the Lot's quality check, not typed
    const got = await receiveTransfer(t.id, { whReceiptNo: "YAK-77", bagsReceived: 100, receivedGrossKg: 10100 });
    expect(got).toMatchObject({ receiveWhReceiptNo: "YAK-77", dispatchWhReceiptNo: "WR-0412", state: "closed" });
  });

  it("takes a re-measured quality instead when one is given", async () => {
    const receiptId = await lot();
    const t = await send([{ receiptId, bags: 100 }]);
    const sent = await dispatchTransfer(t.id, { whReceiptNo: "WR-9", truckNo: "WR-RIG-3", lines: [{ receiptId, moisture: 9.4, kor: 48.1 }] });
    expect(sent.lines[0]).toMatchObject({ moisture: 9.4, kor: 48.1, nutCount: 170 }); // what wasn't re-measured still comes from the check
  });

  it("needs every dispatch field: the crew and the loaded weight", async () => {
    const t = await send([{ receiptId: await lot(), bags: 100 }]);
    await expect(dispatchInto(t.id, { whReceiptNo: "WR-F", truckNo: "FULL-RIG" })).rejects.toThrow(/Fill in the transporter, driver, driver phone, loaded weight to dispatch/);
    await expect(dispatchInto(t.id, { whReceiptNo: "WR-F", truckNo: "FULL-RIG", ...CREW, driver: "  " })).rejects.toThrow(/Fill in the driver, loaded weight/);
    expect((await getTransfer(t.id))!.status).toBe("requested");
    expect((await dispatchInto(t.id, { whReceiptNo: "WR-F", truckNo: "FULL-RIG", ...CREW, dispatchedGrossKg: 10100 })).status).toBe("dispatched");
  });

  it("refuses a Lot with no quality on record unless it is entered, and an impossible value", async () => {
    const bare = (await createReceipt(A, D)).id; // passed quality with no readings
    await setBranch(bare, "n-qfs", "pass");
    await setBranch(bare, "n-xferdec", "transfer");
    const t = await send([{ receiptId: bare, bags: 100 }]);
    await expect(dispatchTransfer(t.id, { whReceiptNo: "WR-1", truckNo: "WR-RIG-4" })).rejects.toThrow(/no moisture on record/);
    await expect(dispatchTransfer(t.id, { whReceiptNo: "WR-1", truckNo: "WR-RIG-4", lines: [{ receiptId: bare, moisture: 10 }] })).rejects.toThrow(/no KOR on record/);
    await expect(dispatchTransfer(t.id, { whReceiptNo: "WR-1", truckNo: "WR-RIG-4", lines: [{ receiptId: bare, moisture: 140, kor: 47, nutCount: 165 }] })).rejects.toThrow(/moisture must be between 0 and 100/);
    await expect(dispatchTransfer(t.id, { whReceiptNo: "WR-1", truckNo: "WR-RIG-4", lines: [{ receiptId: bare, moisture: 10, kor: 47 }] })).rejects.toThrow(/no nut count on record/);
    const ok = await dispatchTransfer(t.id, { whReceiptNo: "WR-1", truckNo: "WR-RIG-4", lines: [{ receiptId: bare, moisture: 10, kor: 47, nutCount: 165 }] });
    expect(ok.lines[0]).toMatchObject({ moisture: 10, kor: 47, nutCount: 165 });
    expect((await getTransfer(t.id))!.status).toBe("dispatched");
  });

  it("receiving needs the receipt number, and a reason whenever what arrived differs from what was sent", async () => {
    const t = await send([{ receiptId: await lot(), bags: 100 }]);
    await dispatchTransfer(t.id, { whReceiptNo: "WR-5", truckNo: "WR-RIG-5", dispatchedGrossKg: 10100 });
    await expect(receiveTransfer(t.id, { bagsReceived: 100, receivedGrossKg: 10100 })).rejects.toThrow(/warehouse receipt number of this arrival/);
    await expect(receiveTransfer(t.id, { whReceiptNo: "Y-1", bagsReceived: 96, receivedGrossKg: 9700 })).rejects.toThrow(/differs from what was sent \(-4 bags, -396 kg\)\. Say why/);
    expect((await getTransfer(t.id))!.status).toBe("dispatched"); // nothing was recorded
    const got = await receiveTransfer(t.id, { whReceiptNo: "Y-1", bagsReceived: 96, receivedGrossKg: 9700, receivedComment: "4 torn bags left on the road" });
    expect(got.state).toBe("discrepancy");
  });
});

describe("receiving puts each Lot in a bin here, which is what production draws on", () => {
  const send = async (n = 1) => {
    const lines = [];
    for (let i = 0; i < n; i++) lines.push({ receiptId: await lot(BIN1), bags: 100 });
    const t = await createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines });
    await dispatchTransfer(t.id, { whReceiptNo: "WR-BIN", truckNo: `BIN-RIG-${t.id}`, dispatchedGrossKg: 100 * n * 100 + 100 * n });
    return t;
  };

  it("won't record an arrival until every Lot has a bin, and nothing is half-written", async () => {
    const t = await send(2);
    const [first] = t.lines;
    const body = { whReceiptNo: "Y-BIN", bagsReceived: 200, receivedGrossKg: 20200 };
    await expect(receiveInto(t.id, body)).rejects.toThrow(/Choose the bin Lot .* was unloaded into/);
    await expect(receiveInto(t.id, { ...body, lines: [{ receiptId: first!.receiptId, binCode: B_BIN }] })).rejects.toThrow(/Choose the bin/);
    expect((await getTransfer(t.id))!.status).toBe("dispatched");
  });

  it("refuses a bin that isn't in Masters, or that is in another site's store", async () => {
    const t = await send();
    const body = (binCode: string) => ({ whReceiptNo: "Y-BIN", bagsReceived: 100, receivedGrossKg: 10100, lines: [{ receiptId: t.lines[0]!.receiptId, binCode }] });
    await expect(receiveInto(t.id, body("NO-SUCH-BIN-XYZ"))).rejects.toThrow(/Not in Masters › Bins: NO-SUCH-BIN-XYZ/);
    await prisma.warehouse.create({ data: { name: "BKTTEST-A-STORE", site: A } });
    await prisma.bin.update({ where: { code: BIN2 }, data: { warehouseName: "BKTTEST-A-STORE" } });
    try {
      await expect(receiveInto(t.id, body(BIN2))).rejects.toThrow(new RegExp(`${BIN2} is in BKTTEST-A-STORE, not at ${B}`));
    } finally {
      await prisma.bin.update({ where: { code: BIN2 }, data: { warehouseName: null } });
      await prisma.warehouse.delete({ where: { name: "BKTTEST-A-STORE" } });
    }
    const got = await receiveInto(t.id, body(B_BIN.toLowerCase()));
    expect(got.lines[0]!.receivedBinCode).toBe(B_BIN);
  });

  it("puts a Lot alone on its truck into the bin at the net weighed on arrival — at the destination, not the sender", async () => {
    const t = await send();
    await receiveInto(t.id, { whReceiptNo: "Y-BIN", bagsReceived: 100, receivedGrossKg: 10100, lines: await bins(t.id) });
    const lot = (await procurementBinStock(B)).get(B_BIN)!.lots.find((l) => l.transferId === t.id);
    expect(lot).toMatchObject({ receiptId: t.lines[0]!.receiptId, kg: 10000, state: "in_bin", lotNo: t.lines[0]!.lotNumber });
    // Transferred out of A: in no bin there.
    expect([...(await procurementBinStock(A)).values()].flatMap((b) => b.lots).some((l) => l.receiptId === t.lines[0]!.receiptId)).toBe(false);
  });

  it("takes the bags of each Lot when counted, or just the truck's total — then the weight is shared by bags sent", async () => {
    const t = await send(2);
    const [a, b] = t.lines;
    const counted = (x: number, y: number) => [{ receiptId: a!.receiptId, binCode: B_BIN, bagsReceived: x }, { receiptId: b!.receiptId, binCode: B_BIN, bagsReceived: y }];
    // A total typed next to the counts has to agree with them.
    await expect(receiveInto(t.id, { whReceiptNo: "Y-BIN", bagsReceived: 201, receivedGrossKg: 20200, lines: counted(150, 50) })).rejects.toThrow(/add up to 200, but 201/);
    expect((await getTransfer(t.id))!.status).toBe("dispatched");

    const got = await receiveInto(t.id, { whReceiptNo: "Y-BIN", receivedGrossKg: 20200, lines: counted(150, 50) });
    expect(got).toMatchObject({ bagsReceived: 200, state: "closed" }); // the truck's total is the sum, typed once
    expect(got.lines.map((l) => l.bagsReceived)).toEqual([150, 50]);
    const lots = (await procurementBinStock(B)).get(B_BIN)!.lots.filter((l) => l.transferId === t.id);
    // 20,200 gross − 200 bags = 20,000 kg net, shared 150 : 50.
    expect(lots.map((l) => [l.kg, l.state, l.kgShared])).toEqual([[15000, "in_bin", true], [5000, "in_bin", true]]);

    // The arrival form (20 Nov 2026): one bag count and one bin for the truck, as the client's sheet has one row per truck.
    const t2 = await send(2);
    const whole = await receiveInto(t2.id, { whReceiptNo: "Y-BIN", bagsReceived: 200, receivedGrossKg: 20200, lines: t2.lines.map((l) => ({ receiptId: l.receiptId, binCode: B_BIN })) });
    expect(whole.bagsReceived).toBe(200);
    expect(whole.lines.map((l) => l.bagsReceived)).toEqual([null, null]); // no Lot has a count of its own
    const shared = (await procurementBinStock(B)).get(B_BIN)!.lots.filter((l) => l.transferId === t2.id);
    expect(shared.map((l) => [l.kg, l.kgShared])).toEqual([[10000, true], [10000, true]]); // 100 : 100 bags sent
  });

  it("refuses a bin no warehouse has claimed yet, until an admin places it — and only an admin may", async () => {
    const t = await send();
    const body = { whReceiptNo: "Y-BIN", bagsReceived: 100, receivedGrossKg: 10100, lines: [{ receiptId: t.lines[0]!.receiptId, binCode: BIN2 }] };
    await expect(receiveInto(t.id, body)).rejects.toThrow(new RegExp(`Bin ${BIN2} isn't assigned to a warehouse yet`));
    // Nobody but an admin sees it or can place it.
    expect((await (await as("receiver", "GET", "/api/masters")).json()).bins).not.toContain(BIN2);
    expect((await app.inject({ method: "PATCH", url: `/api/masters/bins/${BIN2}`, payload: { warehouseName: B_STORE }, headers: { cookie: cookies.receiver! } })).statusCode).toBe(403);
    try {
      const placed = await app.inject({ method: "PATCH", url: `/api/masters/bins/${BIN2}`, payload: { warehouseName: B_STORE }, headers: { cookie: cookies.admin! } });
      expect(placed.statusCode).toBe(200);
      expect((await (await as("receiver", "GET", "/api/masters")).json()).bins).toContain(BIN2);
      expect((await receiveInto(t.id, body)).lines[0]!.receivedBinCode).toBe(BIN2);
    } finally {
      await prisma.bin.update({ where: { code: BIN2 }, data: { warehouseName: null } });
    }
  });

  it("a truck still on the road puts nothing in a bin", async () => {
    const t = await send();
    expect([...(await procurementBinStock(B)).values()].flatMap((b) => b.lots).some((l) => l.transferId === t.id)).toBe(false);
  });
});

// The user's case (Nov 2026): a 40 t Lot on a 35 t truck; the other 5 t go on the next truck with another Lot.
describe("a Lot bigger than one truck goes on several BKTs", () => {
  /** A Lot ready to send whose receipt recorded its size: 800 bags, 40,000 kg net. */
  async function bigLot(bags = "800", net = "40000"): Promise<string> {
    const id = (await createReceipt(A, D)).id;
    await setStageFields(id, "n-qfs", { "Final moisture (%)": "10.2", KOR: "47.5", "Final nut count": "170" });
    await setBranch(id, "n-qfs", "pass");
    await setStageFields(id, "n-unload", { "SACS (bags)": bags }, { bypassValidation: true });
    await setStageFields(id, "n-netwt", { "NET WT KGS": net }, { bypassValidation: true });
    await setBranch(id, "n-xferdec", "transfer");
    return id;
  }
  const bkt = (lines: { receiptId: string; bags?: number; netWeightKg?: number }[]) => createTransfer({ transferDate: D, fromWarehouse: A, toWarehouse: B, lines });

  it("sends the rest of the Lot on the next truck with another Lot, and arrives in two pieces", async () => {
    const big = await bigLot();
    const other = await bigLot("600", "30000");
    const t1 = await bkt([{ receiptId: big, bags: 700, netWeightKg: 35000 }]);
    const t2 = await bkt([{ receiptId: big, bags: 100, netWeightKg: 5000 }, { receiptId: other, bags: 600, netWeightKg: 30000 }]);
    expect(t2.lines.map((l) => [l.receiptId, l.netWeightKg])).toEqual([[big, 5000], [other, 30000]]);

    // Nothing of the big Lot is left now.
    await expect(bkt([{ receiptId: big, bags: 1, netWeightKg: 1 }])).rejects.toThrow(new RegExp(`already on ${t1.id}, ${t2.id} in full`));

    // Each truck: 700 bags, 35,000 kg net → 35,700 kg loaded.
    for (const [t, rig] of [[t1, "SPLIT-RIG-1"], [t2, "SPLIT-RIG-2"]] as const) await dispatchTransfer(t.id, { whReceiptNo: "WR-S", truckNo: `${rig}-${t.id}`, dispatchedGrossKg: 35700 });
    await receiveInto(t1.id, { whReceiptNo: "Y-S1", receivedGrossKg: 35700, lines: [{ receiptId: big, binCode: B_BIN, bagsReceived: 700 }] });
    await receiveInto(t2.id, { whReceiptNo: "Y-S2", receivedGrossKg: 35700, lines: [{ receiptId: big, binCode: B_BIN, bagsReceived: 100 }, { receiptId: other, binCode: B_BIN, bagsReceived: 600 }] });

    const pieces = (await procurementBinStock(B)).get(B_BIN)!.lots.filter((l) => l.receiptId === big);
    expect(pieces.map((l) => [l.transferId, l.kg]).sort()).toEqual([[t1.id, 35000], [t2.id, 5000]]);
    // The Lot's own page lists both trucks.
    expect((await getReceiptLinks(big)).bkts.map((b) => b.id)).toEqual([t1.id, t2.id]);
  });

  it("refuses more than is left of the Lot, and a second piece with no figure", async () => {
    const big = await bigLot();
    const t1 = await bkt([{ receiptId: big, bags: 700, netWeightKg: 35000 }]);
    await expect(bkt([{ receiptId: big, bags: 100, netWeightKg: 6000 }])).rejects.toThrow(/has 5,000 kg left to send \(of 40,000 kg\)/);
    await expect(bkt([{ receiptId: big }])).rejects.toThrow(new RegExp(`Part of Lot .* is already on ${t1.id}\\. Enter how much`));
    // Nothing half-written: still only on the first truck.
    expect(await prisma.transferRequestLine.count({ where: { receiptId: big } })).toBe(1);
  });

  it("keeps a changed figure on the Lot's timeline, and says nothing when the Lot's own figures were sent", async () => {
    const note = async (id: string) => (await prisma.timelineEntry.findFirst({ where: { receiptId: id }, orderBy: { id: "desc" } }))!.note;
    const whole = await bigLot();
    const t0 = await bkt([{ receiptId: whole, bags: 800, netWeightKg: 40000 }]);
    expect(await note(whole)).toBe(`Added to transfer ${t0.id}`);

    const big = await bigLot();
    const t1 = await bkt([{ receiptId: big, bags: 700, netWeightKg: 35000 }]);
    expect(await note(big)).toBe(`Added to transfer ${t1.id}: 700 bags · 35,000 kg, changed from 800 bags · 40,000 kg (the whole Lot)`);
    const t2 = await bkt([{ receiptId: big, bags: 100, netWeightKg: 4000 }]);
    expect(await note(big)).toBe(`Added to transfer ${t2.id}: 100 bags · 4,000 kg, changed from 100 bags · 5,000 kg (what was left of the Lot)`);
  });

  it("a Lot whose size was never recorded still goes on one BKT only, as before", async () => {
    const id = await lot();
    const t = await bkt([{ receiptId: id, bags: 10 }]);
    await expect(bkt([{ receiptId: id, bags: 10 }])).rejects.toThrow(new RegExp(`already on ${t.id} in full`));
  });
});
