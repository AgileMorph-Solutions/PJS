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
