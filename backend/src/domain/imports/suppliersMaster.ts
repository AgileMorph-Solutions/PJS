/**
 * Supplier master — sheet "Suppliers" inside "ANAGROCI DATA PROCUREMENT 2026.xlsx", header row 1,
 * data from row 2. 58 rows, each a code/name pair. Unlike every other importer's "observed union"
 * upsert (which only fills in a code nobody's seen before), this one IS the canonical master, so
 * commitSuppliersMaster() updates the name on an existing code too — see services/imports.ts.
 */
import type ExcelJS from "exceljs";
import type { ImporterDef, ParsedRow } from "./types.js";
import { text, isBlankRow } from "./xlsxHelpers.js";

export interface SupplierMasterRow {
  no: string | null;
  name: string;
  code: string;
}

const SHEET = "Suppliers";
const HEADER_ROW = 1;
const HEADER = ["No", "supplier name", "supplier code"];

function parse(workbook: ExcelJS.Workbook): ParsedRow<SupplierMasterRow>[] {
  const sheet = workbook.getWorksheet(SHEET)!;
  const out: ParsedRow<SupplierMasterRow>[] = [];

  for (let r = HEADER_ROW + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (isBlankRow(row, 3)) continue;

    const name = text(row.getCell(2)) ?? "";
    const code = text(row.getCell(3)) ?? "";
    const data: SupplierMasterRow = { no: text(row.getCell(1)), name, code };

    out.push(
      code.trim()
        ? { sheetRow: r, data }
        : { sheetRow: r, data, skipReason: "no supplier code — this sheet's own key" }
    );
  }
  return out;
}

export const suppliersMasterImporter: ImporterDef<SupplierMasterRow> = {
  id: "suppliersMaster",
  label: "Supplier master",
  exampleFilename: "ANAGROCI DATA PROCUREMENT 2026.xlsx",
  expectedSheet: SHEET,
  headerRow: HEADER_ROW,
  expectedHeader: HEADER,
  checkHeaderPrefix: HEADER.length,
  parse,
};
