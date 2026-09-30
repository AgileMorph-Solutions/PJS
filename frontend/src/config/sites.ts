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
  /**
   * Known alternate names for this site (WarehouseAlias rows, e.g. "YAMOUSSOUKRO" for Yakro
   * Factory — see backend's warehouse_site_name_variants finding). `/api/masters` doesn't expose
   * aliases today, so this is hardcoded here for the one place the frontend needs to recognize
   * them: grouping a store under the right site on the Masters > Warehouses page even when a real
   * upload has left that store's own `site` column pointing at the alias rather than the canonical
   * name (a genuine, known data quirk — see WarehousesPage.tsx's own comment).
   */
  aliases: string[];
}

export const SITES: Record<SiteSlug, SiteConfig> = {
  unit: {
    slug: "unit",
    label: "Unit / Regional Warehouse",
    sublabel: "Bouaké",
    warehouseName: "BOUAKE",
    aliases: [],
  },
  central: {
    slug: "central",
    label: "Central Warehouse",
    sublabel: "Yakro Factory",
    warehouseName: "YAKRO FACTORY",
    aliases: ["YAMOUSSOUKRO"],
  },
};

export const SITE_LIST: SiteConfig[] = Object.values(SITES);

/** A user is assigned one warehouse, whose DB-side `type` (UNIT | CENTRAL — see
 * data/warehouseTypes.ts) decides which section of the app they belong to. */
export function siteSlugForType(type: string | null | undefined): SiteSlug | undefined {
  return type === "UNIT" ? "unit" : type === "CENTRAL" ? "central" : undefined;
}

export function isSiteSlug(value: string | undefined): value is SiteSlug {
  return value === "unit" || value === "central";
}

/** The reverse of `SITES[slug].warehouseName` — for the one spot that starts from a warehouse name
 * instead of a slug (WarehouseTransfersPage reads an incoming `?warehouse=` deep link). Canonical
 * name only, deliberately — a `?warehouse=` deep link is always written by this app itself, using
 * the canonical name, never an alias. */
export function siteSlugForWarehouse(name: string): SiteSlug | undefined {
  return SITE_LIST.find((s) => s.warehouseName === name)?.slug;
}

/** Like `siteSlugForWarehouse`, but also matches a site's known aliases — for grouping a STORE
 * (whose own `site` column may hold either the canonical name or an alias, depending on which of
 * two upserts last touched it) under the right site bucket. See `SiteConfig.aliases`'s comment. */
export function siteSlugForSiteName(name: string): SiteSlug | undefined {
  return SITE_LIST.find((s) => s.warehouseName === name || s.aliases.includes(name))?.slug;
}
