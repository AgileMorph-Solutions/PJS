import suppliersSeed from "../data/seed/suppliers.json";
import warehousesSeed from "../data/seed/warehouses.json";
import binsSeed from "../data/seed/bins.json";
import originsSeed from "../data/seed/origins.json";

export interface Supplier {
  code: string;
  name: string;
}

export interface Masters {
  suppliers: Supplier[];
  warehouses: string[];
  bins: string[];
  origins: string[];
}

export function loadSeedMasters(): Masters {
  return {
    suppliers: suppliersSeed as Supplier[],
    warehouses: warehousesSeed as string[],
    bins: binsSeed as string[],
    origins: originsSeed as string[],
  };
}
