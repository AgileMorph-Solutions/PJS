/**
 * Users: creation, listing, updates. Scope rules live here so the route stays thin:
 *  - admin is unscoped (no warehouse);
 *  - every other role needs a warehouse that is a SITE row with a `type` set — a user pinned to an
 *    untyped or store-level row would have no section to land in.
 */
import { isRole, type Role } from "@anagroci/contract/data/roles";
import type { UserView } from "@anagroci/contract/types/user";
import type { WarehouseType } from "@anagroci/contract/data/warehouseTypes";
import { prisma } from "../db.js";
import { hashPassword } from "../auth/password.js";
import { ValidationError } from "../domain/validation.js";

async function toView(u: { id: string; username: string; displayName: string; role: string; warehouse: string | null; active: boolean }): Promise<UserView> {
  const wh = u.warehouse ? await prisma.warehouse.findUnique({ where: { name: u.warehouse }, select: { type: true } }) : null;
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role as Role, warehouse: u.warehouse, warehouseType: (wh?.type as WarehouseType | null | undefined) ?? null, active: u.active };
}

async function assertAssignableWarehouse(role: Role, warehouse: string | null | undefined) {
  if (role === "admin") return;
  if (!warehouse) throw new ValidationError("Assign this user to a warehouse.");
  const wh = await prisma.warehouse.findUnique({ where: { name: warehouse } });
  if (!wh || wh.site !== null) throw new ValidationError(`"${warehouse}" isn't a warehouse site.`);
  if (!wh.type) throw new ValidationError(`"${warehouse}" has no Unit/Central type yet — set one in Masters first.`);
}

export async function listUsers(): Promise<UserView[]> {
  const rows = await prisma.user.findMany({ orderBy: [{ role: "asc" }, { username: "asc" }] });
  return Promise.all(rows.map(toView));
}

export async function getUserView(id: string): Promise<UserView | null> {
  const u = await prisma.user.findUnique({ where: { id } });
  return u ? toView(u) : null;
}

export interface NewUser { username: string; password: string; displayName?: string; role: string; warehouse?: string | null }

export async function createUser(input: NewUser): Promise<UserView> {
  const username = input.username?.trim();
  if (!username) throw new ValidationError("username is required.");
  if (!input.password || input.password.length < 8) throw new ValidationError("Password must be at least 8 characters.");
  if (!isRole(input.role)) throw new ValidationError(`Unknown role "${input.role}".`);
  const warehouse = input.role === "admin" ? null : input.warehouse ?? null;
  await assertAssignableWarehouse(input.role, warehouse);
  const u = await prisma.user.create({
    data: { username, passwordHash: hashPassword(input.password), displayName: input.displayName?.trim() || username, role: input.role, warehouse },
  });
  return toView(u);
}

export interface UserPatch { displayName?: string; role?: string; warehouse?: string | null; active?: boolean; password?: string }

export async function updateUser(id: string, patch: UserPatch): Promise<UserView> {
  const current = await prisma.user.findUnique({ where: { id } });
  if (!current) throw Object.assign(new Error("User not found"), { code: "P2025" });
  const role = patch.role ?? current.role;
  if (!isRole(role)) throw new ValidationError(`Unknown role "${role}".`);
  const warehouse = role === "admin" ? null : patch.warehouse !== undefined ? patch.warehouse : current.warehouse;
  await assertAssignableWarehouse(role, warehouse);
  if (patch.password !== undefined && patch.password.length < 8) throw new ValidationError("Password must be at least 8 characters.");

  const u = await prisma.user.update({
    where: { id },
    data: {
      role, warehouse,
      displayName: patch.displayName?.trim() || undefined,
      active: patch.active,
      passwordHash: patch.password ? hashPassword(patch.password) : undefined,
    },
  });
  // A deactivated account or a changed password/role must not keep working through an old cookie.
  if (patch.active === false || patch.password || patch.role) await prisma.session.deleteMany({ where: { userId: id } });
  return toView(u);
}
