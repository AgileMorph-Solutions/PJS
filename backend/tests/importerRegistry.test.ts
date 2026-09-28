/**
 * Every real workbook this app knows about, checked against every registered importer shape.
 * With 11 shapes now, detectImporter()'s first-match-wins registration order carries real weight;
 * this is the guard that a new shape's header fingerprint doesn't accidentally also match a file
 * it was never meant to.
 *
 * One genuine (not buggy) multi-match case is asserted explicitly rather than hidden:
 * "ANAGROCI DATA PROCUREMENT 2026.xlsx" is a single consolidated workbook that legitimately
 * contains SIX of this app's target sheets (Truck Reception, Warehouse Receiving, Drying Batch,
 * Jute Bags movement, Warehouse activity Ledger, Suppliers) — all six importers correctly match
 * the same file; that's the whole point of ImportPanel always pinning an explicit importerId
 * rather than relying on auto-detection for this file.
 *
 * The old (pre-migration) workbooks (OFFLOADINGS, FINAL DRY RCN-YAKRO-2026, JUTE BAGS ISSUED) used
 * to be asserted here as explicit NON-matches, proving their retired shapes were gone, not silently
 * still readable — removed along with the files themselves once "new sheets" was confirmed to be
 * the only referenced source (see docs/Procurement's own history for the deletion).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ExcelJS from "exceljs";
import { IMPORTERS, checkImporter } from "../src/domain/imports/registry.js";
import type { ImporterId } from "../src/domain/imports/types.js";

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/Procurement");

async function loadWorkbook(filePath: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync(filePath) as unknown as Parameters<typeof wb.xlsx.load>[0]);
  return wb;
}

function matchingIds(wb: ExcelJS.Workbook): ImporterId[] {
  return IMPORTERS.filter((imp) => checkImporter(wb, imp.id).ok).map((imp) => imp.id);
}

const CASES: { file: string; expected: ImporterId[] }[] = [
  { file: "new sheets/Suppliers Offloading_Bouake Warehouse Report.xlsx", expected: ["warehouseDischarges"] },
  { file: "new sheets/Dispatch RCN from Bouake Warehouse Report.xlsx", expected: ["warehouseDispatches"] },
  { file: "new sheets/Factory Warehouse RCN Transfer to Production Report.xlsx", expected: ["issuedToProduction"] },
  // A newer snapshot of the EXISTING ledger-4 sheet ("Bouake Stock Reciving", same 34-col shape) —
  // verified directly, not assumed.
  { file: "new sheets/Bouake RCN Receiving at Factory Report.xlsx", expected: ["juteWarehouseTransfer"] },
  // The one sheet in the new-sheets set with NO importer until this pass — "Drying & Sorting
  // Report", header row 2, real columns 1-31 only (32-33 are a stray duplicate-label pair, 36-41
  // an embedded pivot — see dryingSorting.ts).
  { file: "new sheets/Bouake RCN Drying Report.xlsx", expected: ["dryingSorting"] },
  // The consolidated export — six of its eight sheets are all real target shapes, all correctly
  // matching the SAME file (Delivery Plan / Quality Inspection are empty templates, never imported).
  {
    file: "new sheets/ANAGROCI DATA PROCUREMENT 2026.xlsx",
    expected: ["truckReception", "juteBagsMovement", "dryingBatch", "suppliersMaster", "warehouseReceiving", "warehouseActivityLedger"],
  },
];

describe("importer registry — every real file matches exactly its expected shape(s)", () => {
  for (const { file, expected } of CASES) {
    it(`"${file}" matches ${expected.length ? expected.join(", ") : "no known importer"}`, async () => {
      const wb = await loadWorkbook(path.join(DOCS, file));
      const matches = matchingIds(wb).sort();
      expect(matches).toEqual([...expected].sort());
    });
  }

  it("detectImporter() picks the first-registered match when a file genuinely satisfies more than one shape", async () => {
    const { detectImporter } = await import("../src/domain/imports/registry.js");
    const wb = await loadWorkbook(path.join(DOCS, "new sheets/ANAGROCI DATA PROCUREMENT 2026.xlsx"));
    const result = detectImporter(wb);
    expect(result.matched).toBe("truckReception");
  });
});
