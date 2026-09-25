/**
 * Issued to Production Section — sheet "Issued to Production Section", header row 5, data from row
 * 6, in "Factory Warehouse RCN Transfer to Production Report.xlsx". Measured 125 real data rows
 * (128 pass "any of columns 1-34 non-blank", but 3 of those are stray whitespace/pivot-tail rows
 * with no clean SI NO — see the skip guard below) across 112 distinct BTMs, 8 of which have no
 * matching BtmIntake (soft reference, reported not auto-created — see
 * production_issue_btm_not_in_production_master).
 *
 * Columns 35-39 ("Check" tail plus a "Row Labels"/"Sum of..." pivot summary) are real cells in the
 * sheet but not part of this row shape — same "trailing tail" situation warehouseDischarges.ts
 * documents for DISCHARGEMENT's columns 65-67; the fingerprint and the parse both stop at 34.
 *
 * Fiche No is stored verbatim and NEVER used as a join key — verified directly against this file,
 * not assumed: only 16 of 125 non-blank values look like a real fiche number, the other 109 are
 * dry-bin-code strings (e.g. "BIN-03B"). Source Bin / DRY BIN pairs are recorded as observed,
 * reporting-only data (production_issue_source_dry_bin_pairs) — never normalised into one namespace.
 */
import type ExcelJS from "exceljs";
import type { ImporterDef, ParsedRow } from "./types.js";
import { num, text, dateParts, isBlankRow } from "./xlsxHelpers.js";

export interface IssuedToProductionRow {
  sNo: number;
  date: string | null;
  dateRaw: string | null;
  rcn: string | null;
  sourceBin: string | null;
  dryBin: string | null;
  binStatus: string | null;
  btmNo: string | null;
  korIssued: string | null;
  nutCount: string | null;
  gk: string | null;
  moisture: string | null;
  immature: string | null;
  spotted: string | null;
  rejection: string | null;
  oilGram: string | null;
  voidGram: string | null;
  shellGram: string | null;
  ficheNo: string | null;
  bagInStockAfterDry: string | null;
  noOfBagIssuedToProduction: string | null;
  avgBagWtEmptyBag: string | null;
  bagWtEmptyBag: string | null;
  noOfPallet: string | null;
  avgPalletWt: string | null;
  palletWeightKg: string | null;
  grossWtBeforeDry: string | null;
  grossWtAfterDryingWithJuteBag: string | null;
  netWtWithoutJuteBag: string | null;
  dateOfIssueToCalibration: string | null;
  receivedByProductionNetWt: string | null;
  issuedFrom: string | null;
  diffInIssue: string | null;
  remarks: string | null;
  checkValue: string | null;
}

const SHEET = "Issued to Production Section";
const HEADER_ROW = 5;
const CHECK_PREFIX = 34;

const HEADER = [
  "SI NO", "Date", "RCN", "Source Bin", "DRY BIN", "Bin Status", "BTM", "KOR-Issued", "Nut Count",
  "GK", "Moisture", "Immature", "Spottd", "Rejection", "OIL (Gram)", "Void (Gram)", "Shell (Gram)",
  "Fiche No", "Bag inStock afetr Dry", "No of Bag(Issued to Production)",
  "Avg Bag Wt (Empty  Bag)", "Bag Wt(Empty Bag)", "No of Pallet", "Avg Pallet Wt",
  "Pallet Weight (Kg)", "Gross Wt (Before Dry)", "Gross Wt (After Drying Wt with Jute Bag)",
  "Net Wt (Without Jute Bag)", "Date of Issue to Calibration", "Received By Production(Net Wt)",
  "Issued from", "Diff in Issue", "Remarks", "Check",
];

