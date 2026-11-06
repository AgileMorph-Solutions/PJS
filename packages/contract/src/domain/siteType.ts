import type { WarehouseAliasMaster, WarehouseMaster } from "../types/receipt.js";

/**
 * The Unit/Central type of whichever site a warehouse name belongs to, read from the warehouse master.
 * A receipt's warehouse can be the site, one of its stores, or a known alias, so all three resolve here.
 * Null when the master gives the site no type.
 */
export function siteTypeOf(warehouses: WarehouseMaster[], aliases: WarehouseAliasMaster[] | undefined, name: string): string | null {
  const find = (n: string) => warehouses.find((w) => w.name === n) ?? warehouses.find((w) => w.name === aliases?.find((a) => a.alias === n)?.warehouseName);
  const row = find(name);
  if (!row) return null;
  return (row.site ? find(row.site) : row)?.type ?? null;
}
