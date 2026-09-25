/**
 * Jute ledger 1 (warehouse-stock) — sheet "Jute Bags movement" inside "ANAGROCI DATA PROCUREMENT
 * 2026.xlsx", header row 1, data from row 2. Replaces the old "JUTE BAGS ISSUED" importer
 * (juteWarehouseStock.ts, retired): same 298 rows verified row-for-row against the old sheet
 * before retiring it, same 9 leading columns only renamed — but this export's "BALANCE" column is
 * simply gone. Per ground rule #4, `reportedBalance` stays null for every row this importer
 * writes; it is not recomputed or guessed (see jute_balance_drift / jute_balance_negative, which
 * both compare against this column and are re-scoped to say so).
 *
 * `localSeq` is 1-based WITHIN this upload only — same reasoning as juteWarehouseStock.ts had:
 * JuteWarehouseMovement.seq is an import-order-artificial key, not a source value.
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

const SHEET = "Jute Bags movement";
const HEADER_ROW = 1;
const HEADER = [
  "No", "movement date", "activity type", "supplier code", "warehouse location", "truck no",
  "warehouse receipt no", "bags issued", "bags received",
];

function parse(workbook: ExcelJS.Workbook): ParsedRow<JuteWarehouseStockRow>[] {
  const sheet = workbook.getWorksheet(SHEET)!;
  const out: ParsedRow<JuteWarehouseStockRow>[] = [];
  let localSeq = 0;

  for (let r = HEADER_ROW + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (isBlankRow(row, 9)) continue;

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
        // No column 10 in this sheet at all — see this file's header comment.
        reportedBalance: null,
      },
    });
  }
  return out;
}

export const juteBagsMovementImporter: ImporterDef<JuteWarehouseStockRow> = {
  id: "juteBagsMovement",
  label: "Jute warehouse-stock ledger",
  exampleFilename: "ANAGROCI DATA PROCUREMENT 2026.xlsx",
  expectedSheet: SHEET,
  headerRow: HEADER_ROW,
  expectedHeader: HEADER,
  checkHeaderPrefix: HEADER.length,
  parse,
};
