/**
 * The load-bearing test for the normalization.
 *
 * `stageDataShadow` holds each receipt's pre-normalization JSON, exactly as it was in
 * seed/receipts.json. If assembling stageData from the 17 stage tables reproduces that byte for
 * byte, the migration lost nothing. That oracle is why the shadow column exists.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { STAGE_FIELD_MAP } from "@anagroci/contract/generated/stageFieldMap";
import { RECEIPT_INCLUDE, assembleStageData } from "../src/stageStore.js";
import { setStageFields } from "../src/services/receipts.js";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

describe("golden seed round-trip", () => {
  let rows: any[];
  beforeAll(async () => {
    rows = await prisma.receipt.findMany({ include: RECEIPT_INCLUDE, orderBy: { id: "asc" } });
  });

  it("has the seeded receipts", () => {
    expect(rows.length).toBe(50);
  });

  it("reassembles every receipt's stageData identically to the pre-normalization JSON", () => {
    const mismatches: string[] = [];
    for (const row of rows) {
      const original = JSON.parse(row.stageDataShadow!) as Record<string, Record<string, string>>;
      const assembled = assembleStageData(row);
      // Compare stage-by-stage so a failure names the exact stage and field.
      const stages = new Set([...Object.keys(original), ...Object.keys(assembled)]);
      for (const s of stages) {
        if (JSON.stringify(original[s]) !== JSON.stringify(assembled[s])) {
          mismatches.push(`${row.id}/${s}: ${JSON.stringify(original[s])} != ${JSON.stringify(assembled[s])}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("preserves stage PRESENCE exactly, including stages whose fields are all blank", () => {
    for (const row of rows) {
      const original = JSON.parse(row.stageDataShadow!) as Record<string, unknown>;
      expect(Object.keys(assembleStageData(row)).sort()).toEqual(Object.keys(original).sort());
    }
  });
});

describe("every one of the 74 (stage, field) pairs round-trips", () => {
  const RECEIPT = "REC-ROUNDTRIP-TEST";

  beforeAll(async () => {
    const wh = await prisma.warehouse.findFirst();
    await prisma.receipt.deleteMany({ where: { id: RECEIPT } });
    await prisma.receipt.create({
      data: {
        id: RECEIPT, source: "entered", arrivalDate: "2026-01-01", supplierName: "",
        lbaCode: "", vehicleNo: "", warehouse: wh!.name,
      },
    });
  });
  afterAll(() => prisma.receipt.deleteMany({ where: { id: RECEIPT } }));

  // "" and "0" are the two that normalization most easily destroys: a typed column turns both
  // into 0, and an over-eager "skip empty" turns "" into an absent key.
  for (const sentinel of ["sentinel-value", "", "0", "9.50"]) {
    it(`survives a write of ${JSON.stringify(sentinel)}`, async () => {
      for (const [stageId, spec] of Object.entries(STAGE_FIELD_MAP)) {
        const fields = Object.fromEntries(spec.fields.map((f) => [f.label, sentinel]));
        const rec = await setStageFields(RECEIPT, stageId, fields, { bypassValidation: true });
        for (const f of spec.fields) {
          expect(rec.stageData[stageId]?.[f.label], `${stageId} / ${f.label}`).toBe(sentinel);
        }
      }
    });
  }
});

describe("stage map agrees with the database schema", () => {
  it("every (model, col) in STAGE_FIELD_MAP exists in the Prisma schema", async () => {
    const { Prisma } = await import("@prisma/client");
    const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, new Set(m.fields.map((f) => f.name))]));
    const missing: string[] = [];
    for (const spec of Object.values(STAGE_FIELD_MAP)) {
      const cols = models.get(spec.model);
      if (!cols) { missing.push(`model ${spec.model}`); continue; }
      for (const f of spec.fields) if (!cols.has(f.col)) missing.push(`${spec.model}.${f.col}`);
    }
    expect(missing).toEqual([]);
  });
});
