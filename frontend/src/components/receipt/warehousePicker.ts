import { listSites } from "@anagroci/contract/domain/siteType";
import type { WarehouseMaster } from "@anagroci/contract/types/receipt";

/**
 * Arrival's WH LOCATION is picked from the Warehouses master, never typed (the server refuses a location the master
 * doesn't have); its Warehouse type then follows on the server. Shared by the truck page and the intake wizard.
 */
export function warehouseFieldChoices(stageId: string, warehouses: WarehouseMaster[]): Record<string, string[]> | undefined {
  return stageId === "n-gate" ? { "WH LOCATION": listSites(warehouses).map((w) => w.name) } : undefined;
}
