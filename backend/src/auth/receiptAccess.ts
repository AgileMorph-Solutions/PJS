/**
 * Branch Managers only see receipts for their assigned suppliers (Supplier.code is the LBA code).
 * A receipt with no LBA code yet has no supplier to attribute it to, so it stays visible — a BM
 * has to be able to open a freshly gated truck to submit the very fields that name its supplier.
 */
import type { User } from "@prisma/client";
import type { ReceiptRecord } from "@anagroci/contract/types/receipt";
import { prisma } from "../db.js";
import { ForbiddenError } from "../domain/validation.js";

export async function assignedSupplierCodes(userId: string): Promise<Set<string>> {
  const rows = await prisma.branchManagerSupplier.findMany({ where: { userId }, select: { supplierCode: true } });
  return new Set(rows.map((r) => r.supplierCode));
}

export function receiptVisibleToSuppliers(r: Pick<ReceiptRecord, "lbaCode">, codes: Set<string>): boolean {
  return !r.lbaCode || codes.has(r.lbaCode);
}

export async function filterReceiptsForUser<T extends Pick<ReceiptRecord, "lbaCode">>(user: User, rows: T[]): Promise<T[]> {
  if (user.role !== "branch_manager") return rows;
  const codes = await assignedSupplierCodes(user.id);
  return rows.filter((r) => receiptVisibleToSuppliers(r, codes));
}

export async function assertReceiptVisible(user: User, r: Pick<ReceiptRecord, "lbaCode">): Promise<void> {
  if (user.role !== "branch_manager") return;
  if (!receiptVisibleToSuppliers(r, await assignedSupplierCodes(user.id))) {
    throw new ForbiddenError("That receipt is for a supplier that isn't assigned to you.");
  }
}
