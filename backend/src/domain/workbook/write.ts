/**
 * Builds the section workbook: one sheet per kind of record the section keeps, in plain words, with
 * plain column headers (see fields.ts). `blank` gives the same workbook with headers only (what
 * Upload offers as its sample), so a sample can never drift from what an export — and the uploader —
 * actually use.
 */
import ExcelJS from "exceljs";
import type { WarehouseType } from "@anagroci/contract/data/warehouseTypes";
import { serializeCell } from "./cells.js";
import { exportFilename, filterByDate, type DateRange } from "./dateFilter.js";
import { sheetsFor } from "./sheets.js";
import { hiddenKeys } from "./fields.js";
import type { Role } from "@anagroci/contract/data/roles";

export interface BuiltWorkbook {
  buffer: ExcelJS.Buffer;
  filename: string;
  /** Rows written across all sheets, and rows a date range left out for having no usable date. */
  exported: number;
  withoutDate: number;
  sheets: { name: string; rows: number }[];
}

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F4" } };
/** A column the app adds to a client's sheet: amber, so it reads apart from the client's own columns at a glance. */
export const NEW_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE7C8" } };
export const NEW_NOTE = "New: not in your Excel file. The app adds this column.";

export const BLANK_ID_NOTE = "Leave this blank to add a new row. For an existing row, keep it as it is.";

/**
 * One tab in the house style: a bold, shaded header of plain labels, frozen with its first column, then the
 * rows. Shared by the section workbook and the production workbook, so both files look and read the same.
 * `firstColumnNote` explains the first column where it is the one nobody fills in.
 */
export function addTableSheet(
  wb: ExcelJS.Workbook, title: string, fields: { key: string; label: string; note?: string; isNew?: boolean }[], rows: Record<string, unknown>[], firstColumnNote?: string,
) {
  const ws = wb.addWorksheet(title.slice(0, 31));
  const header = ws.addRow(fields.map((f) => f.label));
  header.font = { bold: true };
  header.eachCell((cell, col) => { cell.fill = fields[col - 1]?.isNew ? NEW_FILL : HEADER_FILL; });
  if (firstColumnNote) header.getCell(1).note = firstColumnNote;
  fields.forEach((f, i) => {
    if (i === 0 && firstColumnNote) return;
    const note = [f.isNew ? NEW_NOTE : "", f.note ?? ""].filter(Boolean).join(" ");
    if (note) header.getCell(i + 1).note = note;
  });
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 1 }];
  fields.forEach((f, i) => { ws.getColumn(i + 1).width = Math.min(Math.max(f.label.length + 4, 12), 40); });
  for (const row of rows) ws.addRow(fields.map((f) => serializeCell(row[f.key])));
  return ws;
}

export const sectionLabel =(type: WarehouseType) => (type === "UNIT" ? "Unit" : "Central");

/**
 * `ANAGROCI - Unit Warehouse - Sample.xlsx`, or `… - Export 2026-10-01.xlsx` (the date, or the range
 * when one was chosen). The section is in the name; the site's own name is deliberately not.
 */
export function workbookFilename(type: WarehouseType, range: DateRange, blank: boolean, today: string): string {
  const base = `ANAGROCI - ${sectionLabel(type)} Warehouse`;
  return blank ? `${base} - Sample.xlsx` : exportFilename(`${base} - Export`, range, today);
}

export async function buildWorkbookFile(args: {
  type: WarehouseType;
  warehouse: string;
  /** Names a row of this warehouse may carry; omitted for a blank workbook. */
  site?: string[];
  range: DateRange;
  blank: boolean;
  today: string;
  /** Who downloads it: columns hidden from that role (price and amount for the Warehouse Incharge) are left out. */
  role?: Role;
}): Promise<BuiltWorkbook> {
  const { type, warehouse, site, range, blank, today } = args;
  const hidden = hiddenKeys(args.role);
  const wb = new ExcelJS.Workbook();
  const written: BuiltWorkbook["sheets"] = [];
  let withoutDate = 0;

  for (const spec of sheetsFor(type)) {
    const fields = spec.fields(type).filter((f) => !hidden.has(f.key));
    let rows = blank ? [] : await spec.rows(site);
    if (!blank && spec.dateField && !spec.master) {
      const f = filterByDate(rows, spec.dateField.column, range);
      rows = f.rows;
      withoutDate += f.withoutDate;
    }

    addTableSheet(wb, spec.title, fields, rows, spec.kind === "receipt" || spec.key === "id" ? BLANK_ID_NOTE : undefined);
    written.push({ name: spec.title, rows: rows.length });
  }

  return {
    buffer: await wb.xlsx.writeBuffer(),
    filename: workbookFilename(type, range, blank, today),
    exported: written.reduce((n, s) => n + s.rows, 0),
    withoutDate,
    sheets: written,
  };
}
