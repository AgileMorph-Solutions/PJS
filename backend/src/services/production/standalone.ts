/**
 * Generic access for tables that don't hang off a BTM/Lot/Bin parent at all — shell-dispatch,
 * waste-dispatch, boiler-consumption, wip-stock-report (plant-level trackers, confirmed no real
 * Lot/BTM/Bin column — see productionTables.ts's own header comment for why no link is invented).
 */
import { PRODUCTION_FIELD_MAP } from "@anagroci/contract/generated/productionFieldMap";
import { createProductionRow, listProductionRows } from "../../productionStore.js";
import { ValidationError } from "../../domain/validation.js";

export async function listStandaloneTable(tableId: string, limit?: number) {
  const spec = PRODUCTION_FIELD_MAP[tableId];
  if (!spec || spec.spine !== "standalone") throw new ValidationError(`"${tableId}" is not a standalone production table.`);
  return listProductionRows(tableId, null, limit);
}

export async function addStandaloneRow(tableId: string, fields: Record<string, string>) {
  const spec = PRODUCTION_FIELD_MAP[tableId];
  if (!spec || spec.spine !== "standalone") throw new ValidationError(`"${tableId}" is not a standalone production table.`);
  return createProductionRow(tableId, "", fields);
}
