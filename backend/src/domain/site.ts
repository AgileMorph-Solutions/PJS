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
