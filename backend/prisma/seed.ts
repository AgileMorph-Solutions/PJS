/**
 * Startup setup, run before the server on every start (see backend/Dockerfile*): the two sites and the user accounts
 * that sign in to them, nothing else.
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
 * Site/Store typology, upserted rather than created-if-missing so re-running always converges:
 * BOUAKE and YAKRO FACTORY are the two known SITES (kind set); ANAGROCI-01 is a STORE under
 * YAKRO FACTORY, and YAMOUSSOUKRO is a third name the client's own sheets use for that same site.
 *
 * Evidence: ANAGROCI DATA PROCUREMENT 2026.xlsx, sheet "Warehouse Receiving", places
 * `warehouse = ANAGROCI-01` peer to `warehouse = BKE-001/002/003` in the same column, with
 * `warehouse site = YAMOUSSOUKRO` on those same rows — materially stronger than the filename-only
 * inference this alias used to carry (`provenance: "inferred"`, matched by
 * `/YAKRO/i.test(warehouseName)` against whatever the drying report happened to be named).
 * `warehouse_alias_inferred` (domain/dataQuality/checks.ts) reports 0 once this has run; the alias
 * row itself is kept, never deleted — it's the provenance trail, and its `provenance` field is what
 * changed, not its existence.
 */
async function backfillWarehouseTypology() {
  const source = "ANAGROCI DATA PROCUREMENT 2026.xlsx (sheet Warehouse Receiving)";

  await prisma.warehouse.upsert({
    where: { name: "BOUAKE" },
    update: { kind: "REGIONAL_CENTRAL" },
    create: { name: "BOUAKE", kind: "REGIONAL_CENTRAL", source: "seed/warehouses.json" },
  });
  await prisma.warehouse.upsert({
    where: { name: "YAKRO FACTORY" },
    update: { kind: "FACTORY" },
    create: { name: "YAKRO FACTORY", kind: "FACTORY", source: "seed/warehouses.json" },
  });
  // Depends on YAKRO FACTORY existing (site is a soft FK to it) — the two upserts above must run first.
  await prisma.warehouse.upsert({
    where: { name: "ANAGROCI-01" },
    update: { site: "YAKRO FACTORY" },
    create: { name: "ANAGROCI-01", site: "YAKRO FACTORY", source },
  });
  await prisma.warehouseAlias.upsert({
    where: { alias: "ANAGROCI-01" },
    update: { warehouseName: "YAKRO FACTORY", provenance: "stated-in-source", source },
    create: { alias: "ANAGROCI-01", warehouseName: "YAKRO FACTORY", provenance: "stated-in-source", source },
  });
  await prisma.warehouseAlias.upsert({
    where: { alias: "YAMOUSSOUKRO" },
    update: { warehouseName: "YAKRO FACTORY", provenance: "stated-in-source", source },
    create: { alias: "YAMOUSSOUKRO", warehouseName: "YAKRO FACTORY", provenance: "stated-in-source", source },
  });

  // Unit/Central app tier (Warehouse.type). Only fills a NULL: an admin can reassign a type in
  // Masters, and re-running the seed must not silently undo that.
  await prisma.warehouse.updateMany({ where: { name: "BOUAKE", type: null }, data: { type: "UNIT" } });
  await prisma.warehouse.updateMany({ where: { name: "YAKRO FACTORY", type: null }, data: { type: "CENTRAL" } });

  // The two warehouse codes the client has given — BKE and YAK, as printed in their APPLICATION VIEW
  // workbook (REC-BKE-2026-0001, LOT-YAK-2026-0002). The same values the warehouse_codes migration
  // sets on an existing database; on a fresh one the warehouses don't exist yet when it runs. Only
  // fills a NULL, like the type above. Every other warehouse gets its code from an admin, never from here.
  await prisma.warehouse.updateMany({ where: { name: "BOUAKE", code: null }, data: { code: "BKE" } });
  await prisma.warehouse.updateMany({ where: { name: "YAKRO FACTORY", code: null }, data: { code: "YAK" } });
}

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
  // Sites first: every non-admin user belongs to one (User.warehouse is a foreign key to it).
  await backfillWarehouseTypology();
  await ensureBootstrapAdmin();
  const demo = await ensureDemoUsers(prisma);
  if (demo.length) console.log(`Created demo users: ${demo.join(", ")}.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
