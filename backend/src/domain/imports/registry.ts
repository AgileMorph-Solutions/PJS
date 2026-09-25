/**
 * The single place all 11 known upload shapes are registered. Detection is never sheet-name-alone
 * — see headerCheck.ts's header comment for the real corruption case that requires this.
 *
 * Registration order matters once there are this many shapes — detectImporter() is first-match-
 * wins. The newest importers are ordered most-specific-sheet-name-first; none of their expected sheet names
 * collide with an existing importer's, so ordering among them is not itself load-bearing today, but
 * see tests/importerRegistry.test.ts for the guard that every real file matches exactly one.
 */
import type ExcelJS from "exceljs";
import type { ImporterDef, ImporterId, HeaderCheckResult } from "./types.js";
import { verifyHeader } from "./headerCheck.js";
import { truckReceptionImporter } from "./truckReception.js";
import { juteBagsMovementImporter } from "./juteBagsMovement.js";
import { dryingSortingImporter } from "./dryingSorting.js";
import { suppliersMasterImporter } from "./suppliersMaster.js";
import { juteWarehouseTransferImporter } from "./juteWarehouseTransfer.js";
import { warehouseDischargesImporter } from "./warehouseDischarges.js";
import { warehouseDispatchesImporter } from "./warehouseDispatches.js";
import { dryingBatchImporter } from "./dryingBatch.js";
import { issuedToProductionImporter } from "./issuedToProduction.js";
import { warehouseReceivingImporter } from "./warehouseReceiving.js";
import { warehouseActivityLedgerImporter } from "./warehouseActivityLedger.js";

export const IMPORTERS: ImporterDef[] = [
  truckReceptionImporter,
  juteBagsMovementImporter,
  dryingSortingImporter,
  suppliersMasterImporter,
  juteWarehouseTransferImporter,
  warehouseDischargesImporter,
  warehouseDispatchesImporter,
  dryingBatchImporter,
  issuedToProductionImporter,
  warehouseReceivingImporter,
  warehouseActivityLedgerImporter,
];

export function getImporter(id: ImporterId): ImporterDef {
  const def = IMPORTERS.find((i) => i.id === id);
  if (!def) throw new Error(`Unknown importer "${id}"`);
  return def;
}

export function checkImporter(workbook: ExcelJS.Workbook, id: ImporterId): HeaderCheckResult {
  const def = getImporter(id);
  return verifyHeader(
    workbook, def.expectedSheet, def.headerRow, def.expectedHeader, def.checkHeaderPrefix, def.expectedAnchors
  );
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
