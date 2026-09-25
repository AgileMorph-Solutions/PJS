/**
 * Cell-reading helpers, mirroring `tools/extract-jute.py`'s `num`/`dec`/`text`/`date_parts`
 * exactly — these are what let the TypeScript importers reproduce openpyxl's behavior byte for
 * byte rather than approximate it. See that file's own comments for the reasoning; this is a
 * faithful port, not a reinterpretation.
 */
import ExcelJS from "exceljs";

/** A formula cell's `.value` is `{formula, result}` or, for a cell filled down from a master
 * formula (very common — Excel's own "drag to fill" feature), `{sharedFormula, result}` with no
 * `formula` key at all. Found the hard way: the real ledger-1 BALANCE column is exactly this —
 * every one of its 35 genuinely-negative rows is a shared-formula cell, and checking only
 * `"formula" in v` silently returned null for all of them instead of the real negative balance.
 * `cell.type === Formula` is what actually catches both shapes; always unwrap through this so a
 * formula's computed result is what gets read, never `[object Object]` or a dropped value.
 *
 * A formula cell can also carry NO cached result at all (`{sharedFormula: "AD5"}` and nothing
 * else) when the workbook was saved without recalculating — five cells in DISCHARGEMENT's `Diff`
 * column are exactly this. Unwrapping has to happen for EVERY formula cell, not just the ones with
 * a `result` key, or the raw object falls through and `text()` renders the literal string
 * "[object Object]". No cached result means the value genuinely isn't in the file: answer null. */
function rawValue(cell: ExcelJS.Cell): ExcelJS.CellValue {
  const v = cell.value;
  if (cell.type === ExcelJS.ValueType.Formula) {
    if (!v || typeof v !== "object") return v ?? null;
    return (v as ExcelJS.CellFormulaValue | ExcelJS.CellSharedFormulaValue).result ?? null;
  }
  return v;
}

/** int if it's a clean number, else null. Never guesses at a string — mirrors extract-jute.py's num(). */
export function num(cell: ExcelJS.Cell): number | null {
  const v = rawValue(cell);
  if (typeof v === "number") return Math.round(v);
  return null;
}

/** float for a numeric cell, else null — the raw text is kept separately. Mirrors dec(). */
export function dec(cell: ExcelJS.Cell): number | null {
  const v = rawValue(cell);
  return typeof v === "number" ? v : null;
}

/** Trimmed string, or null for a blank cell. Mirrors text(). A real Date cell is formatted as
 * YYYY-MM-DD, matching how the Python side formats a datetime before comparing/storing it. */
export function text(cell: ExcelJS.Cell): string | null {
  const v = rawValue(cell);
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isoDate(v);
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** (iso date, raw string). A real Date cell gives a date; a hand-typed string is kept verbatim,
 * never reinterpreted — mirrors date_parts(). */
export function dateParts(cell: ExcelJS.Cell): { iso: string | null; raw: string | null } {
  const v = rawValue(cell);
  if (v instanceof Date) return { iso: isoDate(v), raw: null };
  const t = text(cell);
  return t ? { iso: null, raw: t } : { iso: null, raw: null };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** True if every cell in the row is empty/null — the "skip a genuinely blank row" check every
 * importer applies before doing anything else. */
export function isBlankRow(row: ExcelJS.Row, upToCol: number): boolean {
  for (let c = 1; c <= upToCol; c++) {
    if (rawValue(row.getCell(c)) !== null && rawValue(row.getCell(c)) !== undefined) return false;
  }
  return true;
}

/** Reads a full header row as trimmed strings (blank cells become ""), for the header-fingerprint
 * check — the guard against the same-name-different-shape corruption case (see docs/UPLOAD_GUIDE.md). */
export function readHeaderRow(sheet: ExcelJS.Worksheet, headerRow: number, colCount: number): string[] {
  const row = sheet.getRow(headerRow);
  const out: string[] = [];
  for (let c = 1; c <= colCount; c++) {
    out.push((text(row.getCell(c)) ?? "").trim());
  }
  return out;
}
