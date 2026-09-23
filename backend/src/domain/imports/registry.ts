/**
 * The single place all 4 known upload shapes are registered. Detection is never sheet-name-alone
 * — see headerCheck.ts's header comment for the real corruption case that requires this.
 */
import type ExcelJS from "exceljs";
import type { ImporterDef, ImporterId, HeaderCheckResult } from "./types.js";
import { verifyHeader } from "./headerCheck.js";
import { offloadingsImporter } from "./offloadings.js";
import { dryingImporter } from "./drying.js";
import { juteWarehouseStockImporter } from "./juteWarehouseStock.js";
import { juteWarehouseTransferImporter } from "./juteWarehouseTransfer.js";

export const IMPORTERS: ImporterDef[] = [
  offloadingsImporter,
  dryingImporter,
  juteWarehouseStockImporter,
  juteWarehouseTransferImporter,
];

export function getImporter(id: ImporterId): ImporterDef {
  const def = IMPORTERS.find((i) => i.id === id);
  if (!def) throw new Error(`Unknown importer "${id}"`);
  return def;
}

export function checkImporter(workbook: ExcelJS.Workbook, id: ImporterId): HeaderCheckResult {
  const def = getImporter(id);
  return verifyHeader(workbook, def.expectedSheet, def.headerRow, def.expectedHeader, def.checkHeaderPrefix);
}

/**
 * Try every registered importer's sheet name + header fingerprint against the uploaded workbook,
 * in registration order. The first one whose sheet exists AND whose header matches wins. A sheet
 * name matching but the header not is reported as a specific "shape mismatch" reason (not silently
 * skipped to the next importer) — this is exactly the case that must surface, not disappear.
 */
export function detectImporter(workbook: ExcelJS.Workbook): {
  matched?: ImporterId;
  attempts: { id: ImporterId; result: HeaderCheckResult }[];
} {
  const attempts: { id: ImporterId; result: HeaderCheckResult }[] = [];
  for (const def of IMPORTERS) {
    const result = checkImporter(workbook, def.id);
    attempts.push({ id: def.id, result });
    if (result.ok) return { matched: def.id, attempts };
  }
  return { attempts };
}
