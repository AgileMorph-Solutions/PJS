/**
 * assertOneBinPerBtm / assertOneBinPerLot, exercised through the actual service functions
 * (services/production/btm.ts, lots.ts) rather than calling the assert functions directly — proves
 * the whole write path (auto-observe on first write, enforce on conflict), not just the pure
 * function. Disposable fixture rows, cleaned up in afterEach.
 */
import { describe, it, expect, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { addBtmReceiptLine } from "../src/services/production/btm.js";
import { createCookingRun, addShellingRunRow } from "../src/services/production/lots.js";
import { ValidationError } from "../src/domain/validation.js";

const prisma = new PrismaClient();

const BTM = "TEST-VALIDATION-BTM";
const LOT = "TEST-VALIDATION-LOT";
const BIN_A = "TEST-BIN-A";
const BIN_B = "TEST-BIN-B";

afterEach(async () => {
  await prisma.btmReceipt.deleteMany({ where: { btmNo: BTM } });
  await prisma.btmIntake.deleteMany({ where: { btmNo: BTM } });
  await prisma.cookingRun.deleteMany({ where: { lotNo: LOT } });
  await prisma.shellingRun.deleteMany({ where: { lotNo: LOT } });
  await prisma.productionLot.deleteMany({ where: { lotNo: LOT } });
  await prisma.productionBin.deleteMany({ where: { binNo: { in: [BIN_A, BIN_B] } } });
});

describe("assertOneBinPerBtm (via services/production/btm.ts)", () => {
  it("auto-observes the Bin on first write", async () => {
    await addBtmReceiptLine(BTM, BIN_A, { "S.No": "1" });
    const intake = await prisma.btmIntake.findUnique({ where: { btmNo: BTM } });
    expect(intake?.binNo).toBe(BIN_A);
    const bin = await prisma.productionBin.findUnique({ where: { binNo: BIN_A } });
    expect(bin).toBeTruthy();
  });

  it("a second line for the same BTM against the same Bin succeeds", async () => {
    await addBtmReceiptLine(BTM, BIN_A, { "S.No": "1" });
    await addBtmReceiptLine(BTM, BIN_A, { "S.No": "2" });
    const rows = await prisma.btmReceipt.findMany({ where: { btmNo: BTM } });
    expect(rows.length).toBe(2);
  });

  it("a second line for the same BTM against a DIFFERENT Bin is rejected", async () => {
    await addBtmReceiptLine(BTM, BIN_A, { "S.No": "1" });
    await expect(addBtmReceiptLine(BTM, BIN_B, { "S.No": "2" })).rejects.toThrow(ValidationError);
    // And the first line's write was not clobbered.
    const rows = await prisma.btmReceipt.findMany({ where: { btmNo: BTM } });
    expect(rows.length).toBe(1);
  });
});

describe("assertOneBinPerLot (via services/production/lots.ts)", () => {
  it("Cooking creates the Lot, auto-observing the Bin", async () => {
    await createCookingRun(LOT, BIN_A, { "Lot No": LOT });
    const lot = await prisma.productionLot.findUnique({ where: { lotNo: LOT } });
    expect(lot?.binNo).toBe(BIN_A);
  });

  it("a second cooking row for the same Lot against a DIFFERENT Bin is rejected", async () => {
    await createCookingRun(LOT, BIN_A, { "Lot No": LOT });
    await expect(createCookingRun(LOT, BIN_B, { "Lot No": LOT })).rejects.toThrow(ValidationError);
  });

  it("shelling a Lot that hasn't been cooked yet is rejected", async () => {
    await expect(addShellingRunRow(LOT, { "Lot No": LOT })).rejects.toThrow(ValidationError);
  });

  it("shelling a Lot that HAS been cooked succeeds", async () => {
    await createCookingRun(LOT, BIN_A, { "Lot No": LOT });
    const row = await addShellingRunRow(LOT, { "Lot No": LOT });
    expect(row).toBeTruthy();
  });
});
