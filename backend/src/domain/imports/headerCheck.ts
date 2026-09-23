/**
 * The header-fingerprint check every importer runs before accepting a match — on auto-detect AND
 * on manual override, always. This exists because of a real, found case: a workbook in
 * docs/Procurement/drive-download-.../BOUAKE RCN RECEIVING.xlsx has a sheet also named
 * "Bouake Stock Reciving" but with 32 columns instead of 34 — missing "DRY/UNDRY" and
 * "Transfer -Bouake ", so the same fixed column-index map would silently read every field past
 * column 14 from the wrong column. Sheet-name matching alone would accept it; this check is what
 * refuses it instead. See docs/UPLOAD_GUIDE.md for the full story.
 */
import type ExcelJS from "exceljs";
import type { HeaderCheckResult } from "./types.js";
import { readHeaderRow } from "./xlsxHelpers.js";

export function verifyHeader(
  workbook: ExcelJS.Workbook,
  expectedSheet: string,
  headerRow: number,
  expectedHeader: string[],
  checkPrefix: number
): HeaderCheckResult {
  const sheet = workbook.getWorksheet(expectedSheet);
  if (!sheet) {
    return {
      ok: false,
      reason: "missing-sheet",
      expectedSheet,
      foundSheets: workbook.worksheets.map((s) => s.name),
    };
  }

  const found = readHeaderRow(sheet, headerRow, checkPrefix);
  const expected = expectedHeader.slice(0, checkPrefix);
  const matches = expected.every((label, i) => (found[i] ?? "") === label);

  if (!matches) {
    return { ok: false, reason: "header-mismatch", expectedSheet, headerRow, expected, found };
  }
  return { ok: true };
}
