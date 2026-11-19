/**
 * Uploaded .xlsx -> per-sheet rows keyed by header. Only structure is handled here (row 1 is the
 * header, or row 2 under a one-cell title; blank rows skipped, size limits); what a cell MEANS — its type, whether it changed — is
 * cells.ts and the sheet planners.
 */
import ExcelJS from "exceljs";
import { ValidationError } from "../validation.js";
import type { ParsedSheet, ParsedWorkbook } from "./types.js";

// Per sheet. WarehouseDischarge alone has 123 columns, so the old importers' 100-column guard
// (services/imports.ts) would reject a normal export; this one is sized for our own tables.
const MAX_ROWS = 20_000;
const MAX_COLS = 200;

const isBlankCell = (v: unknown) => v === null || v === undefined || v === "";

const filledCells = (row: ExcelJS.Row) => (row.values as unknown[]).slice(1).filter((v) => !isBlankCell(v)).length;

/**
 * Row 1, unless it is a title: the client's own sheets put one cell over their headers ("RCN Receipts Tally Sheet" over
 * SL.NO, DATE, …). A first row of one cell above a row of several is that title. Our own exports always start on their
 * headers, and a one-column sheet's second row has one cell too, so neither moves.
 */
function headerRowOf(ws: ExcelJS.Worksheet): number {
  const first = ws.getRow(1);
  const second = ws.getRow(2);
  return filledCells(first) === 1 && filledCells(second) > 1 ? 2 : 1;
}

export async function readWorkbook(buffer: Buffer | ArrayBuffer): Promise<ParsedWorkbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as ArrayBuffer);
  } catch {
    throw new ValidationError("That file couldn't be read as an .xlsx workbook.");
  }

  const sheets = new Map<string, ParsedSheet>();
  const notices: string[] = [];

  for (const ws of wb.worksheets) {
    // "_README" (and anything else starting with an underscore) is documentation, not data.
    if (ws.name.startsWith("_")) continue;
    if (ws.actualRowCount > MAX_ROWS + 1) throw new ValidationError(`Sheet "${ws.name}" has more than ${MAX_ROWS} rows.`);
    if (ws.actualColumnCount > MAX_COLS) throw new ValidationError(`Sheet "${ws.name}" has more than ${MAX_COLS} columns.`);

    const headers: string[] = [];
    const rows: ParsedSheet["rows"] = [];
    const headerRow = headerRowOf(ws);
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber < headerRow) return;
      if (rowNumber === headerRow) {
        (row.values as unknown[]).slice(1).forEach((v, i) => {
          // A merged header is one column: ExcelJS repeats its text in every cell it covers (the client's tally Print
          // form merges F1:G1), which would read as two columns of the same name.
          const cell = row.getCell(i + 1);
          const covered = cell.isMerged && cell.master.address !== cell.address;
          headers[i] = covered || v === null || v === undefined ? "" : String(v).trim();
        });
        return;
      }
      const cells: Record<string, unknown> = {};
      let any = false;
      headers.forEach((h, i) => {
        if (!h) return;
        const v = row.getCell(i + 1).value;
        cells[h] = v;
        if (!isBlankCell(v)) any = true;
      });
      if (any) rows.push({ rowNumber, cells });
    });

    const named = headers.filter(Boolean);
    const dup = named.find((h, i) => named.indexOf(h) !== i);
    if (dup) throw new ValidationError(`Sheet "${ws.name}" has two columns named "${dup}".`);
    sheets.set(ws.name, { name: ws.name, headers: named, rows });
  }

  return { sheets, notices };
}
