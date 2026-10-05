/**
 * The Oct 2026 team feedback, end to end through the service layer: system-issued Receipt / Lot /
 * Delivery Plan / Transfer IDs, the Lot issued on quality pass, calculated weights, Delivery Plans
 * and Transfer Requests.
 *
 * New records go on a throwaway site (own code, own year) so the live data is never touched; the
 * numbering-continues-after-history tests read the real 2026 data instead, because that is exactly
 * what they exist to protect.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { parseSiteId, parseTransferId } from "@anagroci/contract/domain/ids";
import { createReceipt, setBranch, setStageFields, getReceipt, patchReceipt } from "../src/services/receipts.js";
import { createDeliveryPlan, getDeliveryPlan, updateDeliveryPlan } from "../src/services/deliveryPlans.js";
import { createTransfer, addTransferLines, setTransferStatus, getTransfer } from "../src/services/transfers.js";
import { nextLotNumber, nextTransferId } from "../src/services/ids.js";
import { setWarehouseCode } from "../src/services/masters.js";
import { ValidationError } from "../src/domain/validation.js";

const prisma = new PrismaClient();
const SITE = "SYSIDTEST-SITE";
const NOCODE = "SYSIDTEST-NOCODE";
const CODE = "SIDT1";
const YEAR = 2031; // far from any real data, so the sequences below start at 001
const D = `${YEAR}-03-04`;

async function cleanup() {
  await prisma.transferRequest.deleteMany({ where: { id: { startsWith: `BKT-${YEAR}-` } } });
  await prisma.receipt.deleteMany({ where: { warehouse: { in: [SITE, NOCODE] } } });
  await prisma.deliveryPlan.deleteMany({ where: { destinationWarehouse: { in: [SITE, NOCODE] } } });
  await prisma.warehouse.deleteMany({ where: { name: { in: [SITE, NOCODE] } } });
}

beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: SITE, kind: "REGIONAL_CENTRAL", type: "UNIT", code: CODE } });
  await prisma.warehouse.create({ data: { name: NOCODE, kind: "REGIONAL_CENTRAL", type: "UNIT" } });
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("Receipt ID — issued when the arrival is recorded", () => {
  it("is REC-<warehouse code>-<arrival year>-NNN, counting up per warehouse and year", async () => {
    const a = await createReceipt(SITE, D);
    const b = await createReceipt(SITE, D);
    const other = await createReceipt(SITE, `${YEAR + 1}-01-02`);
    expect(a.id).toBe(`REC-${CODE}-${YEAR}-001`);
    expect(b.id).toBe(`REC-${CODE}-${YEAR}-002`);
    expect(other.id).toBe(`REC-${CODE}-${YEAR + 1}-001`); // a new year restarts the count
    expect(a.arrivalDate).toBe(D);
  });

  it("is refused at a warehouse with no code, instead of guessing one", async () => {
    await expect(createReceipt(NOCODE, D)).rejects.toThrow(/has no code yet/);
    expect(await prisma.receipt.count({ where: { warehouse: NOCODE } })).toBe(0);
  });

  it("never collides under concurrent creates", async () => {
    const made = await Promise.allSettled(Array.from({ length: 5 }, () => createReceipt(SITE, `${YEAR}-06-01`)));
    const ids = made.flatMap((m) => (m.status === "fulfilled" ? [m.value.id] : []));
    expect(new Set(ids).size).toBe(ids.length); // serializable transactions: losers fail, none duplicate
    expect(ids.length).toBeGreaterThan(0);
  });
});

describe("Lot Number — issued when the truck passes quality", () => {
  let id: string;
  beforeAll(async () => { id = (await createReceipt(SITE, `${YEAR}-04-01`)).id; });

  it("a new truck has no Lot", async () => {
    expect((await getReceipt(id))!.lotNo ?? "").toBe("");
  });

  it("issues LOT-<code>-<year>-NNN on Pass, once, and records it on the timeline", async () => {
    const r = await setBranch(id, "n-qfs", "pass");
    expect(r.lotNo).toMatch(new RegExp(`^LOT-${CODE}-${YEAR}-\\d{3}$`));
    expect(r.timeline[r.timeline.length - 1].note).toBe(`Lot ${r.lotNo} issued`);
    const lot = await prisma.stageLotAssignment.findUniqueOrThrow({ where: { receiptId: id } });
    expect(lot).toMatchObject({ lotNumber: r.lotNo, warehouseName: SITE, assignedBy: "System" });
    expect(lot.assignedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("keeps the same Lot if the decision is changed and passed again — it is never reissued", async () => {
    const first = (await getReceipt(id))!.lotNo;
    await setBranch(id, "n-qfs", "fail", "Moisture too high");
    expect((await getReceipt(id))!.lotNo).toBe(first); // a Lot is never taken back
    const again = await setBranch(id, "n-qfs", "pass");
    expect(again.lotNo).toBe(first);
  });

  it("a failed truck is not given a Lot", async () => {
    const failed = (await createReceipt(SITE, `${YEAR}-04-02`)).id;
    const r = await setBranch(failed, "n-qfs", "fail", "Mouldy");
    expect(r.lotNo ?? "").toBe("");
    expect(r.status).toBe("rejected");
  });

  it("one accepted truck = one Lot: the next truck gets the next number", async () => {
    const next = (await createReceipt(SITE, `${YEAR}-04-03`)).id;
    const r = await setBranch(next, "n-qfs", "pass");
    const mine = parseSiteId((await getReceipt(id))!.lotNo)!;
    expect(parseSiteId(r.lotNo)!.seq).toBeGreaterThan(mine.seq);
  });

  it("nobody can type or change a Lot", async () => {
    await expect(setStageFields(id, "n-lot", { "Lot Number": "LOT-X-1" })).rejects.toThrow(/issued by the system/);
    await expect(patchReceipt(id, { lotNo: "LOT-X-1" })).rejects.toThrow(/issued by the system/);
  });

  it("continues after the 2026 workbook's own lots, so it can't collide with legacy Lot 1…454", async () => {
    // Real data: Bouaké's discharge sheet holds Lot 1..454 for 2026, as bare integers until the
    // renumber has run and as LOT-BKE01-2026-NNN after it. Either way the next one must be past them.
    const next = await nextLotNumber(prisma, "BOUAKE", "2026-06-01");
    expect(parseSiteId(next)!.seq).toBeGreaterThanOrEqual(455);
  });
});

describe("calculated weights, bags and amount", () => {
  let id: string;
  beforeAll(async () => { id = (await createReceipt(SITE, `${YEAR}-05-01`)).id; });

  it("fill themselves from the readings, in order, as each one arrives", async () => {
    await setStageFields(id, "n-gross", { "Loaded truck weight (kg)": "56300" });
    await setStageFields(id, "n-unload", { "BON SACS (good bags)": "463", "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "15", Refraction: "60" });
    let r = (await getReceipt(id))!;
    expect(r.stageData["n-unload"]["SACS (bags)"]).toBe("478");
    expect(r.stageData["n-netwt"]).toBeUndefined(); // no empty-truck weight yet — nothing to subtract

    await setStageFields(id, "n-tare", { "Tare / empty truck weight (kg)": "15000" });
    await setStageFields(id, "n-grn", { PRICE: "470" });
    r = (await getReceipt(id))!;
    expect(r.stageData["n-gross"]["GROSS WT KGS"]).toBe("41300");
    expect(r.stageData["n-netwt"]).toMatchObject({ "NET WT KGS": "40822", "PAID WT": "40762" });
    expect(r.stageData["n-grn"]["AMOUNT"]).toBe("19158140"); // the real sample row's figures
  });

  it("recalculate when a reading is corrected", async () => {
    await setStageFields(id, "n-tare", { "Tare / empty truck weight (kg)": "15100" });
    const r = (await getReceipt(id))!;
    expect(r.stageData["n-gross"]["GROSS WT KGS"]).toBe("41200");
    expect(r.stageData["n-netwt"]["NET WT KGS"]).toBe("40722");
  });

  it("can't be typed", async () => {
    await expect(setStageFields(id, "n-netwt", { "NET WT KGS": "1" })).rejects.toThrow(/is calculated/);
    await expect(setStageFields(id, "n-unload", { "SACS (bags)": "1" })).rejects.toThrow(/Good \+ damp \+ torn/);
    await expect(setStageFields(id, "n-grn", { AMOUNT: "1" })).rejects.toThrow(/Price × paid weight/);
  });

  it("are left alone on imported records, which keep what the workbook recorded", async () => {
    const imported = (await createReceipt(SITE, `${YEAR}-05-02`)).id;
    await setStageFields(imported, "n-unload", { "SACS (bags)": "999", "BON SACS (good bags)": "1" }, { bypassValidation: true });
    expect((await getReceipt(imported))!.stageData["n-unload"]["SACS (bags)"]).toBe("999");
  });
});

describe("Delivery Plan", () => {
  let planId: string;

  it("is DP-<code>-<expected year>-NNN, filed under the warehouse's site", async () => {
    const plan = await createDeliveryPlan({
      supplierName: "Plan Supplier", supplierCode: "LBA-PLAN", expectedQuantityKg: "20 000", expectedTruckType: "10-wheeler",
      expectedArrivalDate: `${YEAR}-07-10`, destinationWarehouse: SITE,
    });
    planId = plan.id;
    expect(plan.id).toBe(`DP-${CODE}-${YEAR}-001`);
    expect(plan).toMatchObject({ expectedQuantityKg: 20000, deliveryStatus: "planned", actualArrivalDate: null, truckNo: null });
  });

  it("reads as overdue once its expected date has passed with no truck", async () => {
    const late = await createDeliveryPlan({ supplierName: "Late Supplier", expectedArrivalDate: "2025-01-10", destinationWarehouse: SITE });
    expect(late.id).toBe(`DP-${CODE}-2025-001`);
    expect(late.deliveryStatus).toBe("overdue");
  });

  it("a truck that arrives against it copies its supplier, and the plan then reads as arrived", async () => {
    const r = await createReceipt(undefined, `${YEAR}-07-12`, planId);
    expect(r).toMatchObject({ warehouse: SITE, supplierName: "Plan Supplier", lbaCode: "LBA-PLAN" });
    // Typed on the Gate stage, which is where the form puts it — the receipt's own column stays blank.
    await setStageFields(r.id, "n-gate", { "VEHICLE NO.": "PLAN-TRUCK" });
    expect(await getDeliveryPlan(planId)).toMatchObject({
      deliveryStatus: "arrived", actualArrivalDate: `${YEAR}-07-12`, truckNo: "PLAN-TRUCK", receiptIds: [r.id],
    });
  });

  it("is optional — a truck with no plan is allowed", async () => {
    expect((await createReceipt(SITE, `${YEAR}-07-13`)).id).toMatch(/^REC-/);
  });

  it("can't be used for a different warehouse, and its warehouse can't be changed", async () => {
    await expect(createReceipt("BOUAKE", D, planId)).rejects.toThrow(/is for/);
    await expect(updateDeliveryPlan(planId, { destinationWarehouse: "BOUAKE" })).rejects.toThrow(/can't be changed/);
    expect(await updateDeliveryPlan(planId, { remarks: "moved a day" })).toMatchObject({ remarks: "moved a day" });
  });

  it("needs a supplier, a date and a warehouse that has a code", async () => {
    await expect(createDeliveryPlan({ expectedArrivalDate: D, destinationWarehouse: SITE })).rejects.toThrow(/supplier/);
    await expect(createDeliveryPlan({ supplierName: "S", expectedArrivalDate: "soon", destinationWarehouse: SITE })).rejects.toThrow(/date/);
    await expect(createDeliveryPlan({ supplierName: "S", expectedArrivalDate: D, destinationWarehouse: NOCODE })).rejects.toThrow(/no code yet/);
  });
});

describe("Transfer Request", () => {
  let lotted: string;
  let lotNumber: string;

  beforeAll(async () => {
    lotted = (await createReceipt(SITE, `${YEAR}-08-01`)).id;
    lotNumber = (await setBranch(lotted, "n-qfs", "pass")).lotNo!;
  });

  it("is BKT-<year>-NNN, takes its Lots from the receipts, and marks them transferred out", async () => {
    const t = await createTransfer({ transferDate: `${YEAR}-08-05`, fromWarehouse: SITE, toWarehouse: "BOUAKE", lines: [{ receiptId: lotted, bags: 478, netWeightKg: "40822" }] });
    expect(t.id).toBe(`BKT-${YEAR}-001`);
    expect(t).toMatchObject({ status: "requested", fromWarehouse: SITE, toWarehouse: "BOUAKE" });
    expect(t.lines[0]).toMatchObject({ receiptId: lotted, lotNumber, bags: 478, netWeightKg: 40822 });
    const r = (await getReceipt(lotted))!;
    expect(r.status).toBe("transferred_out");
    expect(r.timeline[r.timeline.length - 1].note).toBe(`Added to transfer ${t.id}`);
  });

  it("a Lot leaves a warehouse once", async () => {
    await expect(createTransfer({ transferDate: `${YEAR}-08-06`, fromWarehouse: SITE, toWarehouse: "BOUAKE", lines: [{ receiptId: lotted }] }))
      .rejects.toThrow(/already on transfer/);
    expect(await prisma.transferRequest.count({ where: { id: `BKT-${YEAR}-002` } })).toBe(0); // all-or-nothing
  });

  it("only a truck that passed quality can be transferred, and only from where it is", async () => {
    const noLot = (await createReceipt(SITE, `${YEAR}-08-07`)).id;
    const failed = (await createReceipt(SITE, `${YEAR}-08-08`)).id;
    await setBranch(failed, "n-qfs", "fail", "Mouldy");
    const go = (receiptId: string, from = SITE) => createTransfer({ transferDate: D, fromWarehouse: from, toWarehouse: "BOUAKE", lines: [{ receiptId }] });
    await expect(go(noLot)).rejects.toThrow(/no Lot yet/);
    await expect(go(failed)).rejects.toThrow(/no Lot yet|rejected/);
    await expect(createTransfer({ transferDate: D, fromWarehouse: "BOUAKE", toWarehouse: SITE, lines: [{ receiptId: noLot }] })).rejects.toThrow(/is at/);
    await expect(createTransfer({ transferDate: D, fromWarehouse: SITE, toWarehouse: SITE, lines: [{ receiptId: noLot }] })).rejects.toThrow(/different warehouse/);
  });

  it("steps requested → dispatched → received, never skipping or going back", async () => {
    const id = `BKT-${YEAR}-001`;
    await expect(setTransferStatus(id, "received")).rejects.toThrow(/can only move to dispatched/);
    expect((await setTransferStatus(id, "dispatched")).status).toBe("dispatched");
    await expect(setTransferStatus(id, "requested")).rejects.toThrow(ValidationError);
    expect((await setTransferStatus(id, "received")).status).toBe("received");
    await expect(addTransferLines(id, [{ receiptId: lotted }])).rejects.toThrow(/already received/);
    expect((await getTransfer(id))!.status).toBe("received");
  });

  it("continues after the 2026 dispatch sheet's own BKT numbers, so it can't collide with BKT001…BKT-414", async () => {
    // Real data: 413 distinct voyages up to BKT-414 — as the workbook wrote them until the renumber
    // has run, as BKT-2026-NNN after it. Either way the next one is past them.
    const next = await nextTransferId(prisma, "2026-09-01");
    expect(parseTransferId(next)!.seq).toBeGreaterThanOrEqual(415);
  });
});

describe("old receipt ids", () => {
  it("still open the receipt after it was renumbered", async () => {
    const r = await createReceipt(SITE, `${YEAR}-09-09`);
    await prisma.receipt.update({ where: { id: r.id }, data: { legacyId: "REC-2026-9999" } }); // what the renumber records
    expect((await getReceipt("REC-2026-9999"))!.id).toBe(r.id);
    expect((await getReceipt("REC-2026-9999"))!.legacyId).toBe("REC-2026-9999");
    expect(await getReceipt("REC-2026-9998")).toBeNull();
  });
});

describe("Warehouse code in the master", () => {
  it("is validated, and frozen once IDs carry it", async () => {
    await expect(setWarehouseCode(SITE + "-X", "AB1")).rejects.toThrow(/not found/i);
    await expect(setWarehouseCode(NOCODE, "bad code")).rejects.toThrow(/capital letters or digits/);
    expect((await setWarehouseCode(NOCODE, "sidt2")).code).toBe("SIDT2"); // normalised to capitals
    expect((await setWarehouseCode(NOCODE, null)).code).toBeNull(); // changeable while nothing uses it

    await expect(setWarehouseCode(SITE, "OTHER")).rejects.toThrow(/already printed in issued IDs/);
    await expect(setWarehouseCode(SITE, null)).rejects.toThrow(/already printed in issued IDs/);
  });

  it("is unique, and not settable on a store", async () => {
    await expect(setWarehouseCode(NOCODE, CODE)).rejects.toMatchObject({ code: "P2002" });
    await expect(setWarehouseCode("BKE-002", "ZZ1")).rejects.toThrow(/is a store of/);
  });
});
