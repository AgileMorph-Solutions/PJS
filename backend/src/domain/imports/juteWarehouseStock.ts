/**
 * Jute ledger 1 (warehouse-stock) — sheet "JUTE BAGS ISSUED", header row 2, every row from row 3
 * with any non-empty cell. Mirrors tools/extract-jute.py's `extract_l1()`/`rows_of()` exactly.
 *
 * `localSeq` is 1-based WITHIN this upload only — `JuteWarehouseMovement.seq` is an
 * import-order-artificial key, not a source value, so the real `seq` a row gets on commit is
 * `MAX(existing seq in DB) + localSeq`, computed once by the service layer (see services/imports.ts)
 * so a second upload continues the sequence instead of restarting at 1 and colliding with the
 * @unique constraint.
 */
import type ExcelJS from "exceljs";
import type { ImporterDef, ParsedRow } from "./types.js";
import { num, text, dateParts, isBlankRow } from "./xlsxHelpers.js";

export interface JuteWarehouseStockRow {
  localSeq: number;
  sn: number | null;
  movementDate: string | null;
  rawDate: string | null;
  activitiesType: string;
  supplierCode: string | null;
  whLocation: string;
  truckNumber: string | null;
  wrNo: string | null;
  bagsIssued: number | null;
  bagsReceived: number | null;
  reportedBalance: number | null;
}

const SHEET = "JUTE BAGS ISSUED";
const HEADER_ROW = 2;
const HEADER = [
  "S N", "DATE", "ACTIVITIES TYPE", "SUPPLIER CODE", "WH LOCATION", "TRUCK NUMBER", "W/R NO.",
  "BAGS ISSUED", "BAGS RECEIVED", "BALANCE",
];

function parse(workbook: ExcelJS.Workbook): ParsedRow<JuteWarehouseStockRow>[] {
  const sheet = workbook.getWorksheet(SHEET)!;
  const out: ParsedRow<JuteWarehouseStockRow>[] = [];
  let localSeq = 0;

  for (let r = HEADER_ROW + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (isBlankRow(row, 10)) continue; // rows_of(): `if not any(v not in (None,""))`

    localSeq += 1;
    const { iso, raw } = dateParts(row.getCell(2));
    out.push({
      sheetRow: r,
      data: {
        localSeq,
        sn: num(row.getCell(1)),
        movementDate: iso,
        rawDate: raw,
        activitiesType: text(row.getCell(3)) ?? "",
        supplierCode: text(row.getCell(4)),
        whLocation: text(row.getCell(5)) ?? "",
        truckNumber: text(row.getCell(6)),
        wrNo: text(row.getCell(7)),
        bagsIssued: num(row.getCell(8)),
        bagsReceived: num(row.getCell(9)),
        reportedBalance: num(row.getCell(10)),
      },
    });
  }
  return out;
}

export const juteWarehouseStockImporter: ImporterDef<JuteWarehouseStockRow> = {
  id: "juteWarehouseStock",
  label: "Jute warehouse-stock ledger",
  exampleFilename: "BOUAKE WAREHOUSE JUTE BAGS MOVEMENT REPORT.xlsx",
  expectedSheet: SHEET,
  headerRow: HEADER_ROW,
  expectedHeader: HEADER,
  checkHeaderPrefix: HEADER.length,
  parse,
};
