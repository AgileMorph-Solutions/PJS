/**
 * Masters: suppliers, warehouses, bins, origins. Read as a flat Masters shape matching the
 * frontend's TrackingApi; written via upsert so "add" is idempotent (re-submitting an existing
 * code/name updates it rather than erroring).
 */
import { prisma } from "../db.js";

export async function listMasters() {
  const [suppliers, warehouses, bins, origins] = await Promise.all([
    prisma.supplier.findMany({ orderBy: { code: "asc" } }),
    prisma.warehouse.findMany({ orderBy: { name: "asc" } }),
    prisma.bin.findMany({ orderBy: { code: "asc" } }),
    prisma.origin.findMany({ orderBy: { name: "asc" } }),
  ]);
  return {
    suppliers,
    // {name, kind, site} rather than a bare string[]: `kind` (Village/Regional/Factory, set only
    // on site rows) and `site` (null = this row IS a site) are what the two-section UI resolves a
    // row's section from — see packages/contract/src/data/warehouseKinds.ts.
    warehouses: warehouses.map((w) => ({ name: w.name, kind: w.kind, site: w.site })),
    bins: bins.map((b) => b.code),
    origins: origins.map((o) => o.name),
  };
}

export async function addSupplier(code: string, name: string) {
  return prisma.supplier.upsert({ where: { code }, update: { name }, create: { code, name } });
}

export async function addWarehouse(name: string) {
  return prisma.warehouse.upsert({ where: { name }, update: {}, create: { name } });
}

export async function addBin(code: string, warehouseName?: string) {
  return prisma.bin.upsert({
    where: { code },
    update: { warehouseName: warehouseName ?? undefined },
    create: { code, warehouseName },
  });
}
