/**
 * Feeds the "export current data" download (domain/imports/xlsxWriter.ts's buildExportWorkbook) —
 * one branch per importer, each reusing the SAME `list*` function already backing that table's own
 * page (or, where none exists yet, a plain Prisma read), never a second query path. Kept separate
 * from services/imports.ts (upload preview/commit) since this is a read concern, not a write one.
 */
import type { ImporterId } from "../domain/imports/types.js";
import { prisma } from "../db.js";
import { listReceipts } from "./receipts.js";
import { listLedgerRows } from "./ledgers.js";
import { listDryingSortingReports } from "./dryingSortingReports.js";
import { listDryingBatches } from "./dryingBatches.js";
import { listWarehouseDispatchLines } from "./warehouseDispatches.js";
import { listWarehouseActivityLedger } from "./warehouseActivityLedger.js";
import { listIssuedToProduction } from "./issuedToProduction.js";
import { listWarehouseDischarges } from "./warehouseDischarges.js";

/** Receipt is deeply normalized (16 stage tables assembled into `stageData`) — flatten it to
 * `stageId.label` keys rather than exporting a JSON blob in one cell, so every real field still
 * gets its own column. */
function flattenReceipt(r: Awaited<ReturnType<typeof listReceipts>>[number]): Record<string, unknown> {
  const flat: Record<string, unknown> = {
    id: r.id, source: r.source, arrivalDate: r.arrivalDate, supplierName: r.supplierName,
    lbaCode: r.lbaCode, vehicleNo: r.vehicleNo, warehouse: r.warehouse, origin: r.origin,
    lotNo: r.lotNo, binNo: r.binNo,
  };
  for (const [stageId, fields] of Object.entries(r.stageData)) {
    for (const [label, value] of Object.entries(fields)) flat[`${stageId}.${label}`] = value;
  }
  return flat;
}

export async function getExportRows(importerId: ImporterId, site?: string[]): Promise<Record<string, unknown>[]> {
  switch (importerId) {
    case "truckReception":
      return (await listReceipts(site)).map(flattenReceipt);
    case "juteBagsMovement":
      return listLedgerRows("warehouse-stock", site);
    case "juteWarehouseTransfer":
      return listLedgerRows("warehouse-to-warehouse-movement", site);
    case "dryingSorting":
      return listDryingSortingReports(site);
    case "suppliersMaster":
      return prisma.supplier.findMany({ orderBy: { code: "asc" } });
    case "warehouseDischarges":
    case "warehouseReceiving":
      return listWarehouseDischarges(site);
    case "warehouseDispatches":
      return listWarehouseDispatchLines(site);
    case "dryingBatch":
      return listDryingBatches(site);
    case "issuedToProduction":
      return listIssuedToProduction();
    case "warehouseActivityLedger":
      return listWarehouseActivityLedger();
  }
}
