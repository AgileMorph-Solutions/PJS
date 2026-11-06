/**
 * TEST trucks at YAKRO FACTORY, taken all the way through procurement (quality pass → weighing → bin → GRN with price →
 * "no drying" → "stays at this warehouse"),
 * until the bins hold about 4,100 t: one full batch inside the monthly guide, so Production › New batch can be tried
 * end to end. For a dev database only — the team starts from an empty database (prisma/seed.ts), and these are
 * invented, so they are never run on startup.
 *
 * Everything is labelled as test data so it can't pass for a real truck: supplier "TEST SUPPLIER n", LBA "TEST-nn",
 * vehicle "TEST-TRUCK-nn", a REMARKS note, and bins BIN-T01..T06 in the ANAGROCI-01 store (source "test-seed").
 * It writes through the receipt service, not raw SQL, so the Lot is issued, the weights are calculated and the record
 * locks exactly as when a truck is entered in the app. Safe to re-run: a truck whose vehicle number exists is skipped.
 *
 *   npx tsx scripts/seedBatchTestReceipts.ts          # show what would be created
 *   npx tsx scripts/seedBatchTestReceipts.ts --apply  # create it
 */
import { prisma } from "../src/db.js";
import { createReceipt, setBranch, setStageFields } from "../src/services/receipts.js";
import { GRN_QUANTITY_LABEL } from "@anagroci/contract/domain/receiptStatus";

const apply = process.argv.includes("--apply");

const WAREHOUSE = "YAKRO FACTORY";
const STORE = "ANAGROCI-01";
const NOTE = "TEST DATA for trying batch creation (scripts/seedBatchTestReceipts.ts) — not a real truck";

interface Truck { n: number; date: string; bin: string; loaded: number; tare: number; bags: number; price: string }

// Net = gross − 1 kg per bag (contract domain/receiptMath.ts); the GRN weight is typed, and here it is the net.
const netOf = (t: Truck) => t.loaded - t.tare - t.bags;

/** Enough stock for one full batch: inside the client's monthly guide of 3,700–4,500 t (contract domain/productionBatch.ts). */
const TARGET_KG = 4_100_000;

// The first five were the original hand-written set; kept as they were so a re-run on a database that has them adds only the rest.
const FIRST: Truck[] = [
  { n: 1, date: "2026-10-20", bin: "BIN-T01", loaded: 52_400, tare: 14_200, bags: 480, price: "470" },
  { n: 2, date: "2026-10-21", bin: "BIN-T01", loaded: 48_900, tare: 13_800, bags: 440, price: "475" },
  { n: 3, date: "2026-10-22", bin: "BIN-T02", loaded: 55_000, tare: 14_500, bags: 505, price: "470" },
  { n: 4, date: "2026-10-23", bin: "BIN-T02", loaded: 46_300, tare: 13_900, bags: 400, price: "480" },
  { n: 5, date: "2026-10-24", bin: "BIN-T03", loaded: 50_800, tare: 14_100, bags: 460, price: "470" },
];

// Uneven on purpose, so the bins differ in size and the suggested batch name (the largest bin) means something.
const BIN_CYCLE = ["BIN-T01", "BIN-T01", "BIN-T01", "BIN-T02", "BIN-T02", "BIN-T03", "BIN-T04", "BIN-T05", "BIN-T06"];

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Deterministic (no randomness), so every run plans the same trucks and re-runs skip what already exists. */
function buildTrucks(): Truck[] {
  const trucks = [...FIRST];
  let total = trucks.reduce((s, t) => s + netOf(t), 0);
  for (let n = 6; total < TARGET_KG; n++) {
    const loaded = 47_000 + ((n * 1_373) % 9_000);
    const tare = 13_500 + ((n * 397) % 1_100);
    const t: Truck = {
      n,
      date: addDays("2026-08-01", Math.floor((n - 6) * 0.7)), // Aug–Oct 2026, about 1–2 trucks a day
      bin: BIN_CYCLE[(n - 6) % BIN_CYCLE.length]!,
      loaded, tare,
      bags: Math.round((loaded - tare) / 80),
      price: String(465 + ((n * 7) % 4) * 5),
    };
    trucks.push(t);
    total += netOf(t);
  }
  return trucks;
}

