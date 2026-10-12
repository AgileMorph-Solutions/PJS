/**
 * Masters: suppliers, warehouses, bins, origins. Read as a flat Masters shape matching the
 * frontend's TrackingApi; written via upsert so "add" is idempotent (re-submitting an existing
 * code/name updates it rather than erroring).
 */
import { prisma } from "../db.js";
import { WAREHOUSE_KINDS, type WarehouseKind } from "@anagroci/contract/data/warehouseKinds";
import { WAREHOUSE_TYPES, type WarehouseType } from "@anagroci/contract/data/warehouseTypes";
import { isValidWarehouseCode } from "@anagroci/contract/domain/ids";
import { normalizeSupplierName, suggestLbaCode } from "@anagroci/contract/domain/supplierCode";
import { ValidationError } from "../domain/validation.js";

const VALID_KINDS = new Set<string>(WAREHOUSE_KINDS.map((k) => k.value));
const VALID_TYPES = new Set<string>(WAREHOUSE_TYPES.map((t) => t.value));

export async function listMasters() {
  const [suppliers, warehouses, bins, origins, aliases] = await Promise.all([
    prisma.supplier.findMany({ orderBy: { code: "asc" } }),
    prisma.warehouse.findMany({ orderBy: { name: "asc" } }),
    prisma.bin.findMany({ orderBy: { code: "asc" } }),
    prisma.origin.findMany({ orderBy: { name: "asc" } }),
    prisma.warehouseAlias.findMany({ orderBy: { alias: "asc" } }),
  ]);
  return {
    suppliers,
    // {name, kind, site} rather than a bare string[]: `kind` (Village/Regional/Factory, set only
    // on site rows) and `site` (null = this row IS a site) are what the two-section UI resolves a
    // row's section from — see packages/contract/src/data/warehouseKinds.ts.
    // `type` (UNIT | CENTRAL, site rows only) decides which app section a warehouse belongs to and
    // which users can be assigned to it; `aliases` lets the UI group a store under its site.
    // `code` (site rows only) is what every system ID issued there carries — see setWarehouseCode.
    warehouses: warehouses.map((w) => ({ name: w.name, kind: w.kind, type: w.type, site: w.site, code: w.code })),
    aliases: aliases.map((a) => ({ alias: a.alias, warehouseName: a.warehouseName })),
    bins: bins.map((b) => b.code),
    origins: origins.map((o) => o.name),
  };
}

/**
 * Stored name, plus the original when "RCN" was dropped (so a workbook that still carries it can be
 * matched, and the change undone). Every writer of a supplier goes through this.
 */
export function supplierNameFields(name: string, { lenient = false } = {}): { name: string; formerName?: string } {
  // `lenient` is for importers: a name that is only "RCN" keeps its text rather than aborting a whole upload.
  const clean = normalizeSupplierName(name) || (lenient ? name.trim() : "");
  if (!clean) throw new ValidationError("A supplier needs a name.");
  return clean === name.trim() ? { name: clean } : { name: clean, formerName: name.trim() };
}

/** Idempotent upsert, for callers that mean "make sure this supplier exists" (approving a supplier request). */
export async function addSupplier(code: string, name: string) {
  const fields = supplierNameFields(name);
  return prisma.supplier.upsert({ where: { code }, update: fields, create: { code, ...fields } });
}

/** The next free LBA code for a name; the person can overwrite it before saving. */
export async function suggestSupplierCode(name: string) {
  const codes = (await prisma.supplier.findMany({ select: { code: true } })).map((s) => s.code);
  return suggestLbaCode(name, codes);
}

/** A new supplier from the Suppliers screen: refuses an existing code instead of silently overwriting it. */
export async function createSupplier(input: { code?: string; name: string }) {
  const fields = supplierNameFields(input.name);
  const code = input.code?.trim() || (await suggestSupplierCode(fields.name));
  if (await prisma.supplier.findUnique({ where: { code } })) throw new ValidationError(`Supplier code ${code} already exists.`);
  return prisma.supplier.create({ data: { code, ...fields, source: "entered" } });
}

/** What still points at a supplier: the reason it can be switched off but not deleted. */
export async function supplierReferences(code: string) {
  const [receipts, plans, jute, assignments] = await Promise.all([
    prisma.receipt.count({ where: { lbaCode: code } }),
    prisma.deliveryPlan.count({ where: { supplierCode: code } }),
    prisma.juteWarehouseMovement.count({ where: { supplierCode: code } }),
    prisma.branchManagerSupplier.count({ where: { supplierCode: code } }),
  ]);
  return { receipts, plans, jute, assignments, total: receipts + plans + jute + assignments };
}

const notFound = () => Object.assign(new Error("Supplier not found"), { code: "P2025" });

/** Rename, or change the code. A code other records already carry can't move: they would be left pointing at nothing. */
export async function updateSupplier(code: string, patch: { name?: string; code?: string }) {
  const existing = await prisma.supplier.findUnique({ where: { code } });
  if (!existing) throw notFound();
  const data: { name?: string; formerName?: string | null; code?: string } = {};
  if (patch.name !== undefined) {
    const fields = supplierNameFields(patch.name);
    data.name = fields.name;
    // The original is only ever the first one recorded; an edit made by hand has no "former" worth keeping.
    if (fields.formerName && !existing.formerName) data.formerName = fields.formerName;
  }
  const newCode = patch.code?.trim();
  if (newCode && newCode !== code) {
    const refs = await supplierReferences(code);
    if (refs.total) throw new ValidationError(`Code ${code} is already used by ${refs.total} record${refs.total > 1 ? "s" : ""}, so it can't be changed. Add a new supplier instead.`);
    if (await prisma.supplier.findUnique({ where: { code: newCode } })) throw new ValidationError(`Supplier code ${newCode} already exists.`);
    data.code = newCode;
  }
  return prisma.supplier.update({ where: { code }, data });
}

