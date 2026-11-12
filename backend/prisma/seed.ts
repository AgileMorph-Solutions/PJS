/**
 * Startup setup, run before the server on every start (see backend/Dockerfile*): the first admin and (opt-in) demo
 * accounts, nothing else. No warehouse is created here: every site and store is added by an admin in Masters ›
 * Warehouses, and the app has no fixed list of them (it used to seed BOUAKE and YAKRO FACTORY; databases that already
 * have them keep them — they are master rows like any other now).
 *
 * It used to also load the client's workbooks (and, with SEED_MODE=demo, an invented demo set) whenever the database
 * had no receipts. The team chose to start from an empty database (Oct 2026), so every record — trucks, plans,
 * ledgers, production, and the Supplier/Origin/Bin masters — is now entered in the app. Nothing here may refill them.
 *
 * Idempotent: upserts and only-if-missing creates throughout, so re-running on every start is a no-op once applied.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/auth/password.js";
import { ensureDemoUsers } from "./demoUsers.js";

const prisma = new PrismaClient();

/**
 * Creates the first admin from ADMIN_USERNAME / ADMIN_PASSWORD, only while no admin exists — so a
 * fresh database (docker compose up) is usable, and re-running never resets a changed password.
 * Without both variables nothing is created: there is deliberately no default password.
 */
async function ensureBootstrapAdmin() {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return;
  if (await prisma.user.count({ where: { role: "admin" } })) return;
  await prisma.user.create({
    data: { username, displayName: username, role: "admin", passwordHash: hashPassword(password) },
  });
  console.log(`Created bootstrap admin "${username}".`);
}

async function main() {
  await ensureBootstrapAdmin();
  const demo = await ensureDemoUsers(prisma);
  if (demo.length) console.log(`Created demo users: ${demo.join(", ")}.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
