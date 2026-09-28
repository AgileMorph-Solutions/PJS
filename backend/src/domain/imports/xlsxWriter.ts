/**
 * The write side of the import system — building .xlsx files for the app to hand back, not parse.
 * Reuses the same `ImporterDef` metadata (`expectedSheet`/`headerRow`) the read side already
 * declares per shape, so a template or export can never drift from what the importer itself
 * actually expects/produces.
 */
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { getImporter } from "./registry.js";
import type { ImporterId } from "./types.js";

/** A blank workbook matching one importer's expected shape: the right sheet name, the header row
 * at the right row number (blank rows above it — headerCheck.ts only verifies the header row
 * itself, so this is enough to pass a straight re-upload), nothing else. */
export async function buildTemplateWorkbook(importerId: ImporterId): Promise<ExcelJS.Buffer> {
  const def = getImporter(importerId);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(def.expectedSheet);
  const headerRow = sheet.getRow(def.headerRow);
  def.expectedHeader.forEach((label, i) => {
    headerRow.getCell(i + 1).value = label;
  });
  headerRow.commit();
  return workbook.xlsx.writeBuffer();
}

/** Prisma.Decimal/Date/etc -> a plain cell value ExcelJS can write, never coerced to a number that
 * would lose precision (Decimal becomes text, same "never silently fix" discipline the rest of
 * this app applies to real data). */
function serializeCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Prisma.Decimal) return value.toString();
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

/**
 * Current database rows as a workbook — one column per key actually present on the rows (the
 * union across all of them, so a field that happens to be null on row 1 but populated on row 50
 * still gets a column), not a hand-maintained label list. This is deliberate: with tables up to
 * ~80 real columns, a parallel hand-copied column list would drift from the Prisma schema the
 * moment either changed — deriving columns straight from what Prisma actually returns can't drift,
 * by construction. Rows already come from a `list*` service (the same one backing that table's
 * page, where one exists), so this never queries the database itself.
 */
export async function buildExportWorkbook(
  importerId: ImporterId,
  rows: Record<string, unknown>[]
): Promise<ExcelJS.Buffer> {
  const def = getImporter(importerId);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(def.expectedSheet);
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  sheet.addRow(keys);
  for (const row of rows) {
    sheet.addRow(keys.map((k) => serializeCell(row[k])));
  }
  return workbook.xlsx.writeBuffer();
}
