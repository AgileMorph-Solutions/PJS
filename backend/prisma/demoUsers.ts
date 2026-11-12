/**
 * Demo accounts for trying the app out (docker compose turns this on; see docker-compose.yml): an admin, plus one
 * Warehouse Incharge, Branch Manager and QFS Officer for every STORE of a finished site in the Warehouses master (users
 * work at a store, see services/users.ts) — so a store an admin adds in Masters gets its own demo accounts on the next
 * start, and there is no fixed list here. Opt-in via SEED_DEMO_USERS=true and it needs DEMO_PASSWORD — there is no password in this file, and nothing
 * runs without both, so a deployment that doesn't set them gets no demo accounts.
 *
 * Usernames are `<role>.<store slug>` (incharge.bke-001). Existing usernames are left untouched (never reset a password
 * someone changed). Only stores of finished sites (a type and an ID code) get accounts, since a user can only be
 * assigned to one of those.
 * Deliberately no supplier assignment for the Branch Manager: which suppliers they cover is the Warehouse Incharge's
 * job in the app, not something to invent here.
 */
import type { PrismaClient } from "@prisma/client";
import { ROLE_LABEL, type Role } from "@anagroci/contract/data/roles";
import { warehouseSlug } from "@anagroci/contract/domain/siteType";
import { hashPassword } from "../src/auth/password.js";

export interface DemoUser { username: string; displayName: string; role: Role; warehouse: string | null }

const PER_STORE: { prefix: string; role: Role }[] = [
  { prefix: "incharge", role: "warehouse_incharge" },
  { prefix: "manager", role: "branch_manager" },
  { prefix: "qfs", role: "qfs_officer" },
];

/** The demo accounts for these store names: pure, so it can be tested without a database. */
export function demoUsersFor(storeNames: string[]): DemoUser[] {
  return [
    { username: "admin", displayName: "Administrator", role: "admin", warehouse: null },
    ...storeNames.flatMap((store) => PER_STORE.map(({ prefix, role }) => ({
      username: `${prefix}.${warehouseSlug(store)}`,
      displayName: `${ROLE_LABEL[role]}, ${store}`,
      role,
      warehouse: store,
    }))),
  ];
}

export async function ensureDemoUsers(prisma: PrismaClient, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const password = env.DEMO_PASSWORD;
  if (env.SEED_DEMO_USERS !== "true" || !password) return [];

  // Finished warehouses only (contract's isUsableSite): a category (Unit/Central) and an ID code.
  const warehouses = await prisma.warehouse.findMany({
    where: { site: null, type: { not: null }, code: { not: null } }, select: { name: true }, orderBy: { name: "asc" },
  });
  const created: string[] = [];
  for (const u of demoUsersFor(warehouses.map((w) => w.name))) {
    if (await prisma.user.findUnique({ where: { username: u.username } })) continue;
    await prisma.user.create({ data: { ...u, passwordHash: hashPassword(password) } });
    created.push(u.username);
  }
  return created;
}
