/**
 * Production is the Central (factory) warehouse's work — contract's canAccessProduction() is the rule.
 * policy.ts can only see role + path; this adds the user's warehouse type, which needs one lookup, so
 * it is only paid on /api/production/* requests. Every production route is behind this prefix, so a new
 * one is closed to Unit warehouse users without anyone remembering to close it.
 */
import type { User } from "@prisma/client";
import { canAccessProduction, type Role } from "@anagroci/contract/data/roles";
import { isWarehouseType } from "@anagroci/contract/data/warehouseTypes";
import { prisma } from "../db.js";
import { ForbiddenError } from "../domain/validation.js";
import { siteTypeOf } from "../services/ids.js";

export function isProductionPath(path: string): boolean {
  return path === "/api/production" || path.startsWith("/api/production/");
}

export async function assertProductionAccess(user: User & { role: Role }): Promise<void> {
  if (user.role === "admin") return;
  // A user assigned to a store takes its site's type (the type is set on sites only).
  const siteType = user.warehouse ? await siteTypeOf(prisma, user.warehouse) : null;
  const type = isWarehouseType(siteType) ? siteType : null;
  if (!canAccessProduction(user.role, type)) throw new ForbiddenError("Production is only open to the factory (Central warehouse).");
}
