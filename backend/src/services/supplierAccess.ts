/**
 * Supplier assignment (Warehouse Incharge -> Branch Manager) and supplier requests
 * (Branch Manager -> Warehouse Incharge). Supplier.code is the LBA code; the master itself is still
 * written only through addSupplier (services/masters.ts), so there is one way a supplier comes to
 * exist.
 */
import type { User } from "@prisma/client";
import { prisma } from "../db.js";
import { ForbiddenError, ValidationError } from "../domain/validation.js";
import { addSupplier } from "./masters.js";
import { resolveSite } from "../domain/site.js";

/** A Warehouse Incharge manages only their own warehouse's Branch Managers; admin manages any. */
async function assertManagesBranchManager(actor: User, bmId: string) {
  const bm = await prisma.user.findUnique({ where: { id: bmId } });
  if (!bm || bm.role !== "branch_manager") throw new ValidationError("That user isn't a Branch Manager.");
  if (actor.role !== "admin" && bm.warehouse !== actor.warehouse) {
    throw new ForbiddenError("That Branch Manager belongs to another warehouse.");
  }
  return bm;
}

export async function listBranchManagers(actor: User) {
  const rows = await prisma.user.findMany({
    where: { role: "branch_manager", warehouse: actor.role === "admin" ? undefined : actor.warehouse },
    include: { suppliers: { select: { supplierCode: true } } },
    orderBy: { username: "asc" },
  });
  return rows.map((u) => ({
    id: u.id, username: u.username, displayName: u.displayName, warehouse: u.warehouse, active: u.active,
    supplierCodes: u.suppliers.map((s) => s.supplierCode).sort(),
  }));
}

/** Replace the Branch Manager's whole assignment set — the UI edits a checklist, not single links. */
export async function setBranchManagerSuppliers(actor: User, bmId: string, codes: string[]) {
  await assertManagesBranchManager(actor, bmId);
  const unique = [...new Set(codes)];
  const known = await prisma.supplier.findMany({ where: { code: { in: unique } }, select: { code: true } });
  const missing = unique.filter((c) => !known.some((k) => k.code === c));
  if (missing.length) throw new ValidationError(`Unknown supplier code(s): ${missing.join(", ")}.`);

  await prisma.$transaction([
    prisma.branchManagerSupplier.deleteMany({ where: { userId: bmId, supplierCode: { notIn: unique } } }),
    ...unique.map((supplierCode) =>
      prisma.branchManagerSupplier.upsert({
        where: { userId_supplierCode: { userId: bmId, supplierCode } },
        update: {},
        create: { userId: bmId, supplierCode, assignedById: actor.id },
      })
    ),
  ]);
}

export async function mySuppliers(user: User) {
  const rows = await prisma.branchManagerSupplier.findMany({ where: { userId: user.id }, select: { supplierCode: true } });
  return prisma.supplier.findMany({ where: { code: { in: rows.map((r) => r.supplierCode) } }, orderBy: { code: "asc" } });
}

export async function requestSupplier(user: User, name: string | undefined, code: string | undefined) {
  if (!name?.trim()) throw new ValidationError("Supplier name is required.");
  return prisma.supplierRequest.create({
    data: { requestedById: user.id, name: name.trim(), code: code?.trim() || null },
  });
}

/** BM: own requests. Warehouse Incharge/admin: requests from Branch Managers in their scope. */
export async function listSupplierRequests(user: User, status?: string) {
  const site = user.role === "branch_manager" ? undefined : user.role === "admin" || !user.warehouse ? undefined : await resolveSite(user.warehouse);
  const rows = await prisma.supplierRequest.findMany({
    where: {
      status,
      requestedById: user.role === "branch_manager" ? user.id : undefined,
      requestedBy: site ? { warehouse: { in: site } } : undefined,
    },
    include: { requestedBy: { select: { displayName: true, warehouse: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id, name: r.name, code: r.code, status: r.status, reason: r.reason,
    requestedBy: r.requestedBy.displayName, warehouse: r.requestedBy.warehouse, createdAt: r.createdAt.toISOString(),
  }));
}

async function loadPendingRequest(actor: User, id: string) {
  const req = await prisma.supplierRequest.findUnique({ where: { id }, include: { requestedBy: true } });
  if (!req) throw Object.assign(new Error("Request not found"), { code: "P2025" });
  if (req.status !== "pending") throw new ValidationError(`This request was already ${req.status}.`);
  await assertManagesBranchManager(actor, req.requestedById);
  return req;
}

/** Approving adds the supplier to the master (idempotent upsert) and assigns it to the requester. */
export async function approveSupplierRequest(actor: User, id: string, code: string | undefined) {
  const req = await loadPendingRequest(actor, id);
  const finalCode = (code ?? req.code)?.trim();
  if (!finalCode) throw new ValidationError("A supplier (LBA) code is required to approve.");

  await addSupplier(finalCode, req.name);
  await prisma.$transaction([
    prisma.branchManagerSupplier.upsert({
      where: { userId_supplierCode: { userId: req.requestedById, supplierCode: finalCode } },
      update: {},
      create: { userId: req.requestedById, supplierCode: finalCode, assignedById: actor.id },
    }),
    prisma.supplierRequest.update({
      where: { id },
      data: { status: "approved", code: finalCode, reviewedById: actor.id, reviewedAt: new Date() },
    }),
  ]);
}

export async function rejectSupplierRequest(actor: User, id: string, reason: string | undefined) {
  if (!reason?.trim()) throw new ValidationError("A reason is required to reject a request.");
  await loadPendingRequest(actor, id);
  await prisma.supplierRequest.update({
    where: { id },
    data: { status: "rejected", reason: reason.trim(), reviewedById: actor.id, reviewedAt: new Date() },
  });
}
