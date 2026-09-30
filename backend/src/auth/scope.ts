/**
 * Warehouse scoping for the caller. This wraps resolveSite() rather than replacing it, so the
 * "site -> stores + aliases" expansion stays in exactly one place (domain/site.ts).
 *
 * Admin may ask for any warehouse (or none = everything). Everyone else is pinned to their own
 * warehouse: omitting ?warehouse= means "mine", naming another one is a 403, never a silent
 * fallback to their own data.
 */
import type { FastifyRequest } from "fastify";
import { resolveSite } from "../domain/site.js";
import { ForbiddenError } from "../domain/validation.js";
import { currentUser } from "./plugin.js";

/** The canonical warehouse name this request is scoped to, or undefined for an unscoped admin. */
export function scopedWarehouse(req: FastifyRequest, requested?: string): string | undefined {
  const user = currentUser(req);
  if (user.role === "admin") return requested || undefined;
  if (!user.warehouse) throw new ForbiddenError("Your account isn't assigned to a warehouse yet.");
  if (requested && requested !== user.warehouse) throw new ForbiddenError("That warehouse isn't yours.");
  return user.warehouse;
}

/** Drop-in for `warehouse ? await resolveSite(warehouse) : undefined` in every site-scoped route. */
export async function scopedSite(req: FastifyRequest, requested?: string): Promise<string[] | undefined> {
  const wh = scopedWarehouse(req, requested);
  return wh ? resolveSite(wh) : undefined;
}

/**
 * Receipt.warehouse can hold a store code or alias as well as the site name (see resolveSite), so
 * "is this receipt mine" is membership in my site's expanded name list, not string equality.
 */
export async function assertWarehouseAccess(req: FastifyRequest, receiptWarehouse: string): Promise<void> {
  const user = currentUser(req);
  if (user.role === "admin") return;
  const mine = user.warehouse ? await resolveSite(user.warehouse) : [];
  if (!mine.includes(receiptWarehouse)) throw new ForbiddenError("That record belongs to another warehouse.");
}
