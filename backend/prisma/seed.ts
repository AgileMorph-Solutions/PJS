/**
 * Loads the real client data into Postgres.
 *
 * Two rules from ground rule §4 shape everything here:
 *
 *  1. NOTHING IS FABRICATED. Masters are seeded as the union of every value actually observed in
 *     the workbooks, annotated with where it came from — not a curated whitelist. A row whose bin
 *     or origin isn't in the master is still imported; the orphan is reported, not dropped, and no
 *     mapping is invented to make it fit.
 *
 *  2. NOTHING IS QUIETLY FIXED. The seeder writes through the service layer with
 *     bypassValidation, because the real data breaks the rules the API enforces — six receipts are
 *     rejected with no reason, and no receipt has a Lot Number at all (the source sheet has no Lot
 *     column). Importing them through the validating path would mean dropping real trucks or
 *     inventing values. They are imported as they are and surfaced by /api/data-quality.
 *
 * Idempotent: bails if receipts already exist.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient, Prisma } from "@prisma/client";
import { STAGE_FIELD_MAP } from "@anagroci/contract/generated/stageFieldMap";
import { toColumnPayload, STAGE_MODEL_DELEGATE } from "../src/stageStore.js";
import { hashPassword } from "../src/auth/password.js";
import { ensureDemoUsers } from "./demoUsers.js";
import { seedDemoData } from "./demoData.js";
import { applyRenumber, planRenumber } from "../src/services/renumber.js";

const prisma = new PrismaClient();
const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = join(HERE, "..", "..", "frontend", "src", "data", "seed");

const read = <T>(f: string, fallback: T): T => {
  const p = join(SEED, f);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : fallback;
};

interface SeedReceipt {
  id: string; source: string; arrivalDate: string; supplierName: string; lbaCode: string;
  vehicleNo: string; warehouse: string; origin?: string; lotNo?: string; binNo?: string;
  stageData: Record<string, Record<string, string>>;
  branches: Record<string, string>;
  timeline: { status: string; at: string; note?: string | null }[];
}
interface JuteSeed {
  warehouseStock: Record<string, any>[];
  warehouseTransfers: Record<string, any>[];
  tallySnapshots: { ledgerId: string; label: string; value: number; source: string; sheet: string | null; capturedAt: string | null }[];
}

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

  // The one warehouse code the client has given (Oct 2026: "REC-BKE01-2027-001") — the same value
  // the system_ids migration sets on an existing database; on a fresh one BOUAKE doesn't exist yet
  // when that migration runs. Only fills a NULL, like the type above. Every other warehouse gets
  // its code from an admin, never from here.
  await prisma.warehouse.updateMany({ where: { name: "BOUAKE", code: null }, data: { code: "BKE01" } });
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

/**
 * Backfills destinationWarehouse/destinationProvenance onto the 367 JuteWarehouseTransferReceipt
 * rows imported before the transfer_destination migration existed. Same reasoning as
 * backfillWarehouseTypology: a real, header-asserted fact about already-imported data, not a fresh
 * workbook observation, so it runs unconditionally rather than being gated by the seed-data bail.
 */
async function backfillTransferDestination() {
  await prisma.juteWarehouseTransferReceipt.updateMany({
    where: { destinationWarehouse: null },
    data: { destinationWarehouse: "YAKRO FACTORY", destinationProvenance: "inferred" },
  });
}

