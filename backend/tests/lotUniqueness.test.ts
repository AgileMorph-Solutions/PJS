/**
 * The bug this guards against: services/receipts.ts's n-lot clash check used to look for a
 * collision GLOBALLY, while the DB index (StageLotAssignment_warehouse_lotNumber_assigned_key) has
 * always been PER WAREHOUSE. Invisible while every real lot came from the Bouaké-only import — the
 * instant a second site's receipt tries to reuse "Lot 1", the old code rejected it with the wrong
 * error. Also proves warehouseName gets written on every manual n-lot entry (see receipts.ts's own
 * comment): before this fix a hand-typed lot always stored warehouseName = NULL, which Postgres's
 * partial unique index never treats as colliding with anything — a silent bypass of the very rule
 * this test exists to prove.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { setStageFields } from "../src/services/receipts.js";
import { ValidationError } from "../src/domain/validation.js";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

describe("lot uniqueness is per warehouse, through the service path", () => {
  const RECEIPT_BOUAKE_1 = "REC-LOTUNIQ-TEST-B1";
  const RECEIPT_BOUAKE_2 = "REC-LOTUNIQ-TEST-B2";
  const RECEIPT_YAKRO_1 = "REC-LOTUNIQ-TEST-Y1";
  let bouake: string, yakro: string;

  beforeAll(async () => {
    const sites = await prisma.warehouse.findMany({ where: { name: { in: ["BOUAKE", "YAKRO FACTORY"] } } });
    bouake = sites.find((s) => s.name === "BOUAKE")!.name;
    yakro = sites.find((s) => s.name === "YAKRO FACTORY")!.name;
    for (const [id, warehouse] of [
      [RECEIPT_BOUAKE_1, bouake], [RECEIPT_BOUAKE_2, bouake], [RECEIPT_YAKRO_1, yakro],
    ] as const) {
      await prisma.receipt.deleteMany({ where: { id } });
      await prisma.receipt.create({
        data: { id, source: "entered", arrivalDate: "2026-01-01", supplierName: "", lbaCode: "", vehicleNo: "", warehouse },
      });
    }
  });
  afterAll(async () => {
    for (const id of [RECEIPT_BOUAKE_1, RECEIPT_BOUAKE_2, RECEIPT_YAKRO_1]) {
      await prisma.receipt.deleteMany({ where: { id } });
    }
  });

  it("writes warehouseName as a side effect of every n-lot write, not just the discharge write-back", async () => {
    await setStageFields(RECEIPT_BOUAKE_1, "n-lot", { "Lot Number": "LOTUNIQ-1" });
    const row = await prisma.stageLotAssignment.findUnique({ where: { receiptId: RECEIPT_BOUAKE_1 } });
    expect(row?.lotNumber).toBe("LOTUNIQ-1");
    expect(row?.warehouseName).toBe(bouake);
  });

  it("the SAME lot number is assignable at a DIFFERENT warehouse — this is the bug fix", async () => {
    await setStageFields(RECEIPT_YAKRO_1, "n-lot", { "Lot Number": "LOTUNIQ-1" });
    const row = await prisma.stageLotAssignment.findUnique({ where: { receiptId: RECEIPT_YAKRO_1 } });
    expect(row?.lotNumber).toBe("LOTUNIQ-1");
    expect(row?.warehouseName).toBe(yakro);
  });

  it("the SAME lot number at the SAME warehouse is still rejected", async () => {
    await expect(
      setStageFields(RECEIPT_BOUAKE_2, "n-lot", { "Lot Number": "LOTUNIQ-1" })
    ).rejects.toThrow(ValidationError);
    const row = await prisma.stageLotAssignment.findUnique({ where: { receiptId: RECEIPT_BOUAKE_2 } });
    expect(row?.lotNumber ?? null).toBeNull();
  });
});
