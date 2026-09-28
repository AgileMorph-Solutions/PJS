/**
 * The load-bearing test for the normalization.
 *
 * `stageDataShadow` holds each receipt's pre-normalization JSON, exactly as it was in
 * seed/receipts.json. If assembling stageData from the 16 stage tables reproduces that byte for
 * byte, the migration lost nothing. That oracle is why the shadow column exists.
 *
 * ONE narrow exception now exists, and it is deliberately narrow. The DISCHARGEMENT importer
 * (unit-warehouse offloading) writes the client's REAL Lot Numbers onto receipts — that sheet is
 * where a Lot is actually assigned, and OFFLOADINGS never had a Lot column, so the demo seed left
 * the field blank on every receipt. Filling a blank the seed never had is legitimately new data,
 * not a normalization defect. Everything else still has to survive byte for byte: a value changing
 * from one non-blank to another, a field vanishing, or a stage disappearing all still fail loudly.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { STAGE_FIELD_MAP } from "@anagroci/contract/generated/stageFieldMap";
import { RECEIPT_INCLUDE, assembleStageData } from "../src/stageStore.js";
import { setStageFields } from "../src/services/receipts.js";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

/** Stage -> the only field labels real imported data is allowed to fill in after the fact. Adding
 * to this is a deliberate act: it widens the one hole in the round-trip oracle. */
const ENRICHABLE: Record<string, string[]> = { "n-lot": ["Lot Number"] };

/** An allowed enrichment is blank -> non-blank, on an allowlisted field, and nothing else. */
function isEnrichment(stageId: string, label: string, before?: string, after?: string): boolean {
  if (!ENRICHABLE[stageId]?.includes(label)) return false;
  return (before ?? "").trim() === "" && (after ?? "").trim() !== "";
}

describe("golden seed round-trip", () => {
  let rows: any[];
  beforeAll(async () => {
    rows = await prisma.receipt.findMany({
      where: { stageDataShadow: { not: null } }, // scopes to the original 50-receipt demo seed —
      // uploaded/interactively-created receipts never set this shadow column (only prisma/seed.ts
      // does), so this stays exactly the golden cohort regardless of how much real data is imported.
      include: RECEIPT_INCLUDE, orderBy: { id: "asc" },
    });
  });

  it("has the seeded receipts", () => {
    // 986, not 50, since the seed was regenerated from the new sheets' full Truck Reception
    // register — every receipt now comes from prisma/seed.ts, so the golden cohort grew to the
    // entire table, not a 50-row demo sample.
    expect(rows.length).toBe(986);
  });

  it("reassembles every receipt's stageData identically to the pre-normalization JSON", () => {
    const mismatches: string[] = [];
    for (const row of rows) {
      const original = JSON.parse(row.stageDataShadow!) as Record<string, Record<string, string>>;
      const assembled = assembleStageData(row);
      // Compare stage-by-stage so a failure names the exact stage and field.
      const stages = new Set([...Object.keys(original), ...Object.keys(assembled)]);
      for (const s of stages) {
        const before = original[s];
        const after = assembled[s];
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        // A stage the shadow never had may only appear if it is enrichable (see ENRICHABLE).
        if (before === undefined) {
          if (!(s in ENRICHABLE)) mismatches.push(`${row.id}/${s}: stage appeared, not enrichable`);
          continue;
        }
        if (after === undefined) { mismatches.push(`${row.id}/${s}: stage disappeared`); continue; }
        for (const label of new Set([...Object.keys(before), ...Object.keys(after)])) {
          if (before[label] === after[label]) continue;
          if (isEnrichment(s, label, before[label], after[label])) continue;
          mismatches.push(`${row.id}/${s}/${label}: ${JSON.stringify(before[label])} != ${JSON.stringify(after[label])}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("preserves stage PRESENCE — a stage may be gained only by enrichment, never lost", () => {
    for (const row of rows) {
      const original = JSON.parse(row.stageDataShadow!) as Record<string, unknown>;
      const assembled = Object.keys(assembleStageData(row));
      for (const s of Object.keys(original)) expect(assembled, `${row.id} lost ${s}`).toContain(s);
      for (const s of assembled) {
        if (s in original) continue;
        expect(Object.keys(ENRICHABLE), `${row.id} gained non-enrichable ${s}`).toContain(s);
      }
    }
  });

  /**
   * The enrichment channel is pinned, not just permitted: exactly these receipts, on exactly this
   * field. Without this a regression that filled Lot Numbers everywhere — or filled the wrong
   * field — would slip through the two relaxed assertions above silently.
   *
   * 452 is measured, not chosen: since the seed was regenerated to cover the entire Truck
   * Reception register (986 receipts, not a 50-row demo sample), every one of the DISCHARGEMENT
   * import's 452 successful lot write-backs (see LotWriteBackResult.written) now lands on a
   * seeded receipt — the golden cohort IS the full receipt table now.
   */
  it("enrichment is confined to the measured set: 452 seeded receipts, Lot Number only", () => {
    const enriched: string[] = [];
    for (const row of rows) {
      const original = JSON.parse(row.stageDataShadow!) as Record<string, Record<string, string>>;
      const assembled = assembleStageData(row);
      const lot = assembled["n-lot"]?.["Lot Number"] ?? "";
      if (lot.trim() === "") continue;
      expect(original["n-lot"]?.["Lot Number"] ?? "", `${row.id} overwrote a real lot`).toBe("");
      enriched.push(row.id);
    }
    expect(enriched.length).toBe(452);
  });
});

describe("every one of the 69 (stage, field) pairs round-trips", () => {
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
