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
    warehouses: warehouses.map((w) => w.name),
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
