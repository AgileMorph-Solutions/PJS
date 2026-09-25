/**
 * Every real workbook this app knows about, checked against every registered importer shape.
 * With 10 shapes now (5 original + the 4 new ones from step 8, one of which — Warehouse Receiving —
 * shares a file with two others), detectImporter()'s first-match-wins registration order carries
 * real weight; this is the guard that a new shape's header fingerprint doesn't accidentally also
 * match a file it was never meant to.
 *
 * Two genuine (not buggy) multi-match cases are asserted explicitly rather than hidden:
 *  - "ANAGROCI DATA PROCUREMENT 2026.xlsx" is a single workbook that legitimately contains three of
 *    this pass's target sheets (Drying Batch, Warehouse Receiving, Warehouse activity Ledger) — all
 *    three importers correctly match the SAME file.
 *  - "Drying Report_Factory warehouse.xlsx" contains its own "Issued to Production Section" tab (an
 *    earlier/bundled snapshot of the same data the standalone "Factory Warehouse RCN Transfer to
 *    Production Report.xlsx" also carries) ALONGSIDE its primary "FINAL DRY RCN-YAKRO-2026" sheet —
 *    both `dryingJobs` and `issuedToProduction` correctly match it.
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
  { file: "drive-download-20260903T100404Z-1-001/Rcn Offloading Details 2026.xlsx", expected: ["receipts"] },
  { file: "Drying Report_Factory warehouse.xlsx", expected: ["dryingJobs", "issuedToProduction"] },
  { file: "BOUAKE WAREHOUSE JUTE BAGS MOVEMENT REPORT.xlsx", expected: ["juteWarehouseStock"] },
  { file: "BOUAKE RCN RECEIVING at Yamoussoukro as on 9.9.2026.xlsx", expected: ["juteWarehouseTransfer"] },
  { file: "new sheets/Suppliers Offloading_Bouake Warehouse Report.xlsx", expected: ["warehouseDischarges"] },
  { file: "new sheets/Dispatch RCN from Bouake Warehouse Report.xlsx", expected: ["warehouseDispatches"] },
  { file: "new sheets/Factory Warehouse RCN Transfer to Production Report.xlsx", expected: ["issuedToProduction"] },
  // A newer snapshot of the EXISTING ledger-4 sheet ("Bouake Stock Reciving", ​same 34-col shape),
  // not a Warehouse Receiving source — verified directly, not assumed, before deciding this needed
  // no new importer at all.
  { file: "new sheets/Bouake RCN Receiving at Factory Report.xlsx", expected: ["juteWarehouseTransfer"] },
  { file: "ANAGROCI DATA PROCUREMENT 2026.xlsx", expected: ["dryingBatch", "warehouseReceiving", "warehouseActivityLedger"] },
  // Known non-matches, kept here so a future importer added carelessly can't silently start
  // matching them: the real corruption case (32-col ledger-4 lookalike) and the Bouaké-only,
  // differently-shaped "Drying & Sorting Report" sheet this pass explicitly ruled out.
  { file: "drive-download-20260903T100404Z-1-001/BOUAKE RCN RECEIVING.xlsx", expected: [] },
  { file: "new sheets/Bouake RCN Drying Report.xlsx", expected: [] },
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
    const wb = await loadWorkbook(path.join(DOCS, "Drying Report_Factory warehouse.xlsx"));
    const result = detectImporter(wb);
    expect(result.matched).toBe("dryingJobs");
  });
});
