/**
 * The warehouse typology the client uses, verbatim: "Village/Regional/Factory" — already present as
 * free text on two stage fields (stages.ts's n-gate and n-stock, col `warehouseType`) but never
 * structured anywhere until the two-section revamp. This is the one place the vocabulary is defined;
 * `Warehouse.kind` in the Prisma schema stores these values, set on SITE rows only (a row with a
 * non-null `site` is a STORE below a site, not a site itself, and never carries a kind).
 *
 * "Regional Central" is one kind, not two — Bouaké is the client's regional/central warehouse,
 * distinct from a Village-level collection point and from the Yakro Factory.
 */
export type WarehouseKind = "VILLAGE" | "REGIONAL_CENTRAL" | "FACTORY";

export const WAREHOUSE_KINDS: { value: WarehouseKind; label: string }[] = [
  { value: "VILLAGE", label: "Village" },
  { value: "REGIONAL_CENTRAL", label: "Regional Central" },
  { value: "FACTORY", label: "Factory" },
];

export const WAREHOUSE_KIND_LABEL: Record<WarehouseKind, string> = Object.fromEntries(
  WAREHOUSE_KINDS.map((k) => [k.value, k.label])
) as Record<WarehouseKind, string>;
