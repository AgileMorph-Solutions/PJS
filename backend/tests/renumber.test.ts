/**
 * The guard for the one-off move of existing data onto system IDs (services/renumber.ts), in the
 * spirit of roundTrip.test.ts / statusParity.test.ts: a renumber could silently corrupt data in ways
 * that look fine at a glance — a receipt losing its stages, a status moving, a lot pointing at the
 * wrong truck — so this checks each of those.
 *
 * It runs on FIXTURE data the test creates itself (a throwaway warehouse holding receipts, lots, a
 * discharge row and a dispatch line in the old format), not on whatever the live database holds: the
 * real data has been renumbered once already, so a test that expected "work to do" would only pass
 * before that happened. The renumber is applied inside a transaction that is rolled back, so nothing
 * persists either way.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { deriveStatus } from "@anagroci/contract/domain/receiptStatus";
import { parseSiteId, parseTransferId } from "@anagroci/contract/domain/ids";
import { RECEIPT_INCLUDE, assembleBranches, assembleStageData } from "../src/stageStore.js";
import { planRenumber, writeRenumber, renumberCsv, type RenumberPlan } from "../src/services/renumber.js";

const prisma = new PrismaClient();
class Rollback extends Error {}
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const SITE = "RENUMTEST-SITE";
const NOCODE = "RENUMTEST-NOCODE";
const CODE = "RNT01";
// Old-format ids, as the 2026 seed produced them (trailing number = the order they were first made).
const R = ["REC-RNTEST-0001", "REC-RNTEST-0002", "REC-RNTEST-0003"] as const;
const R_NOCODE = "REC-RNTEST-0004";
// Already a system id, but under a code the client has since replaced (BKE01 → BKE): same number,
// new code. legacyId holds the ORIGINAL id and must survive the second move.
const R_OLD = "REC-OLDC-2028-0003";
const R_OLD_ORIGINAL = "REC-RNTEST-0090";
const R_NEXT = "REC-RNTEST-0005"; // a still-unmoved 2028 receipt: must continue AFTER the old-code one
const DP_OLD = "DP-OLDC-2028-001";

async function cleanup() {
  await prisma.warehouseDispatchLine.deleteMany({ where: { warehouseSite: SITE } });
  await prisma.warehouseDischarge.deleteMany({ where: { warehouseSite: SITE } });
  await prisma.receipt.deleteMany({ where: { OR: [{ warehouse: { in: [SITE, NOCODE] } }, { legacyId: { in: [...R, R_NOCODE, R_OLD_ORIGINAL] } }] } });
  await prisma.deliveryPlan.deleteMany({ where: { destinationWarehouse: SITE } });
  await prisma.warehouse.deleteMany({ where: { name: { in: [SITE, NOCODE] } } });
}

beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: SITE, kind: "REGIONAL_CENTRAL", type: "UNIT", code: CODE } });
  await prisma.warehouse.create({ data: { name: NOCODE, kind: "REGIONAL_CENTRAL", type: "UNIT" } });

  // Two 2026 receipts and one 2027 one, each with a gate, a fiche and a bare lot — plus one at a
  // warehouse that has no code.
  const make = async (id: string, warehouse: string, arrival: string, lot: string | null, fiche: string, legacyId?: string) => {
    await prisma.receipt.create({
      data: {
        id, legacyId, source: "imported", arrivalDate: arrival, supplierName: "Fixture", lbaCode: "LBA-FX", vehicleNo: `TRUCK-${id.slice(-1)}`, warehouse,
        timeline: { create: [{ status: "arrived", at: arrival }] },
        stageEntries: { create: [{ stageId: "n-gate" }, { stageId: "n-verify" }, ...(lot ? [{ stageId: "n-lot" }] : [])] },
        gate: { create: { vehicleNo: `TRUCK-${id.slice(-1)}` } },
        verify: { create: { fiche } },
        ...(lot ? { lot: { create: { lotNumber: lot, warehouseName: warehouse } } } : {}),
      },
    });
  };
  await make(R[0], SITE, "2026-02-10", "5", "FX-1");
  await make(R[1], SITE, "2026-03-11", "6", "FX-2");
  await make(R[2], SITE, "2027-01-12", "7", "FX-3");
  await make(R_NOCODE, NOCODE, "2026-04-01", "9", "FX-4");
  await make(R_OLD, SITE, "2028-02-01", "LOT-OLDC-2028-0003", "FX-5", R_OLD_ORIGINAL);
  await make(R_NEXT, SITE, "2028-03-01", null, "FX-6");
  await prisma.deliveryPlan.create({
    data: { id: DP_OLD, supplierName: "Fixture", expectedArrivalDate: "2028-02-01", destinationWarehouse: SITE },
  });

  // The imported rows that hold the same lot / voyage as text.
  await prisma.warehouseDischarge.create({
    data: { sn: 90001, warehouseSite: SITE, lotNo: "5", ficheCca: "FX-1", arrivalDate: new Date("2026-02-10") },
  });
  await prisma.warehouseDischarge.create({
    data: { sn: 90002, warehouseSite: SITE, lotNo: "12,5", ficheCca: "FX-9", arrivalDate: new Date("2026-02-12") }, // two lots in one cell
  });
  await prisma.warehouseDispatchLine.create({
    data: { warehouseSite: SITE, vyogeNumber: "BKT007", chargeDate: new Date("2026-05-01"), source: "renumber-test", sheetRow: 1 },
  });
  await prisma.warehouseDispatchLine.create({
    data: { warehouseSite: SITE, vyogeNumber: "BKT-414", chargeDate: new Date("2026-05-02"), source: "renumber-test", sheetRow: 2 },
  });
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

/** Applies the renumber for real, lets `fn` look at the result, then rolls everything back. */
async function withRenumberApplied(fn: (tx: Tx, plan: RenumberPlan) => Promise<void>) {
  await expect(
    prisma.$transaction(async (tx) => {
      const plan = await planRenumber(tx);
      await writeRenumber(tx, plan);
      await fn(tx, plan);
      throw new Rollback();
    }, { timeout: 120_000, maxWait: 30_000 })
  ).rejects.toBeInstanceOf(Rollback);
}

