/**
 * The app's operational tier for a warehouse SITE: a "Unit" warehouse (regional intake, e.g. Bouaké)
 * or the "Central" warehouse (the factory, e.g. Yakro). Stored as `Warehouse.type`, set on SITE rows
 * only and never defaulted — a guessed tier is indistinguishable from a real one.
 *
 * This is deliberately separate from `warehouseKinds.ts`: `kind` is the client's own
 * Village/Regional/Factory vocabulary (a fact about the warehouse), `type` is which section of the
 * app it belongs to (Unit vs Central) and therefore which users can be assigned to it.
 */
export type WarehouseType = "UNIT" | "CENTRAL";

export const WAREHOUSE_TYPES: { value: WarehouseType; label: string }[] = [
  { value: "UNIT", label: "Unit Warehouse" },
  { value: "CENTRAL", label: "Central Warehouse" },
];

export const WAREHOUSE_TYPE_LABEL: Record<WarehouseType, string> = Object.fromEntries(
  WAREHOUSE_TYPES.map((t) => [t.value, t.label])
) as Record<WarehouseType, string>;

export function isWarehouseType(value: unknown): value is WarehouseType {
  return value === "UNIT" || value === "CENTRAL";
}
