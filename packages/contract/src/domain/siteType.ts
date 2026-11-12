import type { WarehouseAliasMaster, WarehouseMaster } from "../types/receipt.js";

/**
 * A warehouse people can work at: a top-level row of the Warehouses master (not a store under one) with its
 * Unit/Central type and the ID code its records carry (REC-BKE-…, LOT-YAK-…). Without the code nothing can be recorded
 * there — no receipt, Lot or production ID can be issued — so a row missing either is not offered anywhere (user
 * assignment, site switcher, production, transfers) until an admin finishes it in Masters › Warehouses.
 */
export function isUsableSite(w: Pick<WarehouseMaster, "site" | "type" | "code">): boolean {
  return !w.site && Boolean(w.type) && Boolean(w.code);
}

/** What a top-level row still needs before it can be used, in the admin's words; empty when it is usable. */
export function siteSetupGaps(w: Pick<WarehouseMaster, "site" | "type" | "code">): string[] {
  if (w.site) return [];
  return [!w.type && "a Unit/Central type", !w.code && "an ID code"].filter((g): g is string => Boolean(g));
}

/**
 * The warehouses of the master people can work at (isUsableSite), sorted — there is no fixed list of them anywhere in
 * the app. Masters › Warehouses also shows the unfinished ones, so they can be completed.
 */
export function listSites<W extends WarehouseMaster>(warehouses: W[]): W[] {
  return warehouses.filter(isUsableSite).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The URL segment for a site: its name, lower-cased, with every run of other characters a single dash
 * ("YAKRO FACTORY" -> "yakro-factory"). Derived, never stored, so renaming nothing can drift.
 */
export function warehouseSlug(name: string): string {
  return name.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * The site row a warehouse name belongs to. A receipt's warehouse can be the site, one of its stores, or a known
 * alias, so all three resolve here. Undefined when the name isn't in the master (or the viewer can't see it).
 */
export function siteOf<W extends WarehouseMaster>(warehouses: W[], aliases: WarehouseAliasMaster[] | undefined, name: string): W | undefined {
  const find = (n: string) => warehouses.find((w) => w.name === n) ?? warehouses.find((w) => w.name === aliases?.find((a) => a.alias === n)?.warehouseName);
  const row = find(name);
  if (!row) return undefined;
  return row.site ? find(row.site) : row;
}

/** The Unit/Central type of whichever site a warehouse name belongs to. Null when the master gives the site no type. */
export function siteTypeOf(warehouses: WarehouseMaster[], aliases: WarehouseAliasMaster[] | undefined, name: string): string | null {
  return siteOf(warehouses, aliases, name)?.type ?? null;
}

/**
 * The store a truck is at — Reception works one store at a time, the site above it is only a grouping. A receipt filed
 * at a store (what every store-bound user's receipt is) is at that store. One filed at the site itself (imported, or
 * from before stores were assignable) is at the store its gate recorded as "WH NO." — when that names a store of the
 * same site. Anything else is at no store: null, so Reception can show it as such rather than hide it. Undefined
 * aliases are fine: a receipt only ever names a master row or an alias of one.
 */
export function receiptStore(
  warehouses: WarehouseMaster[],
  aliases: WarehouseAliasMaster[] | undefined,
  receipt: { warehouse: string; stageData?: Record<string, Record<string, string> | undefined> }
): string | null {
  const own = warehouses.find((w) => w.name === receipt.warehouse);
  if (own?.site) return own.name;
  const site = siteOf(warehouses, aliases, receipt.warehouse);
  const gate = (receipt.stageData?.["n-gate"]?.["WH NO."] ?? "").trim();
  if (!site || !gate) return null;
  const store = warehouses.find((w) => w.name === gate);
  return store?.site && siteOf(warehouses, aliases, store.site)?.name === site.name ? store.name : null;
}
