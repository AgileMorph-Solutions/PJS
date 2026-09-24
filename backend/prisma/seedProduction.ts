/**
 * Loads the real production data extracted by tools/extract-production.py into Postgres.
 *
 * Separate from prisma/seed.ts on purpose (see the plan's correction #4): seed.ts's idempotency
 * guard is `receipt.count() > 0`, and the real dev DB already has 986 receipts — a production seed
 * block placed inside that guard would never run. This script has its own guard.
 *
 * Same anti-fabrication rules as seed.ts: nothing invented, nothing quietly fixed. The extractor
 * found 697 cases where a BTM's destination Bin disagrees across sheets (e.g. "ANA-02A" in one
 * table, "ANA-3B" in another, for the same BTM number) — real data that breaks the
 * assertOneBinPerBtm rule the live API enforces on NEW writes. Historical rows are written here
 * directly via createMany (bulk, bypassing the validating service layer entirely), exactly the
 * same reason prisma/seed.ts's receipts loop bypasses validation — importing them through the
 * validating path would mean discarding real rows or inventing an answer to which Bin is "right".
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { PRODUCTION_FIELD_MAP } from "@anagroci/contract/generated/productionFieldMap";

const prisma = new PrismaClient();
const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = join(HERE, "..", "..", "frontend", "src", "data", "seed");

const read = <T>(f: string, fallback: T): T => {
  const p = join(SEED, f);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : fallback;
};

interface Headers {
  btmIntakes: { btmNo: string; binNo: string }[];
  lots: { lotNo: string; binNo: string }[];
  bins: string[];
}

async function main() {
  if ((await prisma.btmIntake.count()) > 0) {
    console.log("Production already seeded — skipping.");
    return;
  }

  const data = read<Record<string, Record<string, string>[]>>("productionData.json", {});
  const headers = read<Headers>("productionHeaders.json", { btmIntakes: [], lots: [], bins: [] });

  if (!Object.keys(data).length) {
    console.log("No frontend/src/data/seed/productionData.json found — run tools/extract-production.py first. Skipping.");
    return;
  }

  // ── Headers first: ProductionBin -> BtmIntake -> ProductionLot, same order the hard FKs require ──
  await prisma.productionBin.createMany({
    data: headers.bins.map((binNo) => ({ binNo, source: "tools/extract-production.py" })),
    skipDuplicates: true,
  });
  await prisma.btmIntake.createMany({
    data: headers.btmIntakes.map((b) => ({ ...b, source: "tools/extract-production.py" })),
    skipDuplicates: true,
  });
  await prisma.productionLot.createMany({
    data: headers.lots.map((l) => ({ ...l, source: "tools/extract-production.py" })),
    skipDuplicates: true,
  });

  // ── All 24 tables, bulk createMany per table. Row keys are already real Prisma column names —
  // the extractor writes {col: value} directly from PRODUCTION_FIELD_MAP, so no label->col
  // translation is needed here (unlike the interactive service path, which takes {label: value}
  // from a form and translates via toProductionColumnPayload). ──────────────────────────────────
  const counts: Record<string, number> = {};
  for (const [tableId, spec] of Object.entries(PRODUCTION_FIELD_MAP)) {
    const rows = data[tableId] ?? [];
    if (!rows.length) { counts[tableId] = 0; continue; }
    const delegateName = spec.model.charAt(0).toLowerCase() + spec.model.slice(1);
    const delegate = (prisma as unknown as Record<string, { createMany: (a: unknown) => Promise<{ count: number }> }>)[delegateName];
    const result = await delegate.createMany({ data: rows, skipDuplicates: true });
    counts[tableId] = result.count;
  }

  console.log("Seeded production:", {
    bins: await prisma.productionBin.count(),
    btmIntakes: await prisma.btmIntake.count(),
    lots: await prisma.productionLot.count(),
    ...counts,
  });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