export async function setSupplierActive(code: string, active: boolean) {
  if (!(await prisma.supplier.findUnique({ where: { code } }))) throw notFound();
  return prisma.supplier.update({ where: { code }, data: { active } });
}

/** Deletes a supplier nothing refers to; otherwise switches it off and says why, so history stays whole. */
export async function removeSupplier(code: string) {
  if (!(await prisma.supplier.findUnique({ where: { code } }))) throw notFound();
  const refs = await supplierReferences(code);
  if (refs.total) {
    await prisma.supplier.update({ where: { code }, data: { active: false } });
    return { deleted: false as const, deactivated: true as const, references: refs };
  }
  await prisma.supplier.delete({ where: { code } });
  return { deleted: true as const, deactivated: false as const, references: refs };
}

/**
 * A warehouse is either a SITE (`kind` set — Village/Regional Central/Factory, `site` stays null)
 * or a STORE under an existing site (`site` set to that site's name, `kind` stays null) — never
 * both, matching the Site -> Store -> Bin hierarchy schema.prisma's Warehouse model documents.
 * Adding one with neither classification is still allowed (a bare name, classified later — the
 * behavior this endpoint always had), but never both at once: that would leave a row claiming to
 * be a site and someone's store simultaneously, which nothing else in this app expects.
 */
export async function addWarehouse(name: string, opts: { kind?: WarehouseKind; site?: string; type?: WarehouseType } = {}) {
  const { kind, site, type } = opts;
  if (kind && site) throw new ValidationError("A warehouse is either a site (kind) or a store under one (site), not both.");
  if (kind && !VALID_KINDS.has(kind)) throw new ValidationError(`Unknown warehouse kind "${kind}".`);
  assertTypeFits(type, site);
  return prisma.warehouse.upsert({
    where: { name },
    update: { kind: kind ?? undefined, site: site ?? undefined, type: type ?? undefined },
    create: { name, kind: kind ?? null, site: site ?? null, type: type ?? null },
  });
}

/** `type` is a property of a SITE (a store belongs to its site's section), so a store can't carry one. */
function assertTypeFits(type: string | undefined | null, site: string | null | undefined) {
  if (type && !VALID_TYPES.has(type)) throw new ValidationError(`Unknown warehouse type "${type}".`);
  if (type && site) throw new ValidationError("Only a site can have a Unit/Central type, not a store under one.");
}

/** Admin assigns (or clears) the Unit/Central type on a site. */
export async function setWarehouseType(name: string, type: string | null) {
  const wh = await prisma.warehouse.findUnique({ where: { name } });
  if (!wh) throw Object.assign(new Error("Warehouse not found"), { code: "P2025" });
  assertTypeFits(type, wh.site);
  // Users are pinned to typed sites; clearing the type of a site that has users would strand them.
  if (!type && (await prisma.user.count({ where: { warehouse: name, active: true } }))) {
    throw new ValidationError(`"${name}" has active users — reassign them before clearing its type.`);
  }
  return prisma.warehouse.update({ where: { name }, data: { type } });
}

/**
 * Admin sets the code printed into every ID issued at a site (REC-<code>-2027-001). Set on sites
 * only — a store's receipts are numbered with its site's code. Once any ID carries the code it is
 * frozen: those IDs are permanent, and a renamed code would restart the numbering under a second
 * name for the same warehouse.
 */
export async function setWarehouseCode(name: string, code: string | null) {
  const wh = await prisma.warehouse.findUnique({ where: { name } });
  if (!wh) throw Object.assign(new Error("Warehouse not found"), { code: "P2025" });
  if (wh.site) throw new ValidationError(`"${name}" is a store of ${wh.site} — IDs there use ${wh.site}'s code.`);
  const next = code?.trim().toUpperCase() || null;
  if (next && !isValidWarehouseCode(next)) {
    throw new ValidationError("A warehouse code is 2–12 capital letters or digits, no spaces or dashes (e.g. BKE).");
  }
  if (wh.code && wh.code !== next && (await codeInUse(wh.code))) {
    throw new ValidationError(`${wh.code} is already printed in issued IDs, so it can't be changed or cleared.`);
  }
  return prisma.warehouse.update({ where: { name }, data: { code: next } });
}

async function codeInUse(code: string): Promise<boolean> {
  const [receipts, lots, plans] = await Promise.all([
    prisma.receipt.count({ where: { id: { startsWith: siteIdPrefixAnyYear("REC", code) } } }),
    prisma.stageLotAssignment.count({ where: { lotNumber: { startsWith: siteIdPrefixAnyYear("LOT", code) } } }),
    prisma.deliveryPlan.count({ where: { id: { startsWith: siteIdPrefixAnyYear("DP", code) } } }),
  ]);
  return receipts + lots + plans > 0;
}

const siteIdPrefixAnyYear = (kind: string, code: string) => `${kind}-${code}-`;

export async function addBin(code: string, warehouseName?: string) {
  return prisma.bin.upsert({
    where: { code },
    update: { warehouseName: warehouseName ?? undefined },
    create: { code, warehouseName },
  });
}
