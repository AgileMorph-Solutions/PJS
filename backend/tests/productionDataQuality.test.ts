/**
 * Each new production check exercised against disposable fixture rows created and deleted within
 * the test — there is no seeded production data yet (see the plan's "Deferred" section), so this
 * proves the check LOGIC correctly rather than asserting a measured count against real data (that
 * style, matching tests/dataQuality.test.ts's convention, is deferred to the extractor pass).
 */
import { describe, it, expect, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { CHECKS } from "../src/domain/dataQuality/checks.js";

const prisma = new PrismaClient();
const checkById = (id: string) => CHECKS.find((c) => c.id === id)!;

const BIN = "TEST-DQ-BIN";
// production_btm_namespace_split only counts PURELY numeric btmNo values (that's the point of the
// check — it's comparing two numbering series) — a "TEST-DQ-" prefix would never match, so these
// two get their own bare-numeric, still-namespaced-enough-to-be-safe values and their own cleanup.
// < 1000 / >= 1000, both chosen well outside the real seeded ranges (101–153, 1001–1055) —
// real production data now lives in this DB (tools/extract-production.py), so a value inside
// either real range risks colliding with an actual BTM, which "150" originally did.
const BTM_NUMERIC_LOW = "777";
const BTM_NUMERIC_HIGH = "9991001";

afterEach(async () => {
  await prisma.btmReceipt.deleteMany({ where: { btmNo: { startsWith: "TEST-DQ-" } } });
  await prisma.btmIntake.deleteMany({ where: { btmNo: { startsWith: "TEST-DQ-" } } });
  await prisma.btmIntake.deleteMany({ where: { btmNo: { in: [BTM_NUMERIC_LOW, BTM_NUMERIC_HIGH] } } });
  await prisma.btmInputQuality.deleteMany({ where: { btmNo: { startsWith: "TEST-DQ-" } } });
  await prisma.finalOutputSample.deleteMany({ where: { lotNo: { startsWith: "TEST-DQ-" } } });
  await prisma.bormaTrolleyRow.deleteMany({ where: { binNo: { startsWith: "TEST-DQ-" } } });
  await prisma.silosStockRow.deleteMany({ where: { binNo: BIN } });
  await prisma.productionBin.deleteMany({ where: { binNo: BIN } });
});

describe("production_btm_namespace_split", () => {
  it("fires when BTM numbers span both ranges", async () => {
    await prisma.productionBin.upsert({ where: { binNo: BIN }, update: {}, create: { binNo: BIN } });
    await prisma.btmIntake.createMany({ data: [{ btmNo: BTM_NUMERIC_LOW, binNo: BIN }, { btmNo: BTM_NUMERIC_HIGH, binNo: BIN }] });
    const finding = await checkById("production_btm_namespace_split").run({ prisma });
    expect(finding).toBeTruthy();
    expect(finding!.affectedCount).toBeGreaterThanOrEqual(2);
  });
});

describe("production_source_bin_spelling_drift", () => {
  it("fires when the same bin is spelled two ways", async () => {
    await prisma.btmReceipt.createMany({
      data: [
        { btmNo: "TEST-DQ-A", sourceBinNo: "95" },
        { btmNo: "TEST-DQ-B", sourceBinNo: "BIN-095" },
      ],
    });
    const finding = await checkById("production_source_bin_spelling_drift").run({ prisma });
    expect(finding).toBeTruthy();
    expect(finding!.affectedCount).toBe(2);
  });

  it("does not fire when every spelling is identical", async () => {
    await prisma.btmReceipt.createMany({
      data: [{ btmNo: "TEST-DQ-A", sourceBinNo: "95" }, { btmNo: "TEST-DQ-B", sourceBinNo: "95" }],
    });
    const finding = await checkById("production_source_bin_spelling_drift").run({ prisma });
    expect(finding).toBeNull();
  });
});

describe("production_composite_cell", () => {
  it("fires on a comma-separated Lot No", async () => {
    await prisma.finalOutputSample.create({ data: { lotNo: "TEST-DQ-ANG26E01,E02" } });
    const finding = await checkById("production_composite_cell").run({ prisma });
    expect(finding).toBeTruthy();
    expect(finding!.affectedCount).toBeGreaterThanOrEqual(1);
  });

  it("fires on a slash-separated BIN No", async () => {
    await prisma.bormaTrolleyRow.create({ data: { binNo: "TEST-DQ-ANA-03B/10/16" } });
    const finding = await checkById("production_composite_cell").run({ prisma });
    expect(finding).toBeTruthy();
  });
});

describe("production_silo_batch_bin_column_shift", () => {
  it("fires when Batch No holds a bare integer", async () => {
    await prisma.silosStockRow.create({ data: { binNo: BIN, batchNo: "801" } });
    const finding = await checkById("production_silo_batch_bin_column_shift").run({ prisma });
    expect(finding).toBeTruthy();
  });

  it("does not fire when Batch No is blank", async () => {
    await prisma.silosStockRow.create({ data: { binNo: BIN, batchNo: null } });
    const finding = await checkById("production_silo_batch_bin_column_shift").run({ prisma });
    expect(finding).toBeNull();
  });
});

describe("production_input_quality_lot_column_mislabeled", () => {
  it("fires whenever btm-input-quality's Lot No column has any value at all", async () => {
    await prisma.btmInputQuality.create({ data: { btmNo: "TEST-DQ-A", lotNo: "96" } });
    const finding = await checkById("production_input_quality_lot_column_mislabeled").run({ prisma });
    expect(finding).toBeTruthy();
  });
});

describe("production_lot_without_bin is structurally impossible, not just checked for", () => {
  it("ProductionLot.binNo is a non-nullable hard FK — the DB itself rejects a lot with no bin", async () => {
    await expect(
      prisma.productionLot.create({ data: { lotNo: "TEST-DQ-NOBIN", binNo: "TEST-DQ-NONEXISTENT-BIN" } })
    ).rejects.toThrow(); // P2003: foreign key constraint fails — no bin, no lot, full stop.
  });
});
