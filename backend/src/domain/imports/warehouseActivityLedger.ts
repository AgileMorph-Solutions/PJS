/**
 * Warehouse activity ledger — sheet "Warehouse activity Ledger", header row 1, data from row 2, in
 * ANAGROCI DATA PROCUREMENT 2026.xlsx. Measured 787 data rows, 18 columns. Its own site-scoped
 * table — see WarehouseActivityLedgerEntry's own schema.prisma comment for why it is not written
 * onto n-otheract/n-ledger and why every field is String, not typed.
 *
 * No S.No/row-order column exists at all in this sheet (the header starts directly at "activity
 * date") — unlike every other importer in this file, there is no natural per-row key to gate a skip
 * on, so the ONLY gate is "any of the 18 columns non-blank".
 */
import type ExcelJS from "exceljs";
import type { ImporterDef, ParsedRow } from "./types.js";
import { text, dateParts, isBlankRow } from "./xlsxHelpers.js";

export interface WarehouseActivityLedgerRow {
  activityDate: string | null;
  activityDateRaw: string | null;
  activityType: string | null;
  particulars: string | null;
  offloaded: string | null;
  bags: string | null;
  quantityMt: string | null;
  ficheNo: string | null;
  lotNo: string | null;
  vendor: string | null;
  rate: string | null;
  total: string | null;
  referenceNo: string | null;
  remarks: string | null;
  grossWeightWithPalletKg: string | null;
  palletCount: string | null;
  grossWeightKg: string | null;
  grossWeightWithoutPalletKg: string | null;
  netWeightKg: string | null;
}

const SHEET = "Warehouse activity Ledger";
const HEADER_ROW = 1;
const CHECK_PREFIX = 18;

const HEADER = [
  "activity date", "activity type", "particulars", "offloaded", "bags", "quantity mt", "fiche no",
  "lot no", "vendor", "rate", "total", "reference no", "remarks", "gross weight with pallet kg",
  "pallet count", "gross weight kg", "gross weight without pallet kg", "net weight kg",
];

function parse(workbook: ExcelJS.Workbook): ParsedRow<WarehouseActivityLedgerRow>[] {
  const sheet = workbook.getWorksheet(SHEET)!;
  const out: ParsedRow<WarehouseActivityLedgerRow>[] = [];

  for (let r = HEADER_ROW + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (isBlankRow(row, CHECK_PREFIX)) continue;

    const activity = dateParts(row.getCell(1));

    const data: WarehouseActivityLedgerRow = {
      activityDate: activity.iso, activityDateRaw: activity.raw,
      activityType: text(row.getCell(2)),
      particulars: text(row.getCell(3)),
      // Every one of these is genuinely mixed-type cell-by-cell in the real sheet (a number on
      // some rows, a category string like "Pallet"/"BIN-012"/"NA" on others) — text() stringifies
      // either shape uniformly rather than silently nulling out the non-numeric rows.
      offloaded: text(row.getCell(4)),
      bags: text(row.getCell(5)),
      quantityMt: text(row.getCell(6)),
      ficheNo: text(row.getCell(7)),
      lotNo: text(row.getCell(8)),
      vendor: text(row.getCell(9)),
      rate: text(row.getCell(10)),
      total: text(row.getCell(11)),
      referenceNo: text(row.getCell(12)),
      remarks: text(row.getCell(13)),
      grossWeightWithPalletKg: text(row.getCell(14)),
      palletCount: text(row.getCell(15)),
      grossWeightKg: text(row.getCell(16)),
      grossWeightWithoutPalletKg: text(row.getCell(17)),
      netWeightKg: text(row.getCell(18)),
    };

    out.push({ sheetRow: r, data });
  }
  return out;
}

export const warehouseActivityLedgerImporter: ImporterDef<WarehouseActivityLedgerRow> = {
  id: "warehouseActivityLedger",
  label: "Warehouse activity ledger",
  exampleFilename: "ANAGROCI DATA PROCUREMENT 2026.xlsx",
  expectedSheet: SHEET,
  headerRow: HEADER_ROW,
  expectedHeader: HEADER,
  checkHeaderPrefix: CHECK_PREFIX,
  parse,
};
