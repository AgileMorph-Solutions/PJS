/**
 * Clears the test data typed into Procurement while the app was being built, so Procurement shows only the client's
 * own workbook data (ANAGROCI DATA PROCUREMENT 2026.xlsx, the APPLICATION VIEW workbook, the receiving report).
 *
 * The line it draws: a row that came from a workbook import stays; a row typed in the app goes. Users stay, and
 * Production is not touched (its batches are left to that module, even where they name a test Bin).
 *
 *   - Trucks entered in the app (Receipt.source = "entered") — "test-2", LBA "123", net −137 kg, half-filled forms.
 *   - Real (imported) trucks that testing edited — a KOR of 40.04 changed to 0.62, a price of 10, Lots issued, a
 *     transfer started. Each is rebuilt from the extracted workbook row (receipts.json) under its own id, and the
 *     APPLICATION VIEW workbook is then applied again, which only fills blanks — so it ends exactly as it was imported.
 *   - Everything procurement has that no workbook import ever filled, so every row of it was typed: transfers (BKT),
 *     drying batches, activity ledger rows, other activities, jute supplier movements, supplier requests.
 *   - Jute warehouse movements typed in the app (no sheet row) and the vendor / empty-bag / opening-balance records
 *     hanging off them. The 298 imported movements and the receiving report stay.
 *   - Delivery plans that aren't the APPLICATION VIEW's ten.
 *   - Masters typed in the app that nothing real uses any more: the "test-…" suppliers, origin "AYMAAN", the
 *     "TEST" warehouse, and app-made Bins no real truck or production batch names.
 *   - The audit log's procurement entries: every one was written by testing (the log starts on 19 Nov, after the
 *     import), and much of it by the automated tests run against this database.
 *
 * Nothing real is fabricated or "fixed": the imported trucks keep their own gaps (no Lot, missing net weight) and
 * their own oddities, which /api/data-quality reports.
 *
 * For the DEV / demo database. On a database where people have entered real trucks, don't run it — "entered" would
 * take those too. Dry run first: it lists everything it would change.
 *
 *   SEED_DIR=/path/to/frontend/src/data/seed npx tsx scripts/removeTestData.ts          # show what would change
 *   SEED_DIR=/path/to/frontend/src/data/seed npx tsx scripts/removeTestData.ts --apply  # do it, in one transaction
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Prisma } from "@prisma/client";
import { STAGE_FIELD_MAP } from "@anagroci/contract/generated/stageFieldMap";
import { prisma } from "../src/db.js";
import { STAGE_MODEL_DELEGATE, toColumnPayload } from "../src/stageStore.js";
import { applyApplicationView, describeReport, type ApplicationViewSeed } from "../src/services/applicationView.js";

type Tx = Prisma.TransactionClient;

const apply = process.argv.includes("--apply");
const here = path.dirname(fileURLToPath(import.meta.url));
const SEED = process.env.SEED_DIR ?? path.resolve(here, "../../frontend/src/data/seed");
const readSeed = <T>(f: string) => JSON.parse(readFileSync(path.join(SEED, f), "utf8")) as T;

interface SeedReceipt {
  id: string; source: string; arrivalDate: string; supplierName: string; lbaCode: string; vehicleNo: string;
  warehouse: string; origin?: string; stageData: Record<string, Record<string, string>>;
  branches: Record<string, string>; timeline: { status: string; at: string; note?: string | null }[];
}

/** Audit-log entities that belong to Procurement. Production's and User's entries are left alone. */
const PROCUREMENT_ENTITIES = [
  "Receipt", "ReceiptBranch", "DeliveryPlan", "TransferRequest", "TransferRequestLine", "DryingBatch", "FicheDocument",
  "Supplier", "SupplierRequest", "BranchManagerSupplier", "Bin", "Origin", "Warehouse", "WarehouseActivityLedgerEntry",
  "WarehouseDischarge", "JuteWarehouseMovement", "JuteWarehouseTransferReceipt", "JuteVendorReceipt",
  "JuteEmptyBagReceipt", "JuteOpeningBalance", "JuteSupplierMovement",
];

