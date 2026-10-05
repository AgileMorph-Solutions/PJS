/**
 * Moves existing records onto the system IDs — see src/services/renumber.ts for what changes and
 * what is never lost.
 *
 *   npx tsx scripts/renumberIds.ts                 # dry run: writes the old → new CSV, changes nothing
 *   npx tsx scripts/renumberIds.ts --apply         # writes exactly what the dry run listed
 *   npx tsx scripts/renumberIds.ts --out plan.csv  # where the CSV goes (default renumber-plan.csv)
 *
 * Safe to run again: anything already in the system format is left alone, so after an admin sets a
 * code for another warehouse, re-running picks up just that warehouse.
 */
import { writeFileSync } from "node:fs";
import { prisma } from "../src/db.js";
import { applyRenumber, planRenumber, renumberCsv } from "../src/services/renumber.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const outIdx = args.indexOf("--out");
const out = outIdx >= 0 ? args[outIdx + 1]! : "renumber-plan.csv";

async function main() {
  const plan = await planRenumber();
  writeFileSync(out, renumberCsv(plan));

  const byTable = new Map<string, number>();
  for (const c of plan.changes) byTable.set(`${c.table}.${c.column}`, (byTable.get(`${c.table}.${c.column}`) ?? 0) + 1);
  console.log(`${apply ? "Applying" : "Dry run —"} ${plan.changes.length} values to change (full list: ${out})`);
  for (const [k, n] of [...byTable].sort()) console.log(`  ${k.padEnd(40)} ${n}`);
  if (plan.skipped.length) {
    console.log("Left as they are:");
    for (const s of plan.skipped) console.log(`  ${s.table}: ${s.count} — ${s.reason} (e.g. ${s.sample.slice(0, 3).join(", ")})`);
  }

  if (!apply) {
    console.log("Nothing was written. Re-run with --apply to write these changes.");
    return;
  }
  const result = await applyRenumber(plan);
  console.log(`Done: ${result.receipts} receipts renumbered, ${result.values} lot/voyage values updated.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
