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

export interface BuiltWorkbook {
  buffer: ExcelJS.Buffer;
  filename: string;
  /** Rows written across all sheets, and rows a date range left out for having no usable date. */
  exported: number;
  withoutDate: number;
  sheets: { name: string; rows: number }[];
}

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F4" } };

export const sectionLabel = (type: WarehouseType) => (type === "UNIT" ? "Unit" : "Central");

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
}): Promise<BuiltWorkbook> {
  const { type, warehouse, site, range, blank, today } = args;
  const wb = new ExcelJS.Workbook();
  const written: BuiltWorkbook["sheets"] = [];
  let withoutDate = 0;

  for (const spec of sheetsFor(type)) {
    const fields = spec.fields(type);
    let rows = blank ? [] : await spec.rows(site);
    if (!blank && spec.dateField && !spec.master) {
      const f = filterByDate(rows, spec.dateField.column, range);
      rows = f.rows;
      withoutDate += f.withoutDate;
    }

    const ws = wb.addWorksheet(spec.title.slice(0, 31));
    const header = ws.addRow(fields.map((f) => f.label));
    header.font = { bold: true };
    header.eachCell((cell) => { cell.fill = HEADER_FILL; });
    // The one column nobody fills in: say what blank means, right where they'll look.
    if (spec.kind === "receipt" || spec.key === "id") {
      header.getCell(1).note = "Leave this blank to add a new row. For an existing row, keep it as it is.";
    }
    ws.views = [{ state: "frozen", ySplit: 1, xSplit: 1 }];
    fields.forEach((f, i) => { ws.getColumn(i + 1).width = Math.min(Math.max(f.label.length + 4, 12), 40); });
    for (const row of rows) ws.addRow(fields.map((f) => serializeCell(row[f.key])));
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
