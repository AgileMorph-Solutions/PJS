/**
 * Masters: suppliers, warehouses, bins, origins. Read as a flat Masters shape matching the
 * frontend's TrackingApi; written via upsert so "add" is idempotent (re-submitting an existing
 * code/name updates it rather than erroring).
 */
import { prisma } from "../db.js";
import { WAREHOUSE_KINDS, type WarehouseKind } from "@anagroci/contract/data/warehouseKinds";
import { ValidationError } from "../domain/validation.js";

const VALID_KINDS = new Set<string>(WAREHOUSE_KINDS.map((k) => k.value));

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

/**
 * A warehouse is either a SITE (`kind` set — Village/Regional Central/Factory, `site` stays null)
 * or a STORE under an existing site (`site` set to that site's name, `kind` stays null) — never
 * both, matching the Site -> Store -> Bin hierarchy schema.prisma's Warehouse model documents.
 * Adding one with neither classification is still allowed (a bare name, classified later — the
 * behavior this endpoint always had), but never both at once: that would leave a row claiming to
 * be a site and someone's store simultaneously, which nothing else in this app expects.
 */
export async function addWarehouse(name: string, opts: { kind?: WarehouseKind; site?: string } = {}) {
  const { kind, site } = opts;
  if (kind && site) throw new ValidationError("A warehouse is either a site (kind) or a store under one (site), not both.");
  if (kind && !VALID_KINDS.has(kind)) throw new ValidationError(`Unknown warehouse kind "${kind}".`);
  return prisma.warehouse.upsert({
    where: { name },
    update: { kind: kind ?? undefined, site: site ?? undefined },
    create: { name, kind: kind ?? null, site: site ?? null },
  });
}

export async function addBin(code: string, warehouseName?: string) {
  return prisma.bin.upsert({
    where: { code },
    update: { warehouseName: warehouseName ?? undefined },
    create: { code, warehouseName },
  });
}
