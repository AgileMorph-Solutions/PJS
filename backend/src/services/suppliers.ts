/**
 * The supplier register (the client's LBA register): creating, editing and removing a supplier, and its page —
 * every register field plus the figures worked out from its trucks, delivery plans and jute movements.
 *
 * Which fields are required, and the save rules, live in contract domain/supplierProfile.ts; the figures in
 * contract domain/supplierPerformance.ts. This file only reads and writes.
 */
import type { Prisma } from "@prisma/client";
import { suggestLbaCode } from "@anagroci/contract/domain/supplierCode";
import {
  PROFILE_FIELDS, missingRequired, requiredCompleteness, requiredProblems, statusProblem,
  type ProfileKey, type SupplierProfileValues, type SupplierStatus,
} from "@anagroci/contract/domain/supplierProfile";
import { planProgress } from "@anagroci/contract/domain/deliveryPlan";
import { supplierPerformance } from "@anagroci/contract/domain/supplierPerformance";
import type { SupplierDetail } from "@anagroci/contract/types/receipt";
import { prisma } from "../db.js";
import { ValidationError } from "../domain/validation.js";
import { supplierNameFields } from "./masters.js";
import { PLAN_FACTS_SELECT, toFacts, toTerms } from "./planFacts.js";
import { juteBySupplier, NO_JUTE, SUPPLIER_TRUCK_SELECT, toSupplierTruckFacts } from "./supplierFacts.js";

const STATUSES = new Set<SupplierStatus>(["active", "inactive", "suspended"]);
const notFound = () => Object.assign(new Error("Supplier not found"), { code: "P2025" });
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export interface SupplierInput extends SupplierProfileValues {
  code?: string;
  status?: SupplierStatus;
  statusReason?: string | null;
}

/** The profile fields of a row, as the contract's rules read them. */
const profileOf = (row: Record<string, unknown>): SupplierProfileValues =>
  Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, (row[f.key] as string | null) ?? null]));

/** The profile fields a request sets, trimmed, blank as null. The name also goes through the "no RCN" rule. */
function profileData(input: SupplierInput): { data: Partial<Record<ProfileKey, string | null>>; formerName?: string } {
  const data: Partial<Record<ProfileKey, string | null>> = {};
  let formerName: string | undefined;
  for (const f of PROFILE_FIELDS) {
    if (!(f.key in input)) continue;
    if (f.key === "name") {
      const n = text(input.name);
      if (n) { const fields = supplierNameFields(n); data.name = fields.name; formerName = fields.formerName; } else data.name = null;
    } else data[f.key] = text(input[f.key]);
  }
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new ValidationError(`"${data.email}" isn't an email address.`);
  return { data, formerName };
}

function checkStatus(status: unknown): SupplierStatus {
  if (!STATUSES.has(status as SupplierStatus)) throw new ValidationError(`Status must be active, inactive or suspended.`);
  return status as SupplierStatus;
}

/** The next free LBA code for a name; the person can overwrite it before saving. */
export async function suggestSupplierCode(name: string) {
  const codes = (await prisma.supplier.findMany({ select: { code: true } })).map((s) => s.code);
  return suggestLbaCode(name, codes);
}

/** A new supplier from the Suppliers screen: every required field, and an LBA code nobody else has. */
export async function createSupplier(input: SupplierInput, actorId?: string) {
  const { data, formerName } = profileData(input);
  const problems = requiredProblems(data, null);
  if (problems.length) throw new ValidationError(problems.join(" "));
  const status = checkStatus(input.status ?? "active");
  const statusReason = text(input.statusReason);
  const sp = statusProblem(status, statusReason);
  if (sp) throw new ValidationError(sp);
  const code = text(input.code) ?? (await suggestSupplierCode(data.name!));
  if (await prisma.supplier.findUnique({ where: { code } })) throw new ValidationError(`Supplier code ${code} already exists.`);
  return prisma.supplier.create({
    data: { ...data, name: data.name!, formerName, code, status, statusReason, source: "entered", createdById: actorId, updatedById: actorId },
  });
}

/** What still points at a supplier: the reason it can be made inactive but not deleted. */
export async function supplierReferences(code: string) {
  const [receipts, plans, jute, assignments] = await Promise.all([
    prisma.receipt.count({ where: { lbaCode: code } }),
    prisma.deliveryPlan.count({ where: { supplierCode: code } }),
    prisma.juteWarehouseMovement.count({ where: { supplierCode: code } }),
    prisma.branchManagerSupplier.count({ where: { supplierCode: code } }),
  ]);
  return { receipts, plans, jute, assignments, total: receipts + plans + jute + assignments };
}

