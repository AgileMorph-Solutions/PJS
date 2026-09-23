/**
 * Drying jobs — sheet "FINAL DRY RCN-YAKRO-2026", header row 2, data from row 3.
 * Mirrors tools/extract-seed.py's drying block exactly (same header row, same column reads, same
 * id/skip rules) — see that file's `main()`, the `try: wb = openpyxl.load_workbook(DRYING_XL)...` block.
 */
import type ExcelJS from "exceljs";
import type { ImporterDef, ParsedRow } from "./types.js";
import { text, isBlankRow } from "./xlsxHelpers.js";

export interface DryingJobRow {
  id: string;
  date: string;
  warehouse: string;
  bin: string;
  lotNo: string;
  ficheNo: string;
  status: string;
  dryType: string;
  destination: string;
}

const SHEET = "FINAL DRY RCN-YAKRO-2026";
const HEADER_ROW = 2;
// Verbatim from the real workbook, EXCEPT trimmed — readHeaderRow()/text() trim every cell it
// reads, so the expected list here must match what that comparison actually produces (the raw
// cell has a trailing space after "Warehouse", trimmed away like everywhere else). "Destintion"
// is the client's own spelling, not ours — kept as-is.
const HEADER = [
  "S.No.", "DATE", "Warehouse", "BIN", "Lot No", "FICHE NO", "STATUS", "Dry Type", "Destintion",
  "Dry Bin No", "Issued for Drying GW RCN+BAGS+PALLETS",
];

function parse(workbook: ExcelJS.Workbook): ParsedRow<DryingJobRow>[] {
  const sheet = workbook.getWorksheet(SHEET)!;
  const out: ParsedRow<DryingJobRow>[] = [];

  for (let r = HEADER_ROW + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const c1 = text(row.getCell(1));
    if (c1 === null) continue; // extract-seed.py: `if sno is None: continue`
    if (isBlankRow(row, 11)) continue; // extract-seed.py: `if not any(vals): continue`

    out.push({
      sheetRow: r,
      data: {
        id: `DRY-${c1 || r}`,
        date: text(row.getCell(2)) ?? "",
        warehouse: text(row.getCell(3)) ?? "",
        bin: text(row.getCell(4)) ?? "",
        lotNo: text(row.getCell(5)) ?? "",
        ficheNo: text(row.getCell(6)) ?? "",
        status: text(row.getCell(7)) ?? "In progress",
        dryType: text(row.getCell(8)) ?? "",
        destination: text(row.getCell(9)) ?? "",
      },
    });
  }
  return out;
}

export const dryingImporter: ImporterDef<DryingJobRow> = {
  id: "dryingJobs",
  label: "Drying jobs",
  exampleFilename: "Drying Report_Factory warehouse.xlsx",
  expectedSheet: SHEET,
  headerRow: HEADER_ROW,
  expectedHeader: HEADER,
  checkHeaderPrefix: HEADER.length,
  parse,
};
