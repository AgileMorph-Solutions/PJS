/**
 * Warehouse scoping for the caller. This wraps resolveSite() rather than replacing it, so the
 * "site -> stores + aliases" expansion stays in exactly one place (domain/site.ts).
 *
 * Admin may ask for any warehouse (or none = everything). Everyone else is pinned to their own
 * warehouse: omitting ?warehouse= means "mine", naming another one is a 403, never a silent
 * fallback to their own data. A user assigned to a store may name either that store or its site
 * (the app's sections are per site, so its pages send the site name); either way the answer is
 * narrowed to what domain/site.ts's resolveScope gives them, never the sibling stores.
 */
import type { FastifyRequest } from "fastify";
import { resolveScope, resolveSite } from "../domain/site.js";
import { ForbiddenError } from "../domain/validation.js";
import { currentSite, currentUser } from "./plugin.js";

/** The warehouse name this request is scoped to (the user's own store, or site), or undefined for an unscoped admin.
 * Writes file under this name, so a store-bound user's receipt, jute row or ledger entry lands at their store. */
export function scopedWarehouse(req: FastifyRequest, requested?: string): string | undefined {
  const user = currentUser(req);
  if (user.role === "admin") return requested || undefined;
  if (!user.warehouse) throw new ForbiddenError("Your account isn't assigned to a warehouse yet.");
  if (requested && requested !== user.warehouse && requested !== currentSite(req)) throw new ForbiddenError("That warehouse isn't yours.");
  return user.warehouse;
}

/** Drop-in for `warehouse ? await resolveSite(warehouse) : undefined` in every site-scoped route: the names whose
 * rows this request may read. An admin naming a site gets the whole site; a user gets resolveScope's answer. */
export async function scopedSite(req: FastifyRequest, requested?: string): Promise<string[] | undefined> {
  const wh = scopedWarehouse(req, requested);
  if (!wh) return undefined;
  return currentUser(req).role === "admin" ? resolveSite(wh) : resolveScope(wh);
}

/**
 * Receipt.warehouse can hold a store code or alias as well as the site name (see resolveSite), so
 * "is this receipt mine" is membership in my site's expanded name list, not string equality.
 */
export async function assertWarehouseAccess(req: FastifyRequest, receiptWarehouse: string): Promise<void> {
  const user = currentUser(req);
  if (user.role === "admin") return;
  const mine = user.warehouse ? await resolveScope(user.warehouse) : [];
  if (!mine.includes(receiptWarehouse)) throw new ForbiddenError("That record belongs to another warehouse.");
}
