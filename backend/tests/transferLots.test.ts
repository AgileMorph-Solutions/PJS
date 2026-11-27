/**
 * The transfer flow of 24 Nov 2026, end to end: a Unit warehouse makes a lot out of its Bins, weighs it, loads it on one or
 * more trucks (BKTs); the Central warehouse receives each lot on the truck as a lot of its own, or rejects the truck.
 * Through the services and the HTTP layer, on throwaway warehouses. Each "can't be right" value the user listed (negative
 * weights, letters in numbers, half a bag, a mismatch) is tried here, and nothing it touched may be saved.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createTransferLot, deleteTransferLot, getTransferLot, updateTransferLot, weighTransferLot } from "../src/services/transferLots.js";
import { createTransfer, dispatchTransfer, getTransfer, receiveTransfer } from "../src/services/transfers.js";
import { startTransferReceptions } from "../src/services/transferReceptions.js";
import { createReceipt, finaliseBin, getReceipt, setBranch, setStageFields, type WriteOpts } from "../src/services/receipts.js";
import { siteBinStock } from "../src/services/binStock.js";
import { resolveSite } from "../src/domain/site.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const U = "TLTEST-UNIT";
const C = "TLTEST-CENTRAL";
const U2 = "TLTEST-UNIT2";
const BIN_A = "TLTEST-U-BIN-A";
const BIN_B = "TLTEST-U-BIN-B";
const BIN_OTHER = "TLTEST-U2-BIN";
const BIN_C = "TLTEST-C-BIN";
const D = "2033-03-03";
/** An origin of the master: a truck's origin typed in the app must be one. */
const ORIGIN = "TLTEST-MANKONO";
const YEAR = new Date().getFullYear();
const cookies: Record<string, string> = {};
const as = (u: string, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as any, headers: { cookie: cookies[u]! } });

async function cleanup() {
  const all = [U, C, U2];
  // Receptions point at BKT lines (RESTRICT): they go first, then the BKTs and the lots.
  await prisma.receipt.deleteMany({ where: { warehouse: { in: all } } });
  await prisma.transferRequest.deleteMany({ where: { OR: [{ fromWarehouse: { in: all } }, { toWarehouse: { in: all } }] } });
  await prisma.transferLotReturn.deleteMany({ where: { lot: { warehouse: { in: all } } } });
  await prisma.transferLot.deleteMany({ where: { warehouse: { in: all } } });
  await prisma.changeLog.deleteMany({ where: { user: { username: { startsWith: "tltest-" } } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "tltest-" } } });
  await prisma.bin.deleteMany({ where: { code: { in: [BIN_A, BIN_B, BIN_OTHER, BIN_C] } } });
  await prisma.warehouse.deleteMany({ where: { name: { in: all } } });
  await prisma.origin.deleteMany({ where: { name: ORIGIN } });
}

/** A driver drives one truck at a time (24 Nov 2026): a fresh 10-digit phone each time it is spread. */
let phoneSeq = 202030400;
const CREW = { whReceiptNo: "9001", transporter: "KONE & FILS", driver: "Kone", get driverPhone() { return String(++phoneSeq).padStart(10, "0"); } };

/** A lot of 300 bags from BIN_A and 200 from BIN_B, weighed at 41,500 kg on the scale: 41,000 kg net. */
async function weighedLot() {
  const lot = await createTransferLot({ warehouse: U, lotDate: D, bins: [{ binCode: BIN_A, bags: 300 }, { binCode: BIN_B, bags: 200 }] });
  return weighTransferLot(lot.id, { grossWeightKg: "41500", moisture: "9,5", kor: "46", nutCount: "180" });
}

/** A BKT carrying `bags` of `lotId`, dispatched with the loaded weight its pieces add up to (net + 1 kg a bag). */
async function sendOnTruck(pieces: { lotId: number; bags: number }[], truckNo: string) {
  const t = await createTransfer({ transferDate: D, fromWarehouse: U, toWarehouse: C, lines: pieces.map((p) => ({ transferLotId: p.lotId, bags: p.bags })) });
  const gross = t.lines.reduce((a, l) => a + (l.netWeightKg ?? 0) + (l.bags ?? 0), 0);
  return dispatchTransfer(t.id, { ...CREW, truckNo, dispatchedGrossKg: gross });
}

beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: U, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "TLU1" } });
  await prisma.warehouse.create({ data: { name: C, kind: "FACTORY", type: "CENTRAL", code: "TLC1" } });
  await prisma.warehouse.create({ data: { name: U2, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "TLU2" } });
  await prisma.bin.createMany({
    data: [
      { code: BIN_A, warehouseName: U, source: "test" }, { code: BIN_B, warehouseName: U, source: "test" },
      { code: BIN_OTHER, warehouseName: U2, source: "test" }, { code: BIN_C, warehouseName: C, source: "test" },
    ],
  });
  await prisma.origin.create({ data: { name: ORIGIN } });
  for (const [key, role, wh] of [["sender", "warehouse_incharge", U], ["receiver", "warehouse_incharge", C], ["other", "warehouse_incharge", U2], ["bm", "branch_manager", U], ["admin", "admin", null]] as const) {
    await prisma.user.create({ data: { username: `tltest-${key}`, displayName: key, role, warehouse: wh, passwordHash: hashPassword(PW) } });
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `tltest-${key}`, password: PW } });
    expect(res.statusCode, key).toBe(200);
    cookies[key] = String(res.headers["set-cookie"]).split(";")[0]!;
  }
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("making a lot out of Bins", () => {
  it("takes bags from one or more Bins, with the warehouse's next Lot number", async () => {
    const lot = await createTransferLot({ warehouse: U, lotDate: D, bins: [{ binCode: BIN_A, bags: 300 }, { binCode: BIN_B, bags: "200" }] });
    expect(lot).toMatchObject({ lotNo: expect.stringMatching(/^LOT-TLU1-2033-\d{4}$/), bags: 500, status: "waiting_weight", netKg: null, leftBags: 500 });
    expect(lot.bins.map((b) => [b.binCode, b.bags, b.netKg])).toEqual([[BIN_A, 300, null], [BIN_B, 200, null]]);
  });

  it("refuses what can't be right, and saves nothing", async () => {
    const before = await prisma.transferLot.count({ where: { warehouse: U } });
    const make = (bins: { binCode: string; bags: unknown }[], extra = {}) => createTransferLot({ warehouse: U, lotDate: D, bins: bins as never, ...extra });
    await expect(make([{ binCode: BIN_A, bags: -5 }])).rejects.toThrow(/Bags from .*: Can't be negative/);
    await expect(make([{ binCode: BIN_A, bags: "12.5" }])).rejects.toThrow(/Not a whole number/);
    await expect(make([{ binCode: BIN_A, bags: "abc" }])).rejects.toThrow(/isn't a number/);
    await expect(make([{ binCode: BIN_A, bags: 0 }])).rejects.toThrow(/more than 0/);
    await expect(make([])).rejects.toThrow(/at least one Bin/);
    await expect(make([{ binCode: BIN_A, bags: 1 }, { binCode: BIN_A.toLowerCase(), bags: 1 }])).rejects.toThrow(/already on the lot/);
    await expect(make([{ binCode: BIN_OTHER, bags: 10 }])).rejects.toThrow(/isn't a Bin of this warehouse/);
    await expect(make([{ binCode: "TLTEST-NO-SUCH-BIN", bags: 10 }])).rejects.toThrow(/isn't in the Bin master/);
    await expect(make([{ binCode: BIN_A, bags: 10 }], { lotNo: "LOT 7" })).rejects.toThrow(/Letters, numbers/);
    await expect(createTransferLot({ warehouse: U, lotDate: "24/11/2033", bins: [{ binCode: BIN_A, bags: 10 }] })).rejects.toThrow(/Enter the date/);
    await expect(createTransferLot({ warehouse: C, lotDate: D, bins: [{ binCode: BIN_C, bags: 10 }] })).rejects.toThrow(/Unit warehouse/);
    await expect(createTransferLot({ warehouse: U, lotDate: D, bins: "BIN" as never })).rejects.toThrow(/at least one Bin/);
    expect(await prisma.transferLot.count({ where: { warehouse: U } })).toBe(before);
  });

  it("takes a typed Lot number in capitals, never one already used at the warehouse", async () => {
    const lot = await createTransferLot({ warehouse: U, lotDate: D, lotNo: " lot-tlu1-2033-0500 ", bins: [{ binCode: BIN_A, bags: 10 }] });
    expect(lot.lotNo).toBe("LOT-TLU1-2033-0500");
    await expect(createTransferLot({ warehouse: U, lotDate: D, lotNo: "LOT-TLU1-2033-0500", bins: [{ binCode: BIN_B, bags: 10 }] })).rejects.toThrow(/already another transfer lot/);
    // The next issued number continues after the typed one, so it can never be handed out again.
    const next = await createTransferLot({ warehouse: U, lotDate: D, bins: [{ binCode: BIN_B, bags: 10 }] });
    expect(next.lotNo).toBe("LOT-TLU1-2033-0501");
  });
});

describe("weighing a lot", () => {
  it("records the scale's weight and quality; the net and each Bin's share by bags are worked out", async () => {
    const lot = await weighedLot();
    expect(lot).toMatchObject({ grossWeightKg: 41500, netKg: 41000, moisture: 9.5, kor: 46, nutCount: 180, status: "ready", leftKg: 41000 });
    expect(lot.bins.map((b) => b.netKg)).toEqual([24600, 16400]);
  });

  it("refuses a weight lighter than the bags, a negative reading, or a missing one; saves an unusual one", async () => {
    const lot = await createTransferLot({ warehouse: U, lotDate: D, bins: [{ binCode: BIN_A, bags: 500 }] });
    const ok = { grossWeightKg: "41500", moisture: "9.5", kor: "46", nutCount: "180" };
    await expect(weighTransferLot(lot.id, { ...ok, grossWeightKg: "400" })).rejects.toThrow(/Weight on the scale: Must be more than 500 kg: the empty bags alone weigh that/);
    await expect(weighTransferLot(lot.id, { ...ok, grossWeightKg: "-41500" })).rejects.toThrow(/Can't be negative/);
    await expect(weighTransferLot(lot.id, { ...ok, moisture: "-1" })).rejects.toThrow(/Moisture: Can't be negative/);
    await expect(weighTransferLot(lot.id, { ...ok, nutCount: "" })).rejects.toThrow(/Nut count: Required/);
    await expect(weighTransferLot(lot.id, { ...ok, kor: "forty" })).rejects.toThrow(/KOR: "forty" isn't a number/);
    expect((await getTransferLot(lot.id))!.status).toBe("waiting_weight");
    // 50 kg a bag is far from 80, but any weight that leaves some RCN saves (the form suggests one instead of warning).
    expect((await weighTransferLot(lot.id, { ...ok, grossWeightKg: "25500" })).netKg).toBe(25000);
  });

  it("takes each Bin's share out of its stock once weighed, not before", async () => {
    const names = await resolveSite(U);
    const kgOf = async (bin: string) => (await siteBinStock(names)).get(bin)?.kg ?? 0;
    const [a0, b0] = [await kgOf(BIN_A), await kgOf(BIN_B)];
    const lot = await createTransferLot({ warehouse: U, lotDate: D, bins: [{ binCode: BIN_A, bags: 30 }, { binCode: BIN_B, bags: 20 }] });
    expect([await kgOf(BIN_A), await kgOf(BIN_B)]).toEqual([a0, b0]);
    await weighTransferLot(lot.id, { grossWeightKg: "4050", moisture: "9", kor: "46", nutCount: "180" });
    expect([await kgOf(BIN_A), await kgOf(BIN_B)]).toEqual([a0 - 2400, b0 - 1600]);
    const out = (await siteBinStock(names)).get(BIN_A)!.movements.find((m) => m.ref === lot.lotNo)!;
    expect(out).toMatchObject({ kind: "lot_out", kg: -2400, lotNo: lot.lotNo });
    // Deleted (not on a truck): its bags are back in the Bins.
    await deleteTransferLot(lot.id);
    expect([await kgOf(BIN_A), await kgOf(BIN_B)]).toEqual([a0, b0]);
  });
});

describe("loading lots on trucks", () => {
  it("puts a piece of a lot on a truck, its weight shared by bags and its quality from the weighing", async () => {
    const lot = await weighedLot();
    const t = await sendOnTruck([{ lotId: lot.id, bags: 430 }], "TL-RIG-1");
    expect(t.lines[0]).toMatchObject({ transferLotId: lot.id, transferLotNo: lot.lotNo, bags: 430, netWeightKg: 35260, moisture: 9.5, kor: 46, nutCount: 180, receiptId: null });
    // Every BKT comes out of a Bin (25 Nov 2026: the list's From Bin showed none for a lot line). The line names its lot's
    // Bins, while its own binCode stays empty: a set binCode would be read as a whole-Bin load and leave the Bin twice.
    expect(t.lines[0]).toMatchObject({ transferLotBins: [BIN_A, BIN_B], binCode: null });
    expect(t.variance).toMatchObject({ bagsDispatched: 430, netDispatchedKg: 35260 });
    expect(await getTransferLot(lot.id)).toMatchObject({ status: "part_loaded", leftBags: 70, leftKg: 5740 });
  });

  it("sends the rest on the next truck, and never more than is left", async () => {
    const lot = await weighedLot();
    await sendOnTruck([{ lotId: lot.id, bags: 430 }], "TL-RIG-2");
    await expect(createTransfer({ transferDate: D, fromWarehouse: U, toWarehouse: C, lines: [{ transferLotId: lot.id, bags: 71 }] })).rejects.toThrow(/Only 70 bags of this lot are left/);
    await expect(createTransfer({ transferDate: D, fromWarehouse: U, toWarehouse: C, lines: [{ transferLotId: lot.id, bags: -70 }] })).rejects.toThrow(/Can't be negative/);
    await expect(createTransfer({ transferDate: D, fromWarehouse: U, toWarehouse: C, lines: [{ transferLotId: lot.id, bags: 7.5 as never }] })).rejects.toThrow(/whole number/);
    await sendOnTruck([{ lotId: lot.id, bags: 70 }], "TL-RIG-3");
    expect(await getTransferLot(lot.id)).toMatchObject({ status: "loaded", leftBags: 0 });
    await expect(createTransfer({ transferDate: D, fromWarehouse: U, toWarehouse: C, lines: [{ transferLotId: lot.id, bags: 1 }] })).rejects.toThrow(/Nothing of this lot is left/);
  });

  it("won't load a lot not weighed yet, another warehouse's, or the same lot twice", async () => {
    const raw = await createTransferLot({ warehouse: U, lotDate: D, bins: [{ binCode: BIN_A, bags: 10 }] });
    await expect(createTransfer({ transferDate: D, fromWarehouse: U, toWarehouse: C, lines: [{ transferLotId: raw.id, bags: 10 }] })).rejects.toThrow(/hasn't been weighed yet/);
    const lot = await weighedLot();
    await expect(createTransfer({ transferDate: D, fromWarehouse: U2, toWarehouse: C, lines: [{ transferLotId: lot.id, bags: 10 }] })).rejects.toThrow(/not TLTEST-UNIT2/);
    await expect(createTransfer({ transferDate: D, fromWarehouse: U, toWarehouse: C, lines: [{ transferLotId: lot.id, bags: 10 }, { transferLotId: lot.id, bags: 5 }] })).rejects.toThrow(/listed twice/);
  });

  it("takes a changed weight for the piece and uses it for the truck; refuses one that can't be right", async () => {
    const lot = await weighedLot();
    const make = (netWeightKg: unknown) => createTransfer({ transferDate: D, fromWarehouse: U, toWarehouse: C, lines: [{ transferLotId: lot.id, bags: 50, netWeightKg: netWeightKg as never }] });
    await expect(make(-4100)).rejects.toThrow(/Weight of Lot .*: Can't be negative/);
    await expect(make("heavy")).rejects.toThrow(/isn't a number/);
    await expect(make(0)).rejects.toThrow(/more than 0/);
    // 50 bags are 4,100 kg by the lot's weighing; 4,500 is far off, so the form warns, but it is the warehouse's call.
    const t = await make(4500);
    expect(t.lines[0]!.netWeightKg).toBe(4500);
    expect(t.variance.netDispatchedKg).toBe(4500);
    expect((await getTransferLot(lot.id))!.pieces[0]!.netKg).toBe(4500);
    // Left blank, it is worked out from the lot.
    const auto = await createTransfer({ transferDate: D, fromWarehouse: U, toWarehouse: C, lines: [{ transferLotId: lot.id, bags: 50 }] });
    expect(auto.lines[0]!.netWeightKg).toBe(4100);
  });

  it("dispatches a truck whose loaded weight is far from its lots: a warning on the form, not a refusal", async () => {
    const lot = await weighedLot();
    const t = await createTransfer({ transferDate: D, fromWarehouse: U, toWarehouse: C, lines: [{ transferLotId: lot.id, bags: 25 }] });
    const sent = await dispatchTransfer(t.id, { ...CREW, truckNo: "TL-RIG-FAR", dispatchedGrossKg: 3000 });
    expect(sent).toMatchObject({ status: "dispatched", dispatchedGrossKg: 3000 });
  });

  // 25–26 Nov 2026: once on a truck only an Admin or the Incharge changes a lot (see "corrects…" below); nobody deletes it.
  it("keeps a lot on a truck from anyone who doesn't correct records, and from being deleted", async () => {
    const lot = await weighedLot();
    await sendOnTruck([{ lotId: lot.id, bags: 100 }], "TL-RIG-4");
    const bm: WriteOpts = { actor: { id: "x", via: "direct", role: "branch_manager" } };
    await expect(updateTransferLot(lot.id, { lotNo: "LOT-TLU1-2033-0900" }, bm)).rejects.toThrow(/already on BKT-.*only the Warehouse Incharge or an Admin can change it/);
    await expect(weighTransferLot(lot.id, { grossWeightKg: "1", moisture: "1", kor: "1", nutCount: "1" }, bm)).rejects.toThrow(/only the Warehouse Incharge or an Admin can change it/);
    // The Incharge may (26 Nov 2026): the lot's number is theirs to correct.
    expect((await updateTransferLot(lot.id, { lotNo: "LOT-TLU1-2033-0900" }, await sender())).lotNo).toBe("LOT-TLU1-2033-0900");
    await expect(deleteTransferLot(lot.id)).rejects.toThrow(/can't be deleted/);
  });
});


/** The sending Warehouse Incharge, writing in the app. */
async function sender(): Promise<WriteOpts> {
  const u = await prisma.user.findUniqueOrThrow({ where: { username: "tltest-sender" }, select: { id: true } });
  return { actor: { id: u.id, via: "direct", role: "warehouse_incharge" } };
}

/** The receiving Warehouse Incharge, writing in the app: the phase order and every rule apply to them as to anyone. */
async function receiver(): Promise<WriteOpts> {
  const u = await prisma.user.findUniqueOrThrow({ where: { username: "tltest-receiver" }, select: { id: true } });
  return { actor: { id: u.id, via: "direct", role: "warehouse_incharge" } };
}
let fiche = 880000;

/**
 * One lot's reception from gate to GRN, as a person fills it, with `bags` counted and the truck weighed `loaded` / `empty`.
 * No supplier, LBA code, credit/cash or price anywhere: a truck from the Unit warehouse has none.
 */
async function receive(id: string, { bags, loaded, empty }: { bags: number; loaded: number; empty: number }) {
  const as = await receiver();
  const f = String(++fiche);
  await setStageFields(id, "n-verify", { "FICHE CODE": f, FICHE: f, ORIGIN }, as);
  await setStageFields(id, "n-gross", { "Loaded truck weight (kg)": String(loaded), "Tare / empty truck weight (kg)": String(empty) }, as);
  // One set of readings, KOR typed: no cut test and no second "final" readings on a truck from the Unit warehouse.
  await setStageFields(id, "n-qfs", { "Sample moisture (%)": "9.6", "Sample nut count": "182", KOR: "46.2" }, as);
  await setBranch(id, "n-qfs", "pass", undefined, as);
  await setStageFields(id, "n-unload", { "BON SACS (good bags)": String(bags), "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "0", "Reconditioning of torn bags": "0", "New Jute Bag Used": "3" }, as);
  await setStageFields(id, "n-bin", { "Bin Number": BIN_C, "Basis for allocation (moisture / quality / KOR / space)": "KOR", "Finalised (same day / next day)": "Same day" }, as);
  const u = await prisma.user.findUniqueOrThrow({ where: { username: "tltest-receiver" }, select: { id: true, displayName: true } });
  await finaliseBin(id, u);
  const net = (await getReceipt(id))!.stageData["n-netwt"]?.["NET WT KGS"] ?? "";
  await setStageFields(id, "n-grn", { "GRN Weight (kept separate from Gross/Net/Paid)": net }, as);
  return (await getReceipt(id))!;
}

describe("Reception at the Central warehouse: a truck from the Unit warehouse, same reception as a supplier's", () => {
  it("starts one reception per lot on the truck, linked to the BKT, with no supplier", async () => {
    const t = await sendOnTruck([{ lotId: (await weighedLot()).id, bags: 300 }, { lotId: (await weighedLot()).id, bags: 120 }], "TL-RIG-5");
    const ids = await startTransferReceptions(t.id, await receiver());
    expect(ids).toHaveLength(2);
    // A second click makes nothing more.
    expect(await startTransferReceptions(t.id, await receiver())).toEqual(ids);
    const r = (await getReceipt(ids[0]!))!;
    expect(r).toMatchObject({ supplierName: "", lbaCode: "", vehicleNo: "TLRIG5", warehouse: C });
    expect(r.transfer).toMatchObject({ transferId: t.id, fromWarehouse: U, truckNo: "TLRIG5", transporter: CREW.transporter, sent: { bags: 300, netKg: 24600, moisture: 9.5, kor: 46, nutCount: 180 } });
    expect(r.stageData["n-gate"]).toMatchObject({ "DATE OF ARRIVAL": expect.any(String), "VEHICLE NO.": "TLRIG5", "WH LOCATION": C });
    expect((await getTransfer(t.id))!.state).toBe("receiving");
  });

  it("goes through the same steps to GRN without a supplier or price, into the Bin, and closes the BKT", async () => {
    const t = await sendOnTruck([{ lotId: (await weighedLot()).id, bags: 300 }], "TL-RIG-6");
    const [id] = await startTransferReceptions(t.id, await receiver());
    // The truck sent 300 bags, 24,600 kg net: weighed full 39,900 and empty 15,000 here, 300 bags counted off.
    const done = await receive(id!, { bags: 300, loaded: 39900, empty: 15000 });
    expect(done.lotNo).toMatch(new RegExp(`^LOT-TLC1-${YEAR}-\\d{4}$`));
    expect(done.lockedAt).toBeDefined();
    expect(done.stageData["n-netwt"]?.["NET WT KGS"]).toBe("24600");
    expect(done.stageData["n-grn"]?.PRICE ?? "").toBe("");
    const bkt = (await getTransfer(t.id))!;
    expect(bkt).toMatchObject({ status: "received", state: "closed", bagsReceived: 300, receivedGrossKg: 24900 });
    expect(bkt.lines[0]).toMatchObject({ receptionId: id, receivedLotNo: done.lotNo });
    // In the Bin it was put in, at its GRN weight, like any truck.
    const lot = (await siteBinStock(await resolveSite(C))).get(BIN_C)!.lots.find((l) => l.receiptId === id)!;
    expect(lot).toMatchObject({ kg: 24600, state: "in_bin", lotNo: done.lotNo });
  });

  it("refuses the supplier's, the payment's and the cut test's fields on it, and takes its own", async () => {
    const t = await sendOnTruck([{ lotId: (await weighedLot()).id, bags: 100 }], "TL-RIG-7");
    const [id] = await startTransferReceptions(t.id, await receiver());
    await setStageFields(id!, "n-gate", { "Laisse-Passer Entree (Yakro)": "153" }, await receiver());
    expect((await getReceipt(id!))!.stageData["n-gate"]?.["Laisse-Passer Entree (Yakro)"]).toBe("153");
    await expect(setStageFields(id!, "n-qfs", { "Sample – Good Kernel (g)": "250" }, await receiver())).rejects.toThrow(/one set of quality readings/);
    await expect(setStageFields(id!, "n-qfs", { "Final moisture (%)": "9" }, await receiver())).rejects.toThrow(/not recorded for a truck from the Unit warehouse/);
    await expect(setStageFields(id!, "n-verify", { "SUPPLIERS NAME": "SOMEONE" }, await receiver())).rejects.toThrow(/not recorded for a truck from the Unit warehouse/);
    await expect(setStageFields(id!, "n-gate", { "CREDIT/CASH": "CASH" }, await receiver())).rejects.toThrow(/not recorded/);
  });

  it("never asks a supplier's truck for the transfer-only fields", async () => {
    const supplierTruck = await createReceipt(C, D);
    await expect(setStageFields(supplierTruck.id, "n-gate", { "Laisse-Passer Entree (Yakro)": "1" }, await receiver())).rejects.toThrow(/only recorded for a truck from the Unit warehouse/);
    await expect(setStageFields(supplierTruck.id, "n-unload", { "New Jute Bag Used": "1" })).rejects.toThrow(/only recorded for a truck from the Unit warehouse/);
  });

  it("reads as a discrepancy when what arrived differs, and is received once on the Reception page only", async () => {
    const t = await sendOnTruck([{ lotId: (await weighedLot()).id, bags: 200 }], "TL-RIG-8");
    const [id] = await startTransferReceptions(t.id, await receiver());
    await expect(receiveTransfer(t.id, { whReceiptNo: "8001", bagsReceived: 200, receivedGrossKg: 16600, lines: [{ lineId: t.lines[0]!.id, binCode: BIN_C }] }))
      .rejects.toThrow(/being received on the Reception page/);
    await receive(id!, { bags: 196, loaded: 31000, empty: 15000 });
    expect((await getTransfer(t.id))!).toMatchObject({ state: "discrepancy", variance: { bagVariance: -4 } });
  });

  it("a truck with two lots stays 'being received' until both receptions are done", async () => {
    const t = await sendOnTruck([{ lotId: (await weighedLot()).id, bags: 100 }, { lotId: (await weighedLot()).id, bags: 50 }], "TL-RIG-9");
    const [a, b] = await startTransferReceptions(t.id, await receiver());
    // Weighed full, after unloading the first lot, then empty.
    // 100 bags of 82 kg = 8,200 kg net, 8,300 kg with the bags; 50 bags = 4,100 kg net, 4,150 kg with the bags.
    await receive(a!, { bags: 100, loaded: 27450, empty: 19150 });
    expect((await getTransfer(t.id))!.state).toBe("receiving");
    await receive(b!, { bags: 50, loaded: 19150, empty: 15000 });
    expect((await getTransfer(t.id))!.state).toBe("closed");
  });
});

describe("over HTTP: each warehouse writes only its own half", () => {
  it("the Unit warehouse makes and weighs its lots; nobody else can", async () => {
    const made = await as("sender", "POST", "/api/transfer-lots", { lotDate: D, bins: [{ binCode: BIN_A, bags: 40 }] });
    expect(made.statusCode).toBe(201);
    const id = made.json().id;
    expect((await as("other", "POST", `/api/transfer-lots/${id}/weighing`, { grossWeightKg: 3240, moisture: 9, kor: 46, nutCount: 180 })).statusCode).toBe(403);
    expect((await as("bm", "GET", `/api/transfer-lots?warehouse=${U}`)).statusCode).toBe(403);
    const bad = await as("sender", "POST", `/api/transfer-lots/${id}/weighing`, { grossWeightKg: -3240, moisture: 9, kor: 46, nutCount: 180 });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error).toMatch(/Can't be negative/);
    expect((await as("sender", "POST", `/api/transfer-lots/${id}/weighing`, { grossWeightKg: 3240, moisture: 9, kor: 46, nutCount: 180 })).json().status).toBe("ready");
  });

  it("only the receiving warehouse starts a truck's reception", async () => {
    const t = await sendOnTruck([{ lotId: (await weighedLot()).id, bags: 50 }], "TL-RIG-11");
    expect((await as("sender", "POST", `/api/transfers/${t.id}/receptions`)).statusCode).toBe(403);
    const ok = await as("receiver", "POST", `/api/transfers/${t.id}/receptions`);
    expect(ok.statusCode).toBe(201);
    expect(ok.json().receiptIds).toHaveLength(1);
  });
});

// 25 Nov 2026: once made, a BKT (and a lot on a truck) can be corrected by an Admin; 26 Nov 2026: and by the Warehouse Incharge,
// for their own warehouse's half. What was worked out from it follows, and what a reception copied from it follows too —
// unless that reception is closed.
describe("An Admin or the Incharge corrects a BKT and a lot on a truck", () => {
  const patch = (who: string, id: string, body: unknown) => as(who, "PATCH", `/api/transfers/${id}`, body);

  it("lets an Admin or the sending Incharge change what left: truck, crew, loaded weight, receipt number, date and remarks", async () => {
    const t = await sendOnTruck([{ lotId: (await weighedLot()).id, bags: 100 }], "TL-RIG-E1");
    // What left is the sending warehouse's half: not the receiving Incharge's, another warehouse's or a Branch Manager's.
    for (const who of ["receiver", "other", "bm"]) expect((await patch(who, t.id, { truckNo: "X" })).statusCode, who).toBe(403);
    // ...and the arrival half is the receiving warehouse's, never the sender's.
    expect((await patch("sender", t.id, { receivedComment: "x" })).statusCode).toBe(403);
    expect((await patch("sender", t.id, { remarks: "by the sender" })).json()).toMatchObject({ remarks: "by the sender" });
    const phone = CREW.driverPhone;
    const res = await patch("admin", t.id, {
      truckNo: "tl rig e1b", transporter: "sotra", driver: "traore", driverPhone: phone, dispatchedGrossKg: "8400", dispatchWhReceiptNo: "9002",
      transferDate: "2033-03-04", remarks: "  corrected  ",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ truckNo: "TLRIGE1B", transporter: "SOTRA", driver: "TRAORE", dispatchedGrossKg: 8400, dispatchWhReceiptNo: "9002", transferDate: "2033-03-04", remarks: "corrected" });
    // Every change is in the change log, by the Admin.
    const logged = await prisma.changeLog.findMany({ where: { entity: "TransferRequest", recordId: t.id, field: { in: ["truckNo", "dispatchedGrossKg"] } } });
    expect(logged.map((r) => r.field).sort()).toEqual(["dispatchedGrossKg", "truckNo"]);
  });

  it("checks a correction as it was checked when first entered", async () => {
    const t = await sendOnTruck([{ lotId: (await weighedLot()).id, bags: 100 }], "TL-RIG-E2");
    expect((await patch("admin", t.id, { transferDate: "2034-01-01" })).json().error).toMatch(/year is part of the number/);
    expect((await patch("admin", t.id, { truckNo: "" })).json().error).toMatch(/can't be empty/);
    expect((await patch("admin", t.id, { dispatchedGrossKg: "-5" })).json().error).toMatch(/isn't a number|more than 0/);
    // One truck on the road at a time: a truck still out on another BKT can't be given to this one.
    await sendOnTruck([{ lotId: (await weighedLot()).id, bags: 10 }], "TL-RIG-BUSY");
    expect((await patch("admin", t.id, { truckNo: "TL-RIG-BUSY" })).json().error).toMatch(/still on BKT-/);
    expect((await getTransfer(t.id))!.truckNo).toBe("TLRIGE2"); // nothing saved
  });

  it("changes the bags on a lot's line within what the lot holds, and what is left of the lot follows", async () => {
    const lot = await weighedLot(); // 500 bags, 41,000 kg net
    const t = await sendOnTruck([{ lotId: lot.id, bags: 400 }], "TL-RIG-E3");
    await sendOnTruck([{ lotId: lot.id, bags: 50 }], "TL-RIG-E3B"); // 50 more elsewhere: 450 of 500 on trucks
    const line = t.lines[0]!.id;
    expect((await patch("admin", t.id, { lines: [{ lineId: line, bags: 460 }] })).json().error).toMatch(/Bags of Lot .*: /);
    const res = await patch("admin", t.id, { lines: [{ lineId: line, bags: 450, moisture: "9.1" }] });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().lines[0]).toMatchObject({ bags: 450, netWeightKg: 36900, moisture: 9.1 }); // its share by bags, worked out
    expect(await getTransferLot(lot.id)).toMatchObject({ leftBags: 0 });
  });

  it("takes a line off a truck that hasn't arrived, never the last one, and gives the bags back to the lot", async () => {
    const a = await weighedLot();
    const b = await weighedLot();
    const t = await sendOnTruck([{ lotId: a.id, bags: 100 }, { lotId: b.id, bags: 100 }], "TL-RIG-E4");
    const res = await patch("admin", t.id, { removeLines: [t.lines[1]!.id] });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().lines).toHaveLength(1);
    expect(await getTransferLot(b.id)).toMatchObject({ leftBags: 500, status: "ready" });
    expect((await patch("admin", t.id, { removeLines: [t.lines[0]!.id] })).json().error).toMatch(/at least one lot/);
  });

  it("adds a lot to a truck that has left, for an Admin or the sending Incharge, while nothing on it has arrived", async () => {
    const t = await sendOnTruck([{ lotId: (await weighedLot()).id, bags: 100 }], "TL-RIG-E5");
    const more = await weighedLot();
    // Only the sending side adds lots: the receiving Incharge can't.
    expect((await as("receiver", "POST", `/api/transfers/${t.id}/lines`, { lines: [{ transferLotId: more.id, bags: 20 }] })).statusCode).toBe(403);
    const res = await as("sender", "POST", `/api/transfers/${t.id}/lines`, { lines: [{ transferLotId: more.id, bags: 20 }] });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().lines).toHaveLength(2);
  });

  it("carries a new truck number to each lot's reception, and refuses once that reception is closed", async () => {
    const t = await sendOnTruck([{ lotId: (await weighedLot()).id, bags: 300 }], "TL-RIG-E6");
    const [id] = await startTransferReceptions(t.id, await receiver());
    const res = await patch("admin", t.id, { truckNo: "TL-RIG-E6B" });
    expect(res.statusCode, res.body).toBe(200);
    const r = (await getReceipt(id!))!;
    expect(r.vehicleNo).toBe("TLRIGE6B");
    expect(r.stageData["n-gate"]?.["VEHICLE NO."]).toBe("TLRIGE6B");
    // A line whose reception has started stays on the truck.
    expect((await patch("admin", t.id, { removeLines: [t.lines[0]!.id] })).json().error).toMatch(/started its reception/);
    // Once its GRN is complete, the reception is closed: the truck can't be changed under it.
    await receive(id!, { bags: 300, loaded: 39900, empty: 15000 });
    expect((await patch("admin", t.id, { truckNo: "TL-RIG-E6C" })).json().error).toMatch(new RegExp(`${id}.*GRN is complete`));
    expect((await getTransfer(t.id))!.truckNo).toBe("TLRIGE6B");
  });

  it("lets an Admin correct a lot on a truck: its weighing reaches the truck's lines, its total bags stay what was weighed", async () => {
    const lot = await weighedLot(); // 300 + 200 bags, moisture 9.5, KOR 46, 180 nuts
    const t = await sendOnTruck([{ lotId: lot.id, bags: 100 }], "TL-RIG-E7");
    const res = await as("admin", "POST", `/api/transfer-lots/${lot.id}/weighing`, { grossWeightKg: "42000", moisture: "9", kor: "47", nutCount: "185" });
    expect(res.statusCode, res.body).toBe(200);
    const line = (await getTransfer(t.id))!.lines[0]!;
    expect(line).toMatchObject({ netWeightKg: 8300, moisture: 9, kor: 47, nutCount: 185 }); // 41,500 net × 100/500
    // The Bins may be corrected, the total can't change under the truck.
    expect((await as("admin", "PATCH", `/api/transfer-lots/${lot.id}`, { bins: [{ binCode: BIN_A, bags: 250 }, { binCode: BIN_B, bags: 250 }] })).statusCode).toBe(200);
    expect((await as("admin", "PATCH", `/api/transfer-lots/${lot.id}`, { bins: [{ binCode: BIN_A, bags: 300 }, { binCode: BIN_B, bags: 250 }] })).json().error).toMatch(/keep the total at 500/);
    expect((await as("other", "PATCH", `/api/transfer-lots/${lot.id}`, { remarks: "x" })).statusCode).toBe(403);
  });
});

// 26 Nov 2026 (user): "half lot is still there and I want to put it back in the Bin". The bags of a lot not on a truck can be
// put back in a Bin of its warehouse; the Bin gets the weight put back, as weighed (26 Nov 2026), and they can't go on a truck any more.
describe("putting a lot's bags back in a Bin", () => {
  const putBack = (who: string, lotId: number, body: object) => as(who, "POST", `/api/transfer-lots/${lotId}/put-back`, body);
  const kgIn = async (bin: string) => (await siteBinStock(await resolveSite(U))).get(bin)?.kg ?? 0;
  const today = new Date().toISOString().slice(0, 10);

  it("puts back the bags not on a truck: the Bin goes up by the weight put back, as weighed; less is left to load", async () => {
    const lot = await weighedLot(); // 500 bags, 41,000 kg net: 82 kg a bag, so 150 bags are 12,300 kg by its weighing
    await sendOnTruck([{ lotId: lot.id, bags: 300 }], "TL-PB-01");
    const before = await kgIn(BIN_B);
    const res = await putBack("sender", lot.id, { binCode: BIN_B.toLowerCase(), bags: 150, netWeightKg: "12250" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ leftBags: 50, status: "part_loaded", returns: [{ binCode: BIN_B, bags: 150, netKg: 12250, date: today, by: "sender" }] });
    expect(await kgIn(BIN_B)).toBe(before + 12250); // the weighed figure, not the 12,300 kg share
    // What is left can still go back in another of the warehouse's Bins; then the lot is done: loaded, the rest put back.
    expect((await putBack("sender", lot.id, { binCode: BIN_A, bags: 60, netWeightKg: 4920 })).json().error).toMatch(/Only 50 bags of this lot aren't on a truck/);
    // 41,000 − 24,600 on the truck − 12,250 put back = 4,150 kg left: more weight than that can't go back.
    expect((await putBack("sender", lot.id, { binCode: BIN_A, bags: 50, netWeightKg: 4200 })).json().error).toMatch(/Only 4,150 kg of this lot isn't on a truck or put back already/);
    const done = (await putBack("sender", lot.id, { binCode: BIN_A, bags: 50, netWeightKg: 4100 })).json();
    expect(done).toMatchObject({ leftBags: 0, status: "closed" });
    // And the bags put back can't go on a truck as well.
    await expect(createTransfer({ transferDate: D, fromWarehouse: U, toWarehouse: C, lines: [{ transferLotId: lot.id, bags: 1 }] })).rejects.toThrow(/Nothing of this lot is left to load/);
  });

  it("puts a whole lot back when none of it went on a truck", async () => {
    const lot = await weighedLot();
    const res = (await putBack("sender", lot.id, { binCode: BIN_A, bags: 500, netWeightKg: 41000 })).json();
    expect(res).toMatchObject({ leftBags: 0, status: "put_back" });
    expect(res.returns[0].netKg).toBe(41000);
  });

  it("refuses an unweighed lot, another warehouse's Bin, more than is left, a future day — and saves nothing", async () => {
    const unweighed = await createTransferLot({ warehouse: U, lotDate: D, bins: [{ binCode: BIN_A, bags: 40 }] });
    expect((await putBack("sender", unweighed.id, { binCode: BIN_A, bags: 10, netWeightKg: 820 })).json().error).toMatch(/Weigh the lot first/);
    const lot = await weighedLot();
    expect((await putBack("sender", lot.id, { binCode: BIN_OTHER, bags: 10, netWeightKg: 820 })).json().error).toMatch(/isn't a Bin of TLTEST-UNIT/);
    expect((await putBack("sender", lot.id, { binCode: BIN_A, bags: 501, netWeightKg: 41082 })).json().error).toMatch(/Only 500 bags/);
    expect((await putBack("sender", lot.id, { binCode: BIN_A, bags: "2.5", netWeightKg: 205 })).json().error).toMatch(/Bags/);
    expect((await putBack("sender", lot.id, { binCode: BIN_A, bags: 5, netWeightKg: 410, date: "2099-01-01" })).json().error).toMatch(/Date: Can't be in the future/);
    // The weight is required and must be a positive number (26 Nov 2026); far from the share only warns, on the form.
    expect((await putBack("sender", lot.id, { binCode: BIN_A, bags: 5 })).json().error).toMatch(/Weight put back: Required/);
    expect((await putBack("sender", lot.id, { binCode: BIN_A, bags: 5, netWeightKg: "0" })).json().error).toMatch(/Weight put back/);
    expect((await putBack("sender", lot.id, { binCode: BIN_A, bags: 5, netWeightKg: "five" })).json().error).toMatch(/Weight put back/);
    expect((await putBack("other", lot.id, { binCode: BIN_A, bags: 5, netWeightKg: 410 })).statusCode).toBe(403);
    expect((await getTransferLot(lot.id))!.returns).toEqual([]);
  });

  it("can't then be deleted or have its bags changed, except by the Incharge or an Admin undoing the put-back first", async () => {
    const lot = await weighedLot();
    const put = (await putBack("sender", lot.id, { binCode: BIN_A, bags: 100, netWeightKg: 8200 })).json();
    await expect(deleteTransferLot(lot.id)).rejects.toThrow(/were put back in a Bin, so it can't be deleted/);
    await expect(updateTransferLot(lot.id, { bins: [{ binCode: BIN_A, bags: 400 }] }, { actor: { id: "x", via: "direct", role: "branch_manager" } } as WriteOpts)).rejects.toThrow(/only the Warehouse Incharge or an Admin can change it/);
    expect((await as("other", "DELETE", `/api/transfer-lots/${lot.id}/put-back/${put.returns[0].id}`)).statusCode).toBe(403);
    const undone = await as("admin", "DELETE", `/api/transfer-lots/${lot.id}/put-back/${put.returns[0].id}`);
    expect(undone.json()).toMatchObject({ leftBags: 500, status: "ready", returns: [] });
    await deleteTransferLot(lot.id);
  });
});
