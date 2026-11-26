import { listSites } from "@anagroci/contract/domain/siteType";
import type { WarehouseMaster } from "@anagroci/contract/types/receipt";

/**
 * Arrival's WH LOCATION is picked from the Warehouses master, never typed (the server refuses a location the master
 * doesn't have); its Warehouse type then follows on the server. Shared by the truck page and the intake wizard.
 */
export function warehouseFieldChoices(stageId: string, warehouses: WarehouseMaster[]): Record<string, string[]> | undefined {
  return stageId === "n-gate" ? { "WH LOCATION": listSites(warehouses).map((w) => w.name) } : undefined;
}

/**
 * Other warehouse activities (20 Nov 2026 team): the movement and the linked stock are a Bin of this truck's site, the linked
 * location a warehouse code from the master (BKE, YAK…). Picked, not typed, so they always name something that exists.
 */
export function otherActivityChoices(stageId: string, bins: string[], warehouses: WarehouseMaster[]): Record<string, string[]> | undefined {
  // The Activity ledger's "Linked Lot/Bin" is a Bin too, picked like the activities' (team, 23 Nov 2026); its Location a
  // warehouse from the master (26 Nov 2026, user), the same names it fills itself with.
  if (stageId === "n-ledger") return { "Linked Lot/Bin": bins, Location: listSites(warehouses).map((w) => w.name) };
  if (stageId !== "n-otheract") return undefined;
  const codes = [...new Set(warehouses.map((w) => (w.code ?? "").trim()).filter(Boolean))].sort();
  return { "Movement between locations": bins, "Linked stock/lot": bins, "Linked location": codes };
}