/**
 * Change register details, status or the code. An existing supplier may stay as incomplete as it was, but can't
 * empty a required field it has (contract requiredProblems). A code other records already carry can't move.
 * Saving the details by hand ends any "sample" marking: from then on they are the person's.
 */
export async function updateSupplier(code: string, input: SupplierInput, actorId?: string) {
  const existing = await prisma.supplier.findUnique({ where: { code } });
  if (!existing) throw notFound();
  const { data, formerName } = profileData(input);
  const problems = requiredProblems({ ...profileOf(existing), ...data }, profileOf(existing));
  if (problems.length) throw new ValidationError(problems.join(" "));

  // A blank name was refused above (it's required), so only a real one is written.
  const { name, ...details } = data;
  const update: Prisma.SupplierUncheckedUpdateInput = { ...details, ...(name ? { name } : {}), updatedById: actorId ?? null };
  // The original is only ever the first one recorded; an edit made by hand has no "former" worth keeping.
  if (formerName && !existing.formerName) update.formerName = formerName;
  if (Object.keys(data).some((k) => k !== "name")) update.detailsSource = null;

  const status = input.status !== undefined ? checkStatus(input.status) : (existing.status as SupplierStatus);
  const statusReason = input.statusReason !== undefined ? text(input.statusReason) : existing.statusReason;
  const sp = statusProblem(status, statusReason);
  if (sp) throw new ValidationError(sp);
  update.status = status;
  update.statusReason = status === "active" ? null : statusReason;

  const newCode = text(input.code);
  if (newCode && newCode !== code) {
    const refs = await supplierReferences(code);
    if (refs.total) throw new ValidationError(`Code ${code} is already used by ${refs.total} record${refs.total > 1 ? "s" : ""}, so it can't be changed. Add a new supplier instead.`);
    if (await prisma.supplier.findUnique({ where: { code: newCode } })) throw new ValidationError(`Supplier code ${newCode} already exists.`);
    update.code = newCode;
  }
  return prisma.supplier.update({ where: { code }, data: update });
}

/** Deletes a supplier nothing refers to; otherwise makes it inactive and says why, so history stays whole. */
export async function removeSupplier(code: string, actorId?: string) {
  if (!(await prisma.supplier.findUnique({ where: { code } }))) throw notFound();
  const refs = await supplierReferences(code);
  if (refs.total) {
    await prisma.supplier.update({
      where: { code },
      data: { status: "inactive", statusReason: "Removed from the list while still used by other records", updatedById: actorId ?? null },
    });
    return { deleted: false as const, deactivated: true as const, references: refs };
  }
  await prisma.supplier.delete({ where: { code } });
  return { deleted: true as const, deactivated: false as const, references: refs };
}

/** The supplier page: register entry, how complete it is, and the figures from its trucks, plans and jute. */
export async function getSupplierDetail(code: string): Promise<SupplierDetail | null> {
  const s = await prisma.supplier.findUnique({
    where: { code },
    include: { createdBy: { select: { displayName: true } }, updatedBy: { select: { displayName: true } } },
  });
  if (!s) return null;

  const [receipts, plans, jute, references] = await Promise.all([
    // Trucks belong to a supplier by LBA code, the one key every truck carries; a name alone is too loose to count on.
    prisma.receipt.findMany({ where: { lbaCode: code }, select: SUPPLIER_TRUCK_SELECT }),
    prisma.deliveryPlan.findMany({ where: { supplierCode: code }, include: { receipts: { select: PLAN_FACTS_SELECT } } }),
    juteBySupplier({ code }),
    supplierReferences(code),
  ]);

  const trucks = receipts.map(toSupplierTruckFacts);
  const planFacts = plans.map((p) => {
    const terms = toTerms(p);
    return { expectedKg: terms.expectedQuantityKg, receivedKg: planProgress(terms, p.receipts.map(toFacts)).actualKg, cancelled: terms.cancelled };
  });

  const profile = profileOf(s);
  return {
    code: s.code, supplierNo: s.supplierNo, name: s.name, formerName: s.formerName,
    status: s.status as SupplierStatus, statusReason: s.statusReason,
    profile, detailsSource: s.detailsSource,
    completeness: requiredCompleteness(profile), missing: missingRequired(profile).map((f) => f.label),
    createdAt: s.createdAt.toISOString(), createdBy: s.createdBy?.displayName ?? null,
    updatedAt: s.updatedAt.toISOString(), updatedBy: s.updatedBy?.displayName ?? null,
    source: s.source,
    performance: supplierPerformance(trucks, planFacts, jute.get(code) ?? NO_JUTE),
    references,
  };
}
