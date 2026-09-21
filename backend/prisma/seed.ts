// Loads the same real, client-derived seed data the frontend uses
// (frontend/src/data/seed/*.json — 50 real RCN receipts sampled from Rcn Offloading Details
// 2026.xlsx, real suppliers/warehouses/origins, real drying-job history) so the backend opens
// with the same real history instead of an empty demo. Nothing here is fabricated — if you need
// to regenerate the source JSON, see ../../frontend/tools/extract-seed.py.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.join(here, "..", "..", "frontend", "src", "data", "seed");

function loadJSON<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(seedDir, name), "utf-8")) as T;
}

interface SeedReceipt {
  id: string;
  source: "imported" | "entered";
  arrivalDate: string;
  supplierName: string;
  lbaCode: string;
  vehicleNo: string;
  warehouse: string;
  origin?: string;
  lotNo?: string;
  binNo?: string;
  stageData: Record<string, Record<string, string>>;
  branches: Record<string, string>;
  timeline: { status: string; at: string; note?: string | null }[];
}

interface SeedDryingJob {
  id: string;
  date: string;
  warehouse: string;
  bin: string;
  lotNo: string;
  ficheNo: string;
  status: string;
  dryType: string;
  destination: string;
}

async function main() {
  // Idempotent on purpose: this runs on every container start (see backend/Dockerfile), and the
  // createMany calls below aren't safe to run twice against a non-empty table on SQLite (no
  // skipDuplicates support — see the note further down).
  const already = await prisma.receipt.count();
  if (already > 0) {
    console.log(`Database already has ${already} receipts — skipping seed.`);
    return;
  }

  const suppliers = loadJSON<{ code: string; name: string }[]>("suppliers.json");
  const warehouses = loadJSON<string[]>("warehouses.json");
  const bins = loadJSON<string[]>("bins.json");
  const origins = loadJSON<string[]>("origins.json");
  const receipts = loadJSON<SeedReceipt[]>("receipts.json");
  const dryingJobs = loadJSON<SeedDryingJob[]>("dryingJobs.json");

  // Note: SQLite's Prisma driver doesn't support `skipDuplicates` on createMany (a Postgres/MySQL
  // feature) — fine here since this script assumes a freshly migrated, empty database.
  console.log(`Seeding ${suppliers.length} suppliers, ${warehouses.length} warehouses, ${bins.length} bins, ${origins.length} origins...`);
  await prisma.supplier.createMany({ data: suppliers });
  await prisma.warehouse.createMany({ data: warehouses.map((name) => ({ name })) });
  await prisma.bin.createMany({ data: bins.map((code) => ({ code })) });
  await prisma.origin.createMany({ data: origins.map((name) => ({ name })) });

  console.log(`Seeding ${receipts.length} real RCN receipts...`);
  for (const r of receipts) {
    await prisma.receipt.create({
      data: {
        id: r.id,
        source: r.source,
        arrivalDate: r.arrivalDate,
        supplierName: r.supplierName,
        lbaCode: r.lbaCode,
        vehicleNo: r.vehicleNo,
        warehouse: r.warehouse,
        origin: r.origin || null,
        // "" and null both mean "not assigned yet" in the seed JSON, but lotNo is @unique —
        // multiple empty strings collide under a SQL unique constraint the way multiple NULLs
        // don't, so normalize "" to null here rather than relaxing the constraint.
        lotNo: r.lotNo || null,
        binNo: r.binNo || null,
        stageData: JSON.stringify(r.stageData ?? {}),
        branches: JSON.stringify(r.branches ?? {}),
        timeline: { create: (r.timeline ?? []).map((t) => ({ status: t.status, at: t.at, note: t.note ?? null })) },
      },
    });
  }

  console.log(`Seeding ${dryingJobs.length} real drying jobs...`);
  await prisma.dryingJob.createMany({ data: dryingJobs });

  // Jute ledger entries are intentionally NOT seeded here — the frontend's own
  // loadSeedLedgerEntries() starts every ledger empty too (the "real" data for the
  // warehouse-stock ledger lives as static `sampleRows` in frontend/src/data/juteBags.ts, not as
  // seed entries). Matching that on purpose, not an oversight.

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