const TRUCKS = buildTrucks();
const pad = (n: number) => String(n).padStart(2, "0");

/** No drying, stays at the factory: the answers that make a Lot ready for production (contract domain/productionBatch.ts). */
const READY_ANSWER: Record<string, string> = { "n-drying": "none", "n-xferdec": "production" };

async function answerDecisions(id: string, stageIds: string[]) {
  for (const stageId of stageIds) await setBranch(id, stageId, READY_ANSWER[stageId]!);
}

async function main() {
  if (!(await prisma.warehouse.findFirst({ where: { name: STORE, site: WAREHOUSE } }))) {
    throw new Error(`Store ${STORE} under ${WAREHOUSE} doesn't exist — add it in Masters › Warehouses first.`);
  }

  for (const code of [...new Set(TRUCKS.map((t) => t.bin))]) {
    if (await prisma.bin.findUnique({ where: { code } })) continue;
    console.log(`${apply ? "Creating" : "Would create"} bin ${code} in ${STORE}`);
    if (apply) await prisma.bin.create({ data: { code, warehouseName: STORE, source: "test-seed", createdAt: new Date() } });
  }

  for (const t of TRUCKS) {
    const vehicle = `TEST-TRUCK-${pad(t.n)}`;
    const existing = await prisma.receipt.findFirst({ where: { vehicleNo: vehicle }, include: { branches: true } });
    if (existing) {
      // Trucks made before the strict rule have no drying/transfer answer and would drop out of their bins: answer them.
      const answered = new Set(existing.branches.map((b) => b.stageId));
      const missing = ["n-drying", "n-xferdec"].filter((s) => !answered.has(s));
      console.log(`${vehicle} already exists — ${missing.length ? `${apply ? "answering" : "would answer"} ${missing.join(", ")}` : "skipped"}`);
      if (apply) await answerDecisions(existing.id, missing);
      continue;
    }
    console.log(`${apply ? "Creating" : "Would create"} ${vehicle}: ${t.date}, ${netOf(t).toLocaleString("en")} kg into ${t.bin} @ ${t.price} XOF/kg`);
    if (!apply) continue;

    const { id } = await createReceipt(WAREHOUSE, t.date);
    await setStageFields(id, "n-gate", { "DATE OF ARRIVAL": t.date, "VEHICLE NO.": vehicle, REMARKS: NOTE });
    const supplier = ((t.n - 1) % 8) + 1;
    await setStageFields(id, "n-verify", { "SUPPLIERS NAME": `TEST SUPPLIER ${supplier}`, "LBA CODE": `TEST-${pad(supplier)}` });
    await setStageFields(id, "n-gross", { "Loaded truck weight (kg)": String(t.loaded), "Tare / empty truck weight (kg)": String(t.tare) });
    await setStageFields(id, "n-qfs", { "MOIS. (moisture)": "8" });
    const passed = await setBranch(id, "n-qfs", "pass");
    await setStageFields(id, "n-unload", {
      "DATE OF OFFLOADING": t.date, "BON SACS (good bags)": String(t.bags), "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "0", Refraction: "0",
    });
    await setStageFields(id, "n-bin", { "Bin Number": t.bin });
    await setStageFields(id, "n-grn", { [GRN_QUANTITY_LABEL]: String(netOf(t)), PRICE: t.price });
    await answerDecisions(id, ["n-drying", "n-xferdec"]);
    console.log(`  → ${id}, ${passed.lotNo}`);
  }
  const perBin = new Map<string, number>();
  for (const t of TRUCKS) perBin.set(t.bin, (perBin.get(t.bin) ?? 0) + netOf(t));
  console.log(`\n${TRUCKS.length} trucks, ${(TRUCKS.reduce((s, t) => s + netOf(t), 0) / 1000).toFixed(1)} t in all:`);
  for (const [bin, kg] of perBin) console.log(`  ${bin}: ${(kg / 1000).toFixed(1)} t`);
  if (!apply) console.log("\nNothing written. Re-run with --apply to create it.");
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
