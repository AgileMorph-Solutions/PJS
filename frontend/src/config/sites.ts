/**
 * The two real sites the client's workbooks split on (see backend/src/domain/site.ts and
 * packages/contract/src/data/warehouseKinds.ts) — "unit"/"central" are only the URL slugs; the
 * `warehouseName` is the actual `Warehouse.name` row every site-scoped endpoint's `?warehouse=`
 * expects (it gets expanded server-side to its stores/aliases by `resolveSite()`).
 *
 * Adding a third site later is meant to be exactly: one more entry here + the two nav items in
 * config/nav.ts — every page under `/:site/*` reads its warehouse to scope by from `useSite()`,
 * never a hardcoded name.
 */
export type SiteSlug = "unit" | "central";

export interface SiteConfig {
  slug: SiteSlug;
  /** Section label, without the site name — matches NavSection.label. */
  label: string;
  /** The site name shown under the label (NavSection.sublabel) and in page kickers. */
  sublabel: string;
  /** The real `Warehouse.name` this section scopes every API read by by (`?warehouse=`). */
  warehouseName: string;
}

export const SITES: Record<SiteSlug, SiteConfig> = {
  unit: {
    slug: "unit",
    label: "Unit / Regional Warehouse",
    sublabel: "Bouaké",
    warehouseName: "BOUAKE",
  },
  central: {
    slug: "central",
    label: "Central Warehouse",
    sublabel: "Yakro Factory",
    warehouseName: "YAKRO FACTORY",
  },
};

export const SITE_LIST: SiteConfig[] = Object.values(SITES);

export function isSiteSlug(value: string | undefined): value is SiteSlug {
  return value === "unit" || value === "central";
}

/** The reverse of `SITES[slug].warehouseName` — for the one spot that starts from a warehouse name
 * instead of a slug (WarehouseTransfersPage reads an incoming `?warehouse=` deep link). */
export function siteSlugForWarehouse(name: string): SiteSlug | undefined {
  return SITE_LIST.find((s) => s.warehouseName === name)?.slug;
}
