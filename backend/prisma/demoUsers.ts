/**
 * One demo account per role per site, for trying the app out (docker compose turns this on; see
 * docker-compose.yml). Opt-in via SEED_DEMO_USERS=true and it needs DEMO_PASSWORD — there is no
 * password in this file, and nothing runs without both, so a deployment that doesn't set them gets
 * no demo accounts.
 *
 * Existing usernames are left untouched (never reset a password someone changed). Non-admin users
 * go on a typed site — BOUAKE (UNIT) or YAKRO FACTORY (CENTRAL), both typed by the typology
 * backfill — since a user can only be assigned to a typed site. Deliberately no supplier assignment for the Branch Manager: which suppliers they
 * cover is the Warehouse Incharge's job in the app, not something to invent here.
 */
import type { PrismaClient } from "@prisma/client";
import type { Role } from "@anagroci/contract/data/roles";
import { hashPassword } from "../src/auth/password.js";

export const DEMO_USERS: { username: string; displayName: string; role: Role; warehouse: string | null }[] = [
  { username: "admin", displayName: "Demo Admin", role: "admin", warehouse: null },
  { username: "incharge.bouake", displayName: "Demo Warehouse Incharge (Bouaké)", role: "warehouse_incharge", warehouse: "BOUAKE" },
  { username: "manager.bouake", displayName: "Demo Branch Manager (Bouaké)", role: "branch_manager", warehouse: "BOUAKE" },
  { username: "qfs.bouake", displayName: "Demo QFS Officer (Bouaké)", role: "qfs_officer", warehouse: "BOUAKE" },
  { username: "incharge.yakro", displayName: "Demo Warehouse Incharge (Yakro Factory)", role: "warehouse_incharge", warehouse: "YAKRO FACTORY" },
  { username: "manager.yakro", displayName: "Demo Branch Manager (Yakro Factory)", role: "branch_manager", warehouse: "YAKRO FACTORY" },
  { username: "qfs.yakro", displayName: "Demo QFS Officer (Yakro Factory)", role: "qfs_officer", warehouse: "YAKRO FACTORY" },
];

export async function ensureDemoUsers(prisma: PrismaClient, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const password = env.DEMO_PASSWORD;
  if (env.SEED_DEMO_USERS !== "true" || !password) return [];

  const created: string[] = [];
  for (const u of DEMO_USERS) {
    if (await prisma.user.findUnique({ where: { username: u.username } })) continue;
    await prisma.user.create({ data: { ...u, passwordHash: hashPassword(password) } });
    created.push(u.username);
  }
  return created;
}
