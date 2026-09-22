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

async function main() {
  if ((await prisma.receipt.count()) > 0) {
    console.log("Database already seeded — skipping.");
    return;
  }

  const suppliers = read<{ code: string; name: string }[]>("suppliers.json", []);
  const warehouses = read<string[]>("warehouses.json", []);
  const bins = read<string[]>("bins.json", []);
  const origins = read<string[]>("origins.json", []);
  const receipts = read<SeedReceipt[]>("receipts.json", []);
  const dryingJobs = read<Record<string, string>[]>("dryingJobs.json", []);
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
  receipts.forEach((r) => add(whNames, r.warehouse, "Rcn Offloading Details 2026.xlsx"));
  jute.warehouseStock.forEach((r) => add(whNames, r.whLocation, "BOUAKE WAREHOUSE JUTE BAGS MOVEMENT REPORT.xlsx"));
  jute.warehouseTransfers.forEach((r) => add(whNames, r.sourceWarehouse, "BOUAKE RCN RECEIVING at Yamoussoukro.xlsx"));
  // NOTE: dryingJobs.warehouse ("ANAGROCI-01") is deliberately NOT added as a warehouse — it is an
  // alias for an existing one, recorded below with its provenance so the client can confirm it.

  const originNames = new Map<string, string>();
  origins.forEach((o) => add(originNames, o, "seed/origins.json"));
  receipts.forEach((r) => add(originNames, r.origin, "Rcn Offloading Details 2026.xlsx"));
  jute.warehouseTransfers.forEach((r) => add(originNames, r.origin, "BOUAKE RCN RECEIVING at Yamoussoukro.xlsx"));

  const binCodes = new Map<string, string>();
  bins.forEach((b) => add(binCodes, b, "seed/bins.json"));
  receipts.forEach((r) => add(binCodes, r.binNo, "Rcn Offloading Details 2026.xlsx"));
  dryingJobs.forEach((d) => add(binCodes, d.bin, "Drying Report_Factory warehouse.xlsx"));
  jute.warehouseTransfers.forEach((r) => add(binCodes, r.binNo, "BOUAKE RCN RECEIVING at Yamoussoukro.xlsx"));

  const supplierCodes = new Map<string, string>(suppliers.map((s) => [s.code, "seed/suppliers.json"]));
  jute.warehouseStock.forEach((r) => add(supplierCodes, r.supplierCode, "BOUAKE WAREHOUSE JUTE BAGS MOVEMENT REPORT.xlsx"));

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

  // An inference, not a client statement — flagged for confirmation by /api/data-quality.
  const yakro = [...whNames.keys()].find((w) => /YAKRO/i.test(w));
  if (yakro && dryingJobs.some((d) => d.warehouse === "ANAGROCI-01")) {
    await prisma.warehouseAlias.createMany({
      data: [{
        alias: "ANAGROCI-01", warehouseName: yakro,
        source: "Drying Report_Factory warehouse.xlsx (sheet FINAL DRY RCN-YAKRO-2026)",
        provenance: "inferred",
      }],
      skipDuplicates: true,
    });
  }

  // ── Receipts + their stage rows ─────────────────────────────────────────
  for (const r of receipts) {
    await prisma.$transaction(async (tx) => {
      await tx.receipt.create({
        data: {
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
          timeline: { create: r.timeline.map((t) => ({ status: t.status, at: t.at, note: t.note ?? null })) },
          branches: { create: Object.entries(r.branches).map(([stageId, branchId]) => ({ stageId, branchId })) },
          // Presence is recorded for every stage the source touched — including stages whose
          // fields are all blank, which is a real state that drives derived status.
          stageEntries: { create: Object.keys(r.stageData).map((stageId) => ({ stageId })) },
        },
      });

      for (const [stageId, fields] of Object.entries(r.stageData)) {
        const spec = STAGE_FIELD_MAP[stageId];
        if (!spec) {
          console.warn(`  ! ${r.id}: unknown stage "${stageId}" in seed data — skipped`);
          continue;
        }
        const data = toColumnPayload(stageId, fields);
        const model = (tx as any)[STAGE_MODEL_DELEGATE[stageId]];
        if (spec.cardinality === "many") await model.create({ data: { receiptId: r.id, seq: 1, ...data } });
        else await model.create({ data: { receiptId: r.id, ...data } });
      }
    });
  }

  await prisma.dryingJob.createMany({ data: dryingJobs as any, skipDuplicates: true });

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

  const counts = {
    suppliers: await prisma.supplier.count(), warehouses: await prisma.warehouse.count(),
    bins: await prisma.bin.count(), origins: await prisma.origin.count(),
    receipts: await prisma.receipt.count(), stageEntries: await prisma.stageEntry.count(),
    dryingJobs: await prisma.dryingJob.count(),
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