/** Imported trucks that testing changed, by any route: a field, a branch, a Lot, a submission, a transfer line… */
async function touchedImportedReceipts(db: Tx | typeof prisma): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    with imp as (select id from "Receipt" where source = 'imported')
    select "receiptId" as id from "StageFieldChange" where "receiptId" in (select id from imp)
    union select "receiptId" from "FormSubmission" where "receiptId" in (select id from imp)
    union select "receiptId" from "OtherActivity" where "receiptId" in (select id from imp)
    union select "receiptId" from "ActivityLedgerEntry" where "receiptId" in (select id from imp)
    union select "receiptId" from "FicheDocument" where "receiptId" in (select id from imp)
    union select "receiptId" from "TransferRequestLine" where "receiptId" in (select id from imp)
    union select "receiptId" from "StageLotAssignment" where "receiptId" in (select id from imp) and coalesce("lotNumber", '') <> ''
    union select "receiptId" from "StageStockUpdate" where "receiptId" in (select id from imp)
    union select "receiptId" from "StageDryingDecision" where "receiptId" in (select id from imp)
    union select "receiptId" from "StageTransferDecision" where "receiptId" in (select id from imp)
    -- The import only ever wrote "fail" branches (the rejected trucks); any other was chosen in the app.
    union select "receiptId" from "ReceiptBranch" where "receiptId" in (select id from imp) and "branchId" <> 'fail'
    union select id from "Receipt" where source = 'imported' and "lockedAt" is not null
    order by 1`;
  return rows.map((r) => r.id);
}

/** Recreates one imported truck exactly as the seeder first wrote it (same id, legacy id and creation time). */
async function rebuildReceipt(tx: Tx, id: string, legacyId: string, createdAt: Date, r: SeedReceipt) {
  await tx.receipt.delete({ where: { id } });
  await tx.receipt.create({
    data: {
      id, legacyId, createdAt, source: r.source, arrivalDate: r.arrivalDate, supplierName: r.supplierName,
      lbaCode: r.lbaCode, vehicleNo: r.vehicleNo, warehouse: r.warehouse, origin: r.origin?.trim() || null,
      stageDataShadow: JSON.stringify(r.stageData),
    },
  });
  for (const t of r.timeline) await tx.timelineEntry.create({ data: { receiptId: id, status: t.status, at: t.at, note: t.note ?? null } });
  for (const [stageId, branchId] of Object.entries(r.branches)) await tx.receiptBranch.create({ data: { receiptId: id, stageId, branchId } });
  for (const [stageId, fields] of Object.entries(r.stageData)) {
    await tx.stageEntry.create({ data: { receiptId: id, stageId } });
    const row = { receiptId: id, ...(STAGE_FIELD_MAP[stageId]!.cardinality === "many" ? { seq: 1 } : {}), ...toColumnPayload(stageId, fields) };
    await (tx as any)[STAGE_MODEL_DELEGATE[stageId]!].create({ data: row });
  }
}

async function plan(db: Tx | typeof prisma, viewPlanIds: string[]) {
  const testReceipts = (await db.receipt.findMany({ where: { source: "entered" }, select: { id: true }, orderBy: { id: "asc" } })).map((r) => r.id);
  const touched = await touchedImportedReceipts(db);
  const appMovements = (await db.juteWarehouseMovement.findMany({ where: { sheetRow: null }, select: { id: true } })).map((m) => m.id);
  const plans = (await db.deliveryPlan.findMany({ where: { id: { notIn: viewPlanIds } }, select: { id: true } })).map((p) => p.id);
  return { testReceipts, touched, appMovements, plans };
}

/** Masters typed in the app (no workbook source) that nothing left in the database names. Run after the deletes. */
async function unusedTestMasters(db: Tx | typeof prisma) {
  const suppliers = await db.$queryRaw<{ code: string; name: string }[]>`
    select code, name from "Supplier" s where s.source is null
      and not exists (select 1 from "Receipt" r where r."lbaCode" = s.code)
      and not exists (select 1 from "DeliveryPlan" p where p."supplierCode" = s.code)
      and not exists (select 1 from "JuteWarehouseMovement" m where m."supplierCode" = s.code)`;
  const origins = await db.$queryRaw<{ name: string }[]>`
    select name from "Origin" o where o.source = 'entered' and not exists (select 1 from "Receipt" r where r.origin = o.name)`;
  const bins = await db.$queryRaw<{ code: string }[]>`
    select code from "Bin" b where b.source = 'entered'
      and not exists (select 1 from "ProductionBatchBin" pb where pb."binCode" = b.code)
      and not exists (select 1 from "StageBinAllocation" a where a."binNumber" = b.code)`;
  const warehouses = await db.$queryRaw<{ name: string }[]>`
    select name from "Warehouse" w where w.source is null and w.type is null and w.site is null
      and not exists (select 1 from "Warehouse" c where c.site = w.name)
      and not exists (select 1 from "User" u where u.warehouse = w.name)
      and not exists (select 1 from "Receipt" r where r.warehouse = w.name)
      and not exists (select 1 from "ProductionBatch" p where p.warehouse = w.name)
      and not exists (select 1 from "Bin" b where b."warehouseName" = w.name)`;
  return { suppliers, origins, bins, warehouses };
}

async function main() {
  const receiptsJson = readSeed<SeedReceipt[]>("receipts.json");
  const view = readSeed<ApplicationViewSeed>("applicationView.json");
  const byLegacy = new Map(receiptsJson.map((r) => [r.id, r]));
  const viewPlanIds = view.plans.map((p) => p.id);

  const p = await plan(prisma, viewPlanIds);
  const counts = {
    transfers: await prisma.transferRequest.count(),
    dryingBatches: await prisma.dryingBatch.count(),
    whActivityLedger: await prisma.warehouseActivityLedgerEntry.count(),
    juteSupplierMovements: await prisma.juteSupplierMovement.count(),
    supplierRequests: await prisma.supplierRequest.count(),
    procurementAuditRows: await prisma.changeLog.count({ where: { entity: { in: PROCUREMENT_ENTITIES } } }),
  };
  console.log(`Test trucks to delete (${p.testReceipts.length}): ${p.testReceipts.join(", ")}`);
  console.log(`Real trucks to rebuild from the workbook (${p.touched.length}): ${p.touched.join(", ")}`);
  console.log(`App-typed jute movements to delete: ${p.appMovements.length}`);
  console.log(`Delivery plans that aren't the APPLICATION VIEW's: ${p.plans.join(", ") || "none"}`);
  for (const [k, n] of Object.entries(counts)) console.log(`${k}: ${n} (all typed in the app) to delete`);

  if (!apply) {
    console.log("\nDry run — nothing changed. Add --apply to do it.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Children before parents: transfer lines and jute sub-records RESTRICT deletes of what they point at.
    await tx.transferRequestLine.deleteMany({});
    await tx.transferRequest.deleteMany({});
    await tx.dryingBatch.deleteMany({});
    await tx.warehouseActivityLedgerEntry.deleteMany({});
    await tx.juteSupplierMovement.deleteMany({});
    await tx.juteVendorReceipt.deleteMany({ where: { movementId: { in: p.appMovements } } });
    await tx.juteEmptyBagReceipt.deleteMany({ where: { movementId: { in: p.appMovements } } });
    await tx.juteOpeningBalance.deleteMany({ where: { movementId: { in: p.appMovements } } });
    await tx.juteWarehouseMovement.deleteMany({ where: { id: { in: p.appMovements } } });
    await tx.branchManagerSupplier.deleteMany({});
    await tx.supplierRequest.deleteMany({});

    // Stage rows, timeline, branches, submissions, field history and fiche files go with the receipt (cascade).
    await tx.receipt.deleteMany({ where: { id: { in: p.testReceipts } } });

    const current = await tx.receipt.findMany({ where: { id: { in: p.touched } }, select: { id: true, legacyId: true, createdAt: true } });
    for (const r of current) {
      const seed = r.legacyId ? byLegacy.get(r.legacyId) : undefined;
      if (!seed) throw new Error(`${r.id}: no workbook row for legacy id ${r.legacyId} — refusing to guess.`);
      await rebuildReceipt(tx, r.id, r.legacyId!, r.createdAt, seed);
    }

    await tx.deliveryPlan.deleteMany({ where: { id: { in: p.plans } } });

    // The workbook's plan links, rejections, GRN quantities, Bins and approvals, back on the rebuilt trucks.
    // Fill-blanks-only, so the 971 trucks testing never touched come out unchanged.
    const report = await applyApplicationView(view, { db: tx });
    for (const line of describeReport(report, view)) console.log(`  ${line}`);

    const m = await unusedTestMasters(tx);
    await tx.supplier.deleteMany({ where: { code: { in: m.suppliers.map((s) => s.code) } } });
    await tx.origin.deleteMany({ where: { name: { in: m.origins.map((o) => o.name) } } });
    await tx.bin.deleteMany({ where: { code: { in: m.bins.map((b) => b.code) } } });
    await tx.warehouse.deleteMany({ where: { name: { in: m.warehouses.map((w) => w.name) } } });
    console.log(`Masters removed — suppliers: ${m.suppliers.map((s) => `${s.name} (${s.code})`).join(", ") || "none"}; ` +
      `origins: ${m.origins.map((o) => o.name).join(", ") || "none"}; bins: ${m.bins.map((b) => b.code).join(", ") || "none"}; ` +
      `warehouses: ${m.warehouses.map((w) => w.name).join(", ") || "none"}`);

    await tx.changeLog.deleteMany({ where: { entity: { in: PROCUREMENT_ENTITIES } } });

    // Guard: the job is only done if nothing typed is left on a real truck.
    const still = await touchedImportedReceipts(tx);
    if (still.length) throw new Error(`Still carrying app edits after the rebuild: ${still.join(", ")} — rolled back.`);
  }, { timeout: 120_000 });

  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