const statusOf = (row: any) => deriveStatus({ stageData: assembleStageData(row), branches: assembleBranches(row) });
const fixtureChanges = (plan: RenumberPlan) => plan.changes.filter((c) => (R as readonly string[]).includes(c.key) || c.to.includes(CODE) || c.from === "5" || c.from === "BKT007" || c.from === "BKT-414");

describe("renumber plan", () => {
  it("lists every change with the old and new value, and writes nothing", async () => {
    const plan = await planRenumber();
    expect(renumberCsv(plan).split("\n")[0]).toBe("table,key,column,from,to");
    expect(renumberCsv(plan)).toContain(`${R[0]},id,${R[0]},REC-${CODE}-2026-0001`);
    expect(await prisma.receipt.count({ where: { id: { in: [...R] } } })).toBe(3); // still there, still old
    expect(await prisma.receipt.count({ where: { legacyId: { in: [...R] } } })).toBe(0);
  });

  it("numbers receipts per warehouse code and arrival year, in their old order", async () => {
    const receipts = (await planRenumber()).changes.filter((c) => c.table === "Receipt" && (R as readonly string[]).includes(c.from!));
    expect(receipts.map((c) => [c.from, c.to])).toEqual([
      [R[0], `REC-${CODE}-2026-0001`],
      [R[1], `REC-${CODE}-2026-0002`],
      [R[2], `REC-${CODE}-2027-0001`], // a new year restarts the count
    ]);
  });

  it("moves an id under a replaced code to the current code with the SAME number, and continues after it", async () => {
    const plan = await planRenumber();
    const byFrom = new Map(plan.changes.filter((c) => c.table === "Receipt").map((c) => [c.from, c.to]));
    expect(byFrom.get(R_OLD)).toBe(`REC-${CODE}-2028-0003`); // number kept, not renumbered from 1
    // The unmoved 2028 receipt takes the next number after the old-code one — never a number already in use.
    expect(byFrom.get(R_NEXT)).toBe(`REC-${CODE}-2028-0004`);
    expect(plan.changes).toContainEqual(expect.objectContaining({ table: "StageLotAssignment", key: R_OLD, to: `LOT-${CODE}-2028-0003`, rawColumn: undefined }));
    expect(plan.changes).toContainEqual(expect.objectContaining({ table: "DeliveryPlan", key: DP_OLD, to: `DP-${CODE}-2028-001` }));
  });

  it("leaves a warehouse with no code alone and says so, instead of inventing one", async () => {
    const plan = await planRenumber();
    expect(plan.changes.some((c) => c.key === R_NOCODE)).toBe(false);
    expect(plan.changes.some((c) => c.table === "StageLotAssignment" && c.key === R_NOCODE)).toBe(false);
    expect(plan.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "Receipt", reason: `warehouse ${NOCODE} has no code yet`, sample: expect.arrayContaining([R_NOCODE]) }),
    ]));
  });

  it("leaves a value that isn't one lot exactly as written, and reports it", async () => {
    const plan = await planRenumber();
    expect(plan.changes.some((c) => c.from === "12,5")).toBe(false);
    expect(plan.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ table: "WarehouseDischarge", reason: "not a single lot number" })]));
  });
});

