import suppliers from "../data/seed/suppliers.json";
import warehouses from "../data/seed/warehouses.json";
import bins from "../data/seed/bins.json";
import origins from "../data/seed/origins.json";
import type { Masters, Supplier, WarehouseMaster } from "@anagroci/contract/types/receipt";

export type { Masters, Supplier };

/** Offline fallback only — the API is the real source of masters. */
export function loadSeedMasters(): Masters {
  return {
    suppliers: suppliers as Supplier[],
    // The offline seed json is just names — kind/site are the API's typology backfill
    // (prisma/seed.ts's backfillWarehouseTypology), which this static fallback has no way to know.
    warehouses: (warehouses as string[]).map((name): WarehouseMaster => ({ name, kind: null, site: null })),
    bins: bins as string[],
    origins: origins as string[],
  };
}