function parse(workbook: ExcelJS.Workbook): ParsedRow<IssuedToProductionRow>[] {
  const sheet = workbook.getWorksheet(SHEET)!;
  const out: ParsedRow<IssuedToProductionRow>[] = [];

  for (let r = HEADER_ROW + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (isBlankRow(row, CHECK_PREFIX)) continue;

    const sn = num(row.getCell(1));
    // The gate that matters here: 3 of the 128 "any column non-blank" rows are stray
    // whitespace/pivot-tail artifacts (a lone " " in the Date cell, nothing else) rather than real
    // lines — none of them carry a clean SI NO. Unlike CHARGEMENT's continuation lines, this sheet
    // is one-row-per-line with no legitimate row that lacks its own serial number, so gating on it
    // is correct here (128 - 3 = 125, matching the measured real count).
    if (sn === null) { out.push({ sheetRow: r, data: blankRow(), skipReason: "no SI NO — not a real data line" }); continue; }

    const d = dateParts(row.getCell(2));
    const data: IssuedToProductionRow = {
      sNo: sn,
      date: d.iso, dateRaw: d.raw,
      rcn: text(row.getCell(3)),
      sourceBin: text(row.getCell(4)),
      dryBin: text(row.getCell(5)),
      binStatus: text(row.getCell(6)),
      btmNo: text(row.getCell(7)),
      korIssued: text(row.getCell(8)),
      nutCount: text(row.getCell(9)),
      gk: text(row.getCell(10)),
      moisture: text(row.getCell(11)),
      immature: text(row.getCell(12)),
      spotted: text(row.getCell(13)),
      rejection: text(row.getCell(14)),
      oilGram: text(row.getCell(15)),
      voidGram: text(row.getCell(16)),
      shellGram: text(row.getCell(17)),
      ficheNo: text(row.getCell(18)),
      bagInStockAfterDry: text(row.getCell(19)),
      noOfBagIssuedToProduction: text(row.getCell(20)),
      avgBagWtEmptyBag: text(row.getCell(21)),
      bagWtEmptyBag: text(row.getCell(22)),
      noOfPallet: text(row.getCell(23)),
      avgPalletWt: text(row.getCell(24)),
      palletWeightKg: text(row.getCell(25)),
      grossWtBeforeDry: text(row.getCell(26)),
      grossWtAfterDryingWithJuteBag: text(row.getCell(27)),
      netWtWithoutJuteBag: text(row.getCell(28)),
      dateOfIssueToCalibration: text(row.getCell(29)),
      receivedByProductionNetWt: text(row.getCell(30)),
      issuedFrom: text(row.getCell(31)),
      diffInIssue: text(row.getCell(32)),
      remarks: text(row.getCell(33)),
      checkValue: text(row.getCell(34)),
    };

    const skipReason = data.btmNo?.trim() ? undefined : "no BTM — this sheet's own row-order link";
    out.push(skipReason ? { sheetRow: r, data, skipReason } : { sheetRow: r, data });
  }
  return out;
}

function blankRow(): IssuedToProductionRow {
  return {
    sNo: 0, date: null, dateRaw: null, rcn: null, sourceBin: null, dryBin: null, binStatus: null,
    btmNo: null, korIssued: null, nutCount: null, gk: null, moisture: null, immature: null,
    spotted: null, rejection: null, oilGram: null, voidGram: null, shellGram: null, ficheNo: null,
    bagInStockAfterDry: null, noOfBagIssuedToProduction: null, avgBagWtEmptyBag: null,
    bagWtEmptyBag: null, noOfPallet: null, avgPalletWt: null, palletWeightKg: null,
    grossWtBeforeDry: null, grossWtAfterDryingWithJuteBag: null, netWtWithoutJuteBag: null,
    dateOfIssueToCalibration: null, receivedByProductionNetWt: null, issuedFrom: null,
    diffInIssue: null, remarks: null, checkValue: null,
  };
}

export const issuedToProductionImporter: ImporterDef<IssuedToProductionRow> = {
  id: "issuedToProduction",
  label: "Issued to Production Section",
  exampleFilename: "Factory Warehouse RCN Transfer to Production Report.xlsx",
  expectedSheet: SHEET,
  headerRow: HEADER_ROW,
  expectedHeader: HEADER,
  checkHeaderPrefix: CHECK_PREFIX,
  parse,
};