describe("renumber applied (rolled back afterwards)", { timeout: 120_000 }, () => {
  it("loses nothing: every receipt keeps its stages, timeline and its old id", async () => {
    const before = await prisma.stageEntry.count({ where: { receiptId: { in: [...R] } } });
    expect(before).toBe(9);
    await withRenumberApplied(async (tx) => {
      const moved = await tx.receipt.findMany({ where: { legacyId: { in: [...R] } }, orderBy: { legacyId: "asc" }, select: { id: true, legacyId: true } });
      expect(moved.map((m) => [m.legacyId, m.id])).toEqual([
        [R[0], `REC-${CODE}-2026-0001`], [R[1], `REC-${CODE}-2026-0002`], [R[2], `REC-${CODE}-2027-0001`],
      ]);
      const ids = moved.map((m) => m.id);
      expect(await tx.stageEntry.count({ where: { receiptId: { in: ids } } })).toBe(before); // the cascade carried them
      expect(await tx.timelineEntry.count({ where: { receiptId: { in: ids } } })).toBe(3);
      expect((await tx.stageVerifyDocs.findMany({ where: { receiptId: { in: ids } }, orderBy: { fiche: "asc" } })).map((v) => v.fiche)).toEqual(["FX-1", "FX-2", "FX-3"]);
      expect(await tx.receipt.count({ where: { id: { in: [...R] } } })).toBe(0); // old ids are gone, not duplicated
    });
  });

  it("keeps the ORIGINAL legacy id when an id is moved a second time, and carries the plan link and lot with it", async () => {
    await withRenumberApplied(async (tx) => {
      const moved = await tx.receipt.findUniqueOrThrow({ where: { id: `REC-${CODE}-2028-0003` }, select: { legacyId: true } });
      expect(moved.legacyId).toBe(R_OLD_ORIGINAL); // not overwritten with REC-OLDC-2028-0003
      expect((await tx.receipt.findUniqueOrThrow({ where: { id: `REC-${CODE}-2028-0004` } })).legacyId).toBe(R_NEXT);
      expect(await tx.deliveryPlan.count({ where: { id: `DP-${CODE}-2028-001` } })).toBe(1);
      expect(await tx.receipt.count({ where: { id: R_OLD } })).toBe(0);
    });
  });

  it("changes no receipt's derived status", async () => {
    const before = new Map((await prisma.receipt.findMany({ where: { id: { in: [...R] } }, include: RECEIPT_INCLUDE })).map((r) => [r.id, statusOf(r)]));
    expect([...before.values()]).toEqual(["pending_qa", "pending_qa", "pending_qa"]); // gate + supplier docs reached
    await withRenumberApplied(async (tx) => {
      const after = await tx.receipt.findMany({ where: { legacyId: { in: [...R] } }, include: RECEIPT_INCLUDE });
      for (const r of after) expect(statusOf(r), r.legacyId!).toBe(before.get(r.legacyId!));
    });
  });

  it("converts each lot to the same number in the new format, everywhere it appears", async () => {
    await withRenumberApplied(async (tx) => {
      const lots = await tx.stageLotAssignment.findMany({ where: { receiptId: { startsWith: `REC-${CODE}-` } }, orderBy: { lotNumber: "asc" } });
      expect(lots.map((l) => l.lotNumber)).toEqual([`LOT-${CODE}-2026-0005`, `LOT-${CODE}-2026-0006`, `LOT-${CODE}-2027-0007`, `LOT-${CODE}-2028-0003`]); // "5" → 0005, same number
      expect(lots.every((l) => l.warehouseName === SITE)).toBe(true);

      // The discharge sheet row for the same lot and fiche agrees with the receipt, and keeps the workbook's text.
      const row = await tx.warehouseDischarge.findFirstOrThrow({ where: { warehouseSite: SITE, ficheCca: "FX-1" } });
      expect(row).toMatchObject({ lotNo: `LOT-${CODE}-2026-0005`, lotNoRaw: "5" });
      expect(row.lotNo).toBe(lots[0]!.lotNumber);

      // Two lots in one cell can't be given one number: untouched.
      expect(await tx.warehouseDischarge.findFirstOrThrow({ where: { warehouseSite: SITE, ficheCca: "FX-9" } })).toMatchObject({ lotNo: "12,5", lotNoRaw: null });

      // The no-code warehouse's lot is exactly as it was.
      expect((await tx.stageLotAssignment.findUniqueOrThrow({ where: { receiptId: R_NOCODE } })).lotNumber).toBe("9");
    });
  });

  it("converts BKT voyage numbers in both 2026 spellings and keeps the workbook's text beside them", async () => {
    await withRenumberApplied(async (tx) => {
      const lines = await tx.warehouseDispatchLine.findMany({ where: { warehouseSite: SITE }, orderBy: { sheetRow: "asc" } });
      expect(lines.map((l) => [l.vyogeNumberRaw, l.vyogeNumber])).toEqual([["BKT007", "BKT-2026-007"], ["BKT-414", "BKT-2026-414"]]);
      expect(parseTransferId(lines[1]!.vyogeNumber)).toEqual({ year: 2026, seq: 414 });
    });
  });

  it("is a no-op the second time", async () => {
    await withRenumberApplied(async (tx) => {
      const again = await planRenumber(tx);
      expect(fixtureChanges(again)).toEqual([]);
      for (const c of again.changes) expect(parseSiteId(c.from)?.kind, `${c.table} ${c.key}`).not.toMatch(/REC|LOT/); // nothing already converted is touched
    });
  });
});
