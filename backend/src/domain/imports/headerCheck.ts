/**
 * The header-fingerprint check every importer runs before accepting a match — on auto-detect AND
 * on manual override, always. This exists because of a real, found case in an early client
 * workbook (since retired): a file had a sheet also named "Bouake Stock Reciving" but with 32
 * columns instead of 34 — missing "DRY/UNDRY" and "Transfer -Bouake ", so the same fixed
 * column-index map would silently read every field past column 14 from the wrong column.
 * Sheet-name matching alone would accept it; this check is what refuses it instead — see
 * tests/imports.test.ts's corruption-regression block, which reproduces this shape synthetically.
 */
import type ExcelJS from "exceljs";
import type { HeaderCheckResult, HeaderAnchor } from "./types.js";
import { readHeaderRow, text } from "./xlsxHelpers.js";

export function verifyHeader(
  workbook: ExcelJS.Workbook,
  expectedSheet: string,
  headerRow: number,
  expectedHeader: string[],
  checkPrefix: number,
  expectedAnchors?: HeaderAnchor[]
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

  // Anchors run only after the header row itself matched — a shape whose header is already wrong
  // gets the more specific header-mismatch report, not a confusing anchor one.
  if (expectedAnchors?.length) {
    const bad = expectedAnchors
      .map((a) => ({ a, foundText: text(sheet.getRow(a.row).getCell(a.col)) ?? "" }))
      .filter(({ a, foundText }) => !foundText.toLowerCase().includes(a.contains.toLowerCase()))
      .map(({ a, foundText }) => ({ row: a.row, col: a.col, expected: a.contains, found: foundText }));
    if (bad.length) {
      return { ok: false, reason: "anchor-mismatch", expectedSheet, anchors: bad };
    }
  }
  return { ok: true };
}
