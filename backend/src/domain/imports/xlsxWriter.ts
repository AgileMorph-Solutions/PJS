/**
 * The template side of the import system — a blank workbook for the app to hand back, in the shape
 * the importer itself expects. Reuses the same `ImporterDef` metadata (`expectedSheet`/`headerRow`)
 * the read side already declares per shape, so a template can never drift from what the importer
 * actually accepts. (Exporting current data follows our tables instead: domain/exports/.)
 */
import ExcelJS from "exceljs";
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
