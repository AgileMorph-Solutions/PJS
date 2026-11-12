/**
 * Site scoping — expands a canonical site name ("BOUAKE", "YAKRO FACTORY") into every name a
 * source workbook might actually store on a row: the site itself, its stores (BKE-001/002/003
 * under BOUAKE), and its aliases (ANAGROCI-01, YAMOUSSOUKRO under YAKRO FACTORY — see
 * WarehouseAlias.provenance).
 *
 * Without this, `?warehouse=BOUAKE` would only match rows that happen to store the site name
 * verbatim — which the DISCHARGEMENT-sourced rows never do, since that sheet's own "Warehouse"
 * column always holds a store code. Every route that scopes by warehouse should filter on
 * `resolveSite()`'s result, never on the raw name alone.
 */
import { prisma } from "../db.js";

export async function resolveSite(name: string): Promise<string[]> {
  const [stores, aliases] = await Promise.all([
    prisma.warehouse.findMany({ where: { site: name }, select: { name: true } }),
    prisma.warehouseAlias.findMany({ where: { warehouseName: name }, select: { alias: true } }),
  ]);
  // A store row can ALSO carry an alias for the same name (ANAGROCI-01 is both a store under
  // YAKRO FACTORY and an alias to it) — dedupe rather than passing a name twice into an `in` filter.
  return [...new Set([name, ...stores.map((s) => s.name), ...aliases.map((a) => a.alias)])];
}

/**
 * What a person assigned to `warehouse` may see: the one rule for user scoping, used by every check that asks "is
 * this mine". Users are assigned to a STORE (BKE-001) — the place they actually work. They see that store, plus what
 * is filed under the site's own name or aliases with no store on it (a BKT is sent site to site, a production run
 * belongs to the factory, an old receipt may name only BOUAKE): hiding those would leave nobody able to see them.
 * A sibling store (BKE-002) is never theirs. A user still assigned to a whole site (from before stores were
 * assignable) keeps the whole site, so nobody is locked out until an admin moves them to a store.
 */
export async function resolveScope(warehouse: string): Promise<string[]> {
  const row = await prisma.warehouse.findUnique({ where: { name: warehouse }, select: { site: true } });
  if (!row?.site) return resolveSite(warehouse);
  const [siteNames, siblings] = await Promise.all([
    resolveSite(row.site),
    prisma.warehouse.findMany({ where: { site: row.site, name: { not: warehouse } }, select: { name: true } }),
  ]);
  const other = new Set(siblings.map((s) => s.name));
  return [warehouse, ...siteNames.filter((n) => n !== warehouse && !other.has(n))];
}