async function main() {
  // Runs every time, even on an already-seeded database — this is foundational Site/Store
  // typology (Village/Regional/Factory), not data observed from a workbook, so it doesn't belong
  // behind the "receipts already exist" bail below. Upserts throughout, so re-running is a no-op
  // once applied.
  await backfillWarehouseTypology();
  await backfillTransferDestination();
  await ensureBootstrapAdmin();
  const demo = await ensureDemoUsers(prisma);
  if (demo.length) console.log(`Created demo users: ${demo.join(", ")}.`);

  // SEED_MODE=demo swaps the client's real workbooks for a small invented set (see demoData.ts);
  // unset, nothing here changes.
  if (process.env.SEED_MODE === "demo") {
    await seedDemoData(prisma);
    return;
  }

  if ((await prisma.receipt.count()) > 0) {
    console.log("Database already seeded — skipping.");
    return;
  }

  const suppliers = read<{ code: string; name: string }[]>("suppliers.json", []);
  const warehouses = read<string[]>("warehouses.json", []);
  const bins = read<string[]>("bins.json", []);
  const origins = read<string[]>("origins.json", []);
  const receipts = read<SeedReceipt[]>("receipts.json", []);
  const jute = read<JuteSeed>("juteLedgers.json", { warehouseStock: [], warehouseTransfers: [], tallySnapshots: [] });

  // ── Masters: the observed union, with provenance ────────────────────────
  // Collect every value anything actually references, so hard FKs can't fail on real data and no
  // real row has to be discarded to make the schema happy.
  const whNames = new Map<string, string>();
  const add = (m: Map<string, string>, v: string | null | undefined, src: string) => {
    const k = (v ?? "").trim();
    if (k && !m.has(k)) m.set(k, src);
  };
  warehouses.forEach((w) => add(whNames, w, "seed/warehouses.json"));
  receipts.forEach((r) => add(whNames, r.warehouse, "ANAGROCI DATA PROCUREMENT 2026.xlsx (sheet Truck Reception)"));
  jute.warehouseStock.forEach((r) => add(whNames, r.whLocation, "ANAGROCI DATA PROCUREMENT 2026.xlsx (sheet Jute Bags movement)"));
  jute.warehouseTransfers.forEach((r) => add(whNames, r.sourceWarehouse, "Bouake RCN Receiving at Factory Report.xlsx"));
  // NOTE: ANAGROCI-01 (a store name real drying-history data uses) is deliberately NOT added as a
  // bare warehouse — it is an alias for an existing one, recorded below with its provenance so the
  // client can confirm it.

  const originNames = new Map<string, string>();
  origins.forEach((o) => add(originNames, o, "seed/origins.json"));
  receipts.forEach((r) => add(originNames, r.origin, "ANAGROCI DATA PROCUREMENT 2026.xlsx (sheet Truck Reception)"));
  jute.warehouseTransfers.forEach((r) => add(originNames, r.origin, "Bouake RCN Receiving at Factory Report.xlsx"));

  const binCodes = new Map<string, string>();
  bins.forEach((b) => add(binCodes, b, "seed/bins.json"));
  receipts.forEach((r) => add(binCodes, r.binNo, "ANAGROCI DATA PROCUREMENT 2026.xlsx (sheet Truck Reception)"));
  jute.warehouseTransfers.forEach((r) => add(binCodes, r.binNo, "Bouake RCN Receiving at Factory Report.xlsx"));

  const supplierCodes = new Map<string, string>(suppliers.map((s) => [s.code, "seed/suppliers.json"]));
  jute.warehouseStock.forEach((r) => add(supplierCodes, r.supplierCode, "ANAGROCI DATA PROCUREMENT 2026.xlsx (sheet Jute Bags movement)"));

  await prisma.supplier.createMany({
    data: [...supplierCodes].map(([code, source]) => ({
      code, name: suppliers.find((s) => s.code === code)?.name ?? code, source,
    })),
    skipDuplicates: true,
  });
  await prisma.warehouse.createMany({
    data: [...whNames].map(([name, source]) => ({ name, source })), skipDuplicates: true,
  });
  await prisma.origin.createMany({
    data: [...originNames].map(([name, source]) => ({ name, source })), skipDuplicates: true,
  });
  // warehouseName stays null: no workbook maps a bin to a warehouse, and the two bin namespaces
  // (BKE-00x at Bouaké, BIN-0xx at Yakro) belong to different sites. Inventing the mapping is
  // exactly what ground rule §4 forbids.
  await prisma.bin.createMany({
    data: [...binCodes].map(([code, source]) => ({ code, warehouseName: null, source })), skipDuplicates: true,
  });

  // The ANAGROCI-01 -> YAKRO FACTORY alias (and the YAMOUSSOUKRO one) is created by
  // backfillWarehouseTypology() above, unconditionally and with real evidence — this used to be a
  // filename-only inference gated on `dryingJobs.some(d => d.warehouse === "ANAGROCI-01")`, kept
  // here only as a historical note so the old reasoning isn't lost, not as code.

  // ── Receipts + their stage rows — batched, not one transaction per receipt ─────────────────
  // At 986 receipts (was 50), one $transaction per receipt with up to 16 sequential per-stage
  // creates inside it meant several thousand sequential round trips. This groups every table's
  // rows across ALL receipts first (plain JS, no DB calls yet), then issues one createMany per
  // table, all inside a SINGLE outer transaction — so a mid-run failure can't leave a half-seeded
  // database that the "receipts already exist" bail above would then treat as fully seeded.
  const timelineRows: { receiptId: string; status: string; at: string; note: string | null }[] = [];
  const branchRows: { receiptId: string; stageId: string; branchId: string }[] = [];
  const stageEntryRows: { receiptId: string; stageId: string }[] = [];
  // One bucket per stage model, built once and filled while walking every receipt exactly once.
  const stageRowsByModel = new Map<string, { data: Record<string, unknown> }[]>();

  for (const r of receipts) {
    for (const t of r.timeline) timelineRows.push({ receiptId: r.id, status: t.status, at: t.at, note: t.note ?? null });
    for (const [stageId, branchId] of Object.entries(r.branches)) branchRows.push({ receiptId: r.id, stageId, branchId });
    for (const stageId of Object.keys(r.stageData)) stageEntryRows.push({ receiptId: r.id, stageId });

    for (const [stageId, fields] of Object.entries(r.stageData)) {
      const spec = STAGE_FIELD_MAP[stageId];
      if (!spec) {
        console.warn(`  ! ${r.id}: unknown stage "${stageId}" in seed data — skipped`);
        continue;
      }
      const data = toColumnPayload(stageId, fields);
      const delegate = STAGE_MODEL_DELEGATE[stageId];
      if (!stageRowsByModel.has(delegate)) stageRowsByModel.set(delegate, []);
      const row = spec.cardinality === "many"
        ? { receiptId: r.id, seq: 1, ...data }
        : { receiptId: r.id, ...data };
      stageRowsByModel.get(delegate)!.push({ data: row });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.receipt.createMany({
      data: receipts.map((r) => ({
        id: r.id,
        source: r.source,
        arrivalDate: r.arrivalDate,
        supplierName: r.supplierName,
        lbaCode: r.lbaCode,
        vehicleNo: r.vehicleNo,
        warehouse: r.warehouse,
        origin: r.origin?.trim() || null,
        // The pre-normalization JSON, kept read-only for one release so the round-trip tests
        // have a live oracle and there is a rollback path. Dropped in the Phase 8 migration.
        stageDataShadow: JSON.stringify(r.stageData),
      })),
    });
    await tx.timelineEntry.createMany({ data: timelineRows });
    if (branchRows.length) await tx.receiptBranch.createMany({ data: branchRows });
    await tx.stageEntry.createMany({ data: stageEntryRows });
    for (const [delegate, rows] of stageRowsByModel) {
      await (tx as any)[delegate].createMany({ data: rows.map((r) => r.data) });
    }
  }, { timeout: 30_000 });
  // ~20 bulk createMany calls at 986-receipt scale — generous headroom over Prisma's 5s default,
  // which was sized for the old one-transaction-per-receipt shape.

  // ── Jute ledgers ────────────────────────────────────────────────────────
  // Ledgers 2 and 3 get no rows: their only source is an undated hand tally, so rows would mean
  // inventing dates and transaction ids. The real figures go in as labelled snapshots instead.
  if (jute.warehouseStock.length) {
    await prisma.juteWarehouseMovement.createMany({
      data: jute.warehouseStock.map((r) => ({
        seq: r.seq, sn: r.sn, sheetRow: r.sheetRow,
        movementDate: r.movementDate ? new Date(r.movementDate) : null,
        rawDate: r.rawDate,
        activitiesType: r.activitiesType ?? "",
        activityCategory: categorise(r.activitiesType),
        supplierCode: supplierCodes.has((r.supplierCode ?? "").trim()) ? r.supplierCode : null,
        whLocation: r.whLocation,
        truckNumber: r.truckNumber, wrNo: r.wrNo,
        bagsIssued: r.bagsIssued, bagsReceived: r.bagsReceived,
        reportedBalance: r.reportedBalance,
      })),
      skipDuplicates: true,
    });
  }
  if (jute.warehouseTransfers.length) {
    await prisma.juteWarehouseTransferReceipt.createMany({
      data: jute.warehouseTransfers.map((r) => ({
        sn: r.sn,
        receivedDate: r.receivedDate ? new Date(r.receivedDate) : null,
        rawDate: r.rawDate, month: r.month, dryUndry: r.dryUndry, idTransfer: r.idTransfer,
        truckRegistration: r.truckRegistration, lotNo: r.lotNo, lotDry: r.lotDry,
        noFiche: r.noFiche, ccaFicheNumber: r.ccaFicheNumber, binNo: r.binNo,
        damagedBags: r.damagedBags, newBagsUsed: r.newBagsUsed, recondition: r.recondition,
        sourceWarehouse: r.sourceWarehouse,
        // Every row this sheet has ever produced arrives at Yakro — asserted only by column
        // headers, never a cell (see the model's own comment) — so it's a fixed value here, same
        // as commitJuteWarehouseTransfer sets for a fresh upload.
        destinationWarehouse: "YAKRO FACTORY", destinationProvenance: "inferred",
        origin: r.origin,
        bagsDispatched: r.bagsDispatched, bagsReceived: r.bagsReceived,
        reportedDifference: r.reportedDifference,
        finalBagsAfterRebagging: r.finalBagsAfterRebagging,
        reportedDiff: r.reportedDiff,
        laissePasserEntree: r.laissePasserEntree,
        fullyLoadedTruckWeight: r.fullyLoadedTruckWeight,
        emptyTruckTareWeight: r.emptyTruckTareWeight,
        grossWeightReceived: r.grossWeightReceived,
        netWeightAtArrival: r.netWeightAtArrival,
        netWeightDispatched: r.netWeightDispatched,
        weightDifference: r.weightDifference,
        korReceived: dec(r.korReceived), korReceivedRaw: r.korReceivedRaw,
        korDispatched: dec(r.korDispatched), korDispatchedRaw: r.korDispatchedRaw,
        moistureReceived: dec(r.moistureReceived), moistureReceivedRaw: r.moistureReceivedRaw,
        moistureDispatched: dec(r.moistureDispatched), moistureDispatchedRaw: r.moistureDispatchedRaw,
        ncArrival: r.ncArrival, comment: r.comment,
      })),
      skipDuplicates: true,
    });
  }
  if (jute.tallySnapshots.length) {
    await prisma.juteTallySnapshot.createMany({
      data: jute.tallySnapshots.map((t) => ({
        ledgerId: t.ledgerId, label: t.label, value: t.value,
        source: t.source, sheet: t.sheet, capturedAt: null,
      })),
      skipDuplicates: true,
    });
  }

  // The source data carries the old REC-2026-NNNN ids and bare lot numbers; a fresh database ends up
  // with exactly the system IDs an existing one gets from scripts/renumberIds.ts.
  const renumbered = await applyRenumber(await planRenumber());
  console.log(`Renumbered onto system IDs: ${renumbered.receipts} receipts, ${renumbered.values} lot/voyage values.`);

  const counts = {
    suppliers: await prisma.supplier.count(), warehouses: await prisma.warehouse.count(),
    bins: await prisma.bin.count(), origins: await prisma.origin.count(),
    receipts: await prisma.receipt.count(), stageEntries: await prisma.stageEntry.count(),
    juteWarehouse: await prisma.juteWarehouseMovement.count(),
    juteTransfers: await prisma.juteWarehouseTransferReceipt.count(),
    tallySnapshots: await prisma.juteTallySnapshot.count(),
  };
  console.log("Seeded:", counts);
}

/** Our reading of the overloaded ACTIVITIES TYPE column. The raw value is kept untouched. */
function categorise(v: string | null | undefined): string | null {
  const s = (v ?? "").toUpperCase();
  if (!s) return null;
  if (s.includes("TRANSFF") || s.includes("TRANSFER")) return "TRANSFER_OUT";
  if (s.includes("PURCHAS") || s.includes("UNLOADING")) return "PURCHASE";
  if (s.includes("REBAGGING")) return "REBAGGING";
  return "SUPPLIER_ISSUE";
}

const dec = (v: number | null | undefined) =>
  v === null || v === undefined ? null : new Prisma.Decimal(v);

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
