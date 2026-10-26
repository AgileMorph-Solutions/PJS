/**
 * Masters: suppliers, warehouses, bins, origins. Read as a flat Masters shape matching the
 * frontend's TrackingApi; written via upsert so "add" is idempotent (re-submitting an existing
 * code/name updates it rather than erroring).
 */
import { prisma } from "../db.js";
import { WAREHOUSE_KINDS, type WarehouseKind } from "@anagroci/contract/data/warehouseKinds";
import { WAREHOUSE_TYPES, type WarehouseType } from "@anagroci/contract/data/warehouseTypes";
import { isValidWarehouseCode } from "@anagroci/contract/domain/ids";
import { normalizeSupplierName } from "@anagroci/contract/domain/supplierCode";
import { normalizeOriginName, findSimilarOrigin } from "@anagroci/contract/domain/origin";
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
    // Lean on purpose: every signed-in role reads this list (Branch Managers and QFS Officers too), so the register's
    // contact and bank details stay on the supplier page (services/suppliers.ts), which only admin / Incharge reach.
    // `active` is what the pickers filter on: an inactive supplier leaves them, a suspended one stays (with a warning).
    suppliers: suppliers.map((x) => ({ code: x.code, supplierNo: x.supplierNo, name: x.name, formerName: x.formerName, status: x.status, active: x.status !== "inactive" })),
    // {name, kind, site} rather than a bare string[]: `kind` (Village/Regional/Factory, set only
    // on site rows) and `site` (null = this row IS a site) are what the two-section UI resolves a
    // row's section from — see packages/contract/src/data/warehouseKinds.ts.
    // `type` (UNIT | CENTRAL, site rows only) decides which app section a warehouse belongs to and
    // which users can be assigned to it; `aliases` lets the UI group a store under its site.
    // `code` (site rows only) is what every system ID issued there carries — see setWarehouseCode.
    warehouses: warehouses.map((w) => ({ name: w.name, kind: w.kind, type: w.type, site: w.site, code: w.code })),
    aliases: aliases.map((a) => ({ alias: a.alias, warehouseName: a.warehouseName })),
    bins: bins.map((b) => b.code),
    // Which store each Bin is in (null = imported without one), so a truck can be offered the Bins of its own store first.
    binInfo: bins.map((b) => ({ code: b.code, store: b.warehouseName })),
    origins: origins.map((o) => o.name),
    originInfo: origins.map((o) => ({ name: o.name, source: o.source, createdAt: o.createdAt?.toISOString() ?? null })),
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

/**
 * A new Bin from Masters › Bins. A Bin is a place inside a store, so the store is required (it is also what lets the Allocate-Bin
 * step offer a truck the Bins of its own store first). The code is kept to letters, digits and - _ . (the Bin step reads several
 * Bins separated by "/" or ","), can't be a store's own code, and can't already exist: a duplicate is refused, never quietly merged.
 */
export async function createBin(input: { code?: string; warehouseName?: string }) {
  const code = (input.code ?? "").trim().toUpperCase();
  if (!code) throw new ValidationError("A Bin needs a code.");
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(code)) throw new ValidationError(`"${code}" can only use letters, digits and - _ . (no spaces, slashes or commas).`);
  const store = (input.warehouseName ?? "").trim();
  if (!store) throw new ValidationError("Choose the store this Bin is in.");
  if (!(await prisma.warehouse.findFirst({ where: { name: store, site: { not: null } }, select: { name: true } }))) {
    throw new ValidationError(`"${store}" isn't a store. Choose one of the stores of a warehouse.`);
  }
  if (await prisma.warehouse.findFirst({ where: { name: code, site: { not: null } }, select: { name: true } })) {
    throw new ValidationError(`${code} is a store (a warehouse code), not a Bin. Use a Bin code inside it, e.g. ${code}-BIN-012.`);
  }
  if (await prisma.bin.findUnique({ where: { code }, select: { code: true } })) throw new ValidationError(`Bin ${code} already exists.`);
  return prisma.bin.create({ data: { code, warehouseName: store, source: "entered", createdAt: new Date() } });
}

/**
 * A new Origin from Masters › Origins. Stored in capitals like the rest of the master, and refused — never quietly merged —
 * when the town is already there, either exactly or under another spelling (M BAHIAKRO for M'BAHIAKRO, SAKKASSOU for SAKASSOU):
 * a second spelling would make a truck's origin look different from its plan's (deliveryPlan.ts's origin_mismatch).
 */
export async function createOrigin(input: { name?: string }) {
  const name = normalizeOriginName(input.name);
  if (!name) throw new ValidationError("An origin needs a name.");
  if (!/^[\p{L}0-9][\p{L}0-9 '.-]*$/u.test(name)) throw new ValidationError(`"${name}" can only use letters, digits, spaces and ' . -`);
  const existing = (await prisma.origin.findMany({ select: { name: true } })).map((o) => o.name);
  if (existing.includes(name)) throw new ValidationError(`Origin ${name} already exists.`);
  const similar = findSimilarOrigin(name, existing);
  if (similar) throw new ValidationError(`${similar} is already in the master — it looks like the same town as ${name}. Use ${similar}.`);
  return prisma.origin.create({ data: { name, source: "entered", createdAt: new Date() } });
}
