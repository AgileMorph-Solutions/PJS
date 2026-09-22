import suppliers from "../data/seed/suppliers.json";
import warehouses from "../data/seed/warehouses.json";
import bins from "../data/seed/bins.json";
import origins from "../data/seed/origins.json";
import type { Masters, Supplier } from "@anagroci/contract/types/receipt";

export type { Masters, Supplier };

/** Offline fallback only — the API is the real source of masters. */
export function loadSeedMasters(): Masters {
  return {
    suppliers: suppliers as Supplier[],
    warehouses: warehouses as string[],
    bins: bins as string[],
    origins: origins as string[],
  };
}
