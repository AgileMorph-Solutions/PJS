/**
 * Applies the client's APPLICATION VIEW workbook (see src/services/applicationView.ts for exactly what
 * it does and what it refuses to do). Safe to run again: it only fills what is blank.
 *
 *   npx tsx scripts/applyApplicationView.ts
 *
 * `docker compose up` on an empty database runs the same thing from the seed; this is for a database
 * that was seeded before the workbook arrived.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/db.js";
import { applyApplicationView, describeReport, type ApplicationViewSeed } from "../src/services/applicationView.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED = process.env.SEED_DIR ?? path.resolve(here, "../../frontend/src/data/seed");

async function main() {
  const data = JSON.parse(readFileSync(path.join(SEED, "applicationView.json"), "utf8")) as ApplicationViewSeed;
  for (const line of describeReport(await applyApplicationView(data), data)) console.log(line);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
}
