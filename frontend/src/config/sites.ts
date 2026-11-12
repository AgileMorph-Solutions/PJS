/**
 * The app's warehouse sections, built from the Warehouses master — there is no fixed list. Every site an admin adds in
 * Masters › Warehouses (and classifies) becomes a section at `/<slug>/*`; a non-admin is only ever shown their own
 * (the API scopes /api/masters to it too). Rules live in contract's domain/siteType.ts; this only adds what the
 * screens print.
 */
import type { Masters, WarehouseMaster } from "../types/receipt";
import { listSites, siteOf, warehouseSlug } from "@anagroci/contract/domain/siteType";
import { WAREHOUSE_TYPE_LABEL, isWarehouseType, type WarehouseType } from "../data/warehouseTypes";
import { WAREHOUSE_KIND_LABEL, type WarehouseKind } from "../data/warehouseKinds";

/** A section's URL segment: the site's name, slugged (contract's warehouseSlug). */
export type SiteSlug = string;

export interface SiteConfig {
  slug: SiteSlug;
  /** What kind of section it is ("Unit Warehouse", "Central Warehouse", or the client's own kind) — the kicker. */
  label: string;
  /** The site's own name, as the master has it — what people recognise. */
  sublabel: string;
  /** The real `Warehouse.name` every site-scoped API read sends as `?warehouse=`. */
  warehouseName: string;
  /** Other names rows of this site may carry (WarehouseAlias rows). */
  aliases: string[];
  /** Its stores (master rows whose `site` is this one). */
  stores: string[];
  type: WarehouseType | null;
}

export { warehouseSlug };

function toSite(w: WarehouseMaster, masters: Pick<Masters, "warehouses" | "aliases">): SiteConfig {
  const aliases = (masters.aliases ?? []).filter((a) => a.warehouseName === w.name).map((a) => a.alias);
  const names = new Set([w.name, ...aliases]);
  const type = isWarehouseType(w.type) ? w.type : null;
  return {
    slug: warehouseSlug(w.name),
    label: type ? WAREHOUSE_TYPE_LABEL[type] : w.kind ? WAREHOUSE_KIND_LABEL[w.kind as WarehouseKind] ?? w.kind : "Warehouse",
    sublabel: w.name,
    warehouseName: w.name,
    aliases,
    stores: masters.warehouses.filter((s) => s.site && names.has(s.site)).map((s) => s.name).sort(),
    type,
  };
}

/** Every section the master defines, sorted by name. */
export function sitesFrom(masters: Pick<Masters, "warehouses" | "aliases">): SiteConfig[] {
  return listSites(masters.warehouses).map((w) => toSite(w, masters));
}

/** The section a warehouse name (site, store or alias) belongs to, among `sites`. */
export function siteForWarehouse(sites: SiteConfig[], masters: Pick<Masters, "warehouses" | "aliases">, name: string): SiteConfig | undefined {
  const row = siteOf(masters.warehouses, masters.aliases, name);
  return row ? sites.find((s) => s.warehouseName === row.name) : sites.find((s) => s.aliases.includes(name) || s.stores.includes(name));
}

/** The `:site` segment for a record of `warehouse`: its site's slug, or the name's own when the master doesn't place
 * it (that section then says plainly it doesn't exist, rather than the link guessing another one). */
export function siteSlugFor(sites: SiteConfig[], masters: Pick<Masters, "warehouses" | "aliases">, warehouse: string): SiteSlug {
  return siteForWarehouse(sites, masters, warehouse)?.slug ?? warehouseSlug(warehouse);
}
