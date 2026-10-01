/**
 * Uploaded .xlsx -> per-sheet rows keyed by header. Only structure is handled here (row 1 is the
 * header, blank rows skipped, size limits); what a cell MEANS — its type, whether it changed — is
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
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) {
        (row.values as unknown[]).slice(1).forEach((v, i) => {
          const h = v === null || v === undefined ? "" : String(v).trim();
          headers[i] = h;
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
