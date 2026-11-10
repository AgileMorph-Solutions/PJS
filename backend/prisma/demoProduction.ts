/**
 * Demo production data, for trying Production out in the UI — opt-in, kept apart, and removable in one command:
 *
 * Inside the dev stack's backend container, which already has DATABASE_URL:
 *   docker compose exec backend sh -c "cd /app/backend && npm run demo:production"          add it
 *   docker compose exec backend sh -c "cd /app/backend && npm run demo:production:remove"   take every bit of it out
 * Or on the host, once backend/.env exists (copy backend/.env.example; the db is published on localhost:5432):
 *   npm run demo:production -w backend   /   npm run demo:production:remove -w backend
 *
 * Kept apart on purpose (the repo's rule: invented data must never pass for the client's). Everything lives in its own
 * Central warehouse, DEMO FACTORY (code DMO), with its own bins and procurement stock; YAKRO FACTORY and the real
 * records are never touched. An admin picks "DEMO FACTORY" in the factory dropdown on Production to see it.
 *
 * Loaded through the production workbook upload (preview, then apply), so every row passes the same rules as the
 * screens: what the demo shows is what the app would accept. Sized so that every kind of production table has more
 * than one page (10 rows a page):
 *   DEMO-RUN-A    30 loads, all sorted into the silos; 12 Lots at every stage — 4 colour sorted, 4 cooled and ready to
 *                 shell, 4 still cooking. Lot DEM26K01 carries 12 of each check and log, and 12 shelling days.
 *   DEMO-RUN-B    14 loads at every step of Intake; Lot DEM26K13 cooked and cooled.
 *   DEMO-RUN-C    2 loads just recorded.
 *   DEMO-RUN-E…P  12 more runs of one load each, so the runs list pages too.
 *   Plus 13 bins with stock that no run has taken (the "Start a production run" list), 12 shell trucks, 12 boiler readings.
 */
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { createReceipt, setBranch, setStageFields } from "../src/services/receipts.js";
import { commitProductionWorkbook, previewProductionWorkbook } from "../src/services/productionWorkbook.js";
import { TABS } from "../src/domain/productionWorkbook/tabs.js";

const prisma = new PrismaClient();
const SITE = "DEMO FACTORY";
const STORE = "DEMO-STORE-1";
const BIN_COUNT = 30;
const bin = (n: number) => `DEMO-BIN-${String(n).padStart(2, "0")}`;
const BINS = Array.from({ length: BIN_COUNT }, (_, i) => bin(i + 1));
const GRN = "GRN Weight (kept separate from Gross/Net/Paid)";

type Row = Record<string, string | number>;
/** `days` after 1 Oct 2026, as an ISO date. */
const day = (days: number) => new Date(Date.UTC(2026, 9, 1 + days)).toISOString().slice(0, 10);
const LETTERS = "EFGHIJKLMNOP";

// ── The rows, tab by tab, under the workbook's own column words ─────────────────────────────────────────────────────

function demoRows(): Record<string, Row[]> {
  const rows: Record<string, Row[]> = Object.fromEntries(TABS.map((t) => [t.title, []]));
  const add = (tab: string, row: Row) => rows[tab]!.push(row);

  // Runs. A takes bins 01–02, B 03–04, C 05; E…P one bin each (07–18). Bin 06 and 19–30 stay free.
  add("Batches", { "Batch Name": "DEMO-RUN-A", "Start Date": day(5), Bins: `${bin(1)} / ${bin(2)}`, "Proposed By": "Demo data" });
  add("Batches", { "Batch Name": "DEMO-RUN-B", "Start Date": day(31), Bins: `${bin(3)} / ${bin(4)}`, "Proposed By": "Demo data" });
  add("Batches", { "Batch Name": "DEMO-RUN-C", "Start Date": day(39), Bins: bin(5), "Proposed By": "Demo data" });
  [...LETTERS].forEach((l, i) => add("Batches", { "Batch Name": `DEMO-RUN-${l}`, "Start Date": day(10 + i * 2), Bins: bin(7 + i), "Proposed By": "Demo data" }));

  // One load, as far as `upTo` says: each weighed load is 2335 + 2445.4 kg gross, 60 bags, 200 kg of pallets, 2.5 kg of
  // dust → 4,538.9 kg to sort, sorted 3,000 into silo A and 1,538.9 into silo B.
  type Step = "receipt" | "moisture" | "hold" | "pallets" | "final" | "sorted";
  const load = (run: string, btm: number, fromBin: string, date: string, upTo: Step) => {
    const BTM = String(btm);
    add("RCN Receipts", { "Batch Name": run, Date: date, "BTM No": BTM, "Source Bin": fromBin });
    if (upTo === "receipt") return;
    const ok = upTo !== "hold";
    add("Moisture Checks", { "BTM No": BTM, "Moisture (%)": ok ? 9.6 : 12.4, "Nut Count": 176 + (btm % 9), "Sample Weight (g)": 1000, "GK (g)": 228, "Spot (g)": 12, "Immature (g)": 14, Result: ok ? "OK" : "Hold" });
    if (upTo === "moisture" || upTo === "hold") return;
    add("Pallets", { "BTM No": BTM, "Gross Weight (kg)": 2335, "No of Bags": 30, "Factory Bin": "ANA-DEMO" });
    add("Pallets", { "BTM No": BTM, "Gross Weight (kg)": 2445.4, "No of Bags": 30, "Factory Bin": "ANA-DEMO" });
    if (upTo === "pallets") return;
    add("Final Weight", { "BTM No": BTM, "Empty Pallets Weight (kg)": "120 / 80", "No of Pallets": "1 / 1", "Dust (kg)": 2.5 });
    if (upTo === "final") return;
    add("Calibration Runs", { "BTM No": BTM, Date: date, "Size A (24mm)": 3000, "Size B (22mm)": 1538.9 });
  };

  // DEMO-RUN-A: 30 loads over 15 days, all the way into the silos (90,000 kg into silo A).
  for (let i = 0; i < 30; i++) load("DEMO-RUN-A", 1001 + i, i % 2 ? bin(2) : bin(1), day(6 + Math.floor(i / 2)), "sorted");
  // DEMO-RUN-B: 14 loads, every step of Intake represented.
  const stepsB: Step[] = ["sorted", "sorted", "sorted", "sorted", "sorted", "final", "final", "pallets", "pallets", "moisture", "hold", "hold", "receipt", "receipt"];
  stepsB.forEach((step, i) => load("DEMO-RUN-B", 601 + i, i % 2 ? bin(4) : bin(3), day(32 + Math.floor(i / 2)), step));
  // DEMO-RUN-C: two loads just recorded.
  load("DEMO-RUN-C", 701, bin(5), day(39), "receipt");
  load("DEMO-RUN-C", 702, bin(5), day(40), "receipt");
  // DEMO-RUN-E…P: one load each, at different steps.
  const stepsE: Step[] = ["sorted", "final", "pallets", "moisture", "receipt", "hold"];
  [...LETTERS].forEach((l, i) => load(`DEMO-RUN-${l}`, 801 + i, bin(7 + i), day(11 + i * 2), stepsE[i % stepsE.length]!));

  // Silo checks: A is fine; B fails and 100 kg move to BC.
  add("Silo Checks", { "Batch Name": "DEMO-RUN-A", Date: day(21), "Sampling Point": "A", "Sample Qty (gm)": 1000, "A (g)": 1000, Result: "OK" });
  add("Silo Checks", { "Batch Name": "DEMO-RUN-A", Date: day(21), "Sampling Point": "B", "Sample Qty (gm)": 1000, "B (g)": 900, "BC (g)": 100, Result: "Fail" });
  add("Silo Moves", { Date: day(21), "From Silo": "B", "To Silo": "BC", "Kg Moved": 100 });

  // DEMO-RUN-A's 12 Lots of 1,500 kg from silo A: 1–4 all the way through, 5–8 cooled and ready, 9–12 still cooking.
  const lotCode = (n: number) => `DEM26K${String(n).padStart(2, "0")}`;
  for (let n = 1; n <= 12; n++) {
    const L = lotCode(n);
    const cooked = day(21 + n);
    add("Cooking", { "Batch Name": "DEMO-RUN-A", "Lot No": L, Date: cooked, "Size A (24mm)": 1500 });
    add("Cooking Checks", { "Lot No": L, Date: cooked, Size: "A", Result: "OK" });
    if (n > 8) continue;
    add("Cooling", { "Lot No": L, "Cooling Silo": `CS-${(n % 4) + 1}`, "Date In": cooked, "Time In": "12:00" });
    add("Cooling Checks", { "Lot No": L, Date: day(22 + n), "Time of the check": "13:00", "Moisture (%)": 8.8 + (n % 3) / 10, "Temperature (°C)": 29, Result: "OK" });
    if (n > 4) continue;
    // Shelled: Lot 1 over 12 days of 100 kg (its own tables page), the others in one 1,500 kg day.
    const days = n === 1 ? 12 : 1;
    for (let d = 0; d < days; d++) {
      const kg = n === 1 ? 100 : 1500;
      add("Shelling Days", { "Lot No": L, Date: day(23 + n + d), "Input Quantity (Kg's)": kg, "Wholes (kg's)": Math.round(kg * 0.26), "Pieces (kg's)": Math.round(kg * 0.007) });
    }
    const sorted = day(23 + n + days);
    add("Sorter Before", { "Lot No": L, Date: sorted, Stream: "Wholes", "Size group": "A++ to B", Shift: "A", "Sample (g)": 1000, "Wholes (g)": 950, "Brokens (g)": 30, "Shell (g)": 20 });
    add("Sorter After", { "Lot No": L, Date: sorted, Stream: "Wholes", "Size group": "A++ to B", Shift: "A", "Sample (g)": 1000, "Wholes (g)": 990, "Shell (g)": 10, Result: "OK" });
    add("Sorter After", { "Lot No": L, Date: sorted, Stream: "Pieces", "Size group": "A++ to B", Shift: "A", "Sample (g)": 1000, "Brokens (g)": 990, "Shell (g)": 10, Result: "OK" });
  }

  // Lot DEM26K01's records, 12 of each, so every check / log table on it pages.
  const L1 = lotCode(1);
  for (let i = 0; i < 12; i++) {
    const d = day(24 + i);
    const line = ["A1", "A2", "AB", "B1", "B2", "B3", "BC", "C1", "C2", "C3", "D", "DE"][i]!;
    add("Cooker Log", { "Lot No": L1, Date: day(22), Size: "A", Start: `${String(6 + i).padStart(2, "0")}:00`, Stop: `${String(6 + i).padStart(2, "0")}:50`, "Temperature (°C)": 98 + (i % 5), "Pressure (bar)": 2 });
    add("Waste Water", { "Lot No": L1, Date: day(22), "Quantity (kg)": 20 + i, Tank: `T${(i % 3) + 1}` });
    add("Line Runs", { "Lot No": L1, Date: d, Line: line, Size: "A", "Input (kg)": 100, Start: "08:00", End: "10:00", "Uncut (kg)": 2 });
    add("Machine Frequency", { "Lot No": L1, Date: d, Line: line, "Machine no": i + 1, "Grams per minute": 470 + i * 3 });
    add("Machine Samples", { "Lot No": L1, Date: d, Shift: i % 2 ? "B" : "A", Line: line, "Machine no": i + 1, "Sample (g)": 1000, "Wholes (g)": 900 - i, "Pieces (g)": 50 + i, "Shell (g)": 50 });
    add("Uncut Checks", { "Lot No": L1, Date: d, Line: line, "Uncut (kg)": 2, "Repassed?": i % 3 ? "Yes" : "No" });
    add("Shell Samples", { "Lot No": L1, Date: d, "Sampling point": i % 2 ? "Line 2" : "Line 1", "Sample (g)": 1000, "Brokens (g)": 5, "Shell (g)": 995 });
  }
  for (let i = 0; i < 11; i++) {
    add("Cooling Checks", { "Lot No": L1, Date: day(23), "Time of the check": `14:${String(i * 5).padStart(2, "0")}`, "Moisture (%)": 9, "Temperature (°C)": 29, Result: "OK" });
    add("Cooking Checks", { "Lot No": L1, Date: day(22), Size: "A", Remarks: `Check ${i + 2}`, Result: "OK" });
    add("Sorter Before", { "Lot No": L1, Date: day(36), Stream: "Wholes", "Size group": i % 2 ? "BC to E" : "A++ to B", Shift: "B", "Sample (g)": 1000, "Wholes (g)": 945 + i, "Brokens (g)": 35 - i, "Shell (g)": 20 });
  }

  // Lot DEM26K13 (DEMO-RUN-B): cooked and cooled, ready for shelling.
  const L13 = lotCode(13);
  add("Cooking", { "Batch Name": "DEMO-RUN-B", "Lot No": L13, Date: day(38), "Size A (24mm)": 2000, "Size B (22mm)": 500 });
  add("Cooking Checks", { "Lot No": L13, Date: day(38), Size: "A", Result: "OK" });
  add("Cooking Checks", { "Lot No": L13, Date: day(38), Size: "B", Result: "OK" });
  add("Cooling", { "Lot No": L13, "Cooling Silo": "CS-2", "Date In": day(38), "Time In": "10:00" });
  add("Cooling Checks", { "Lot No": L13, Date: day(39), "Time of the check": "11:00", "Moisture (%)": 8.8, "Temperature (°C)": 29, Result: "OK" });

  // By-products: 12 shell trucks out and 12 boiler readings, from the shell the shelling made.
  for (let i = 0; i < 12; i++) {
    add("Boiler", { DATE: day(26 + i), "QTY Consumed (Kg's)": 10 + i, "Running Hours": 8 });
    add("Trucks", { Stream: "Shell", DATE: day(26 + i), "TRUCK NO": `DEMO-T${i + 1}`, "Documents Checked": "Yes", "TARE WEIGHT": 1000, "GROSS WEIGHT": 1010 + i, Vendor: i % 2 ? "Demo buyer B" : "Demo buyer A", "Gate Pass No": `GP-DEMO-${i + 1}` });
  }

  return rows;
}

async function workbook(rows: Record<string, Row[]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const tab of TABS) {
    const labels = tab.fields.map((f) => f.label);
    const ws = wb.addWorksheet(tab.title);
    ws.addRow(labels);
    for (const row of rows[tab.title] ?? []) {
      for (const key of Object.keys(row)) if (!labels.includes(key)) throw new Error(`Demo row on "${tab.title}" has no column "${key}"`);
      ws.addRow(labels.map((l) => row[l] ?? null));
    }
  }
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

// ── Add / remove ────────────────────────────────────────────────────────────────────────────────────────────────────

async function remove() {
  const atLot = { lot: { batch: { warehouse: SITE } } };
  const atLoad = { rcnReceipt: { batch: { warehouse: SITE } } };
  await prisma.lotEntry.deleteMany({ where: atLot });
  await prisma.shellingDay.deleteMany({ where: atLot });
  await prisma.lotCookRun.deleteMany({ where: atLot });
  await prisma.factoryLot.deleteMany({ where: { batch: { warehouse: SITE } } });
  await prisma.truckMovement.deleteMany({ where: { warehouse: SITE } });
  await prisma.boilerReading.deleteMany({ where: { warehouse: SITE } });
  await prisma.manualCalibration.deleteMany({ where: { sizingCheck: { batch: { warehouse: SITE } } } });
  await prisma.sizingCheck.deleteMany({ where: { batch: { warehouse: SITE } } });
  await prisma.rcnCalibrationRun.deleteMany({ where: atLoad });
  await prisma.rcnPallet.deleteMany({ where: atLoad });
  await prisma.rcnEmptyPalletStack.deleteMany({ where: atLoad });
  await prisma.rcnMoistureCheck.deleteMany({ where: atLoad });
  await prisma.rcnReceipt.deleteMany({ where: { batch: { warehouse: SITE } } });
  await prisma.productionBatch.deleteMany({ where: { warehouse: SITE } });
  await prisma.receipt.deleteMany({ where: { warehouse: { in: [SITE, STORE] } } });
  await prisma.bin.deleteMany({ where: { code: { startsWith: "DEMO-BIN-" } } });
  await prisma.warehouse.deleteMany({ where: { name: STORE } });
  await prisma.warehouse.deleteMany({ where: { name: SITE } });
}

/** A finished procurement truck in `inBin`: quality passed, GRN recorded, no drying, ready for production. */
async function stockedLot(inBin: string, kg: string, date: string, supplier: string) {
  const r = await createReceipt(SITE, date);
  await setStageFields(r.id, "n-verify", { "SUPPLIERS NAME": supplier }, { bypassValidation: true });
  await setBranch(r.id, "n-qfs", "pass");
  await setStageFields(r.id, "n-bin", { "Bin Number": inBin }, { bypassValidation: true });
  await setStageFields(r.id, "n-grn", { [GRN]: kg, PRICE: "470" }, { bypassValidation: true });
  await setBranch(r.id, "n-drying", "none");
  await setBranch(r.id, "n-xferdec", "production");
}

async function add() {
  if (await prisma.warehouse.findUnique({ where: { name: SITE } })) {
    throw new Error(`${SITE} already exists. Run the remove command first (see the top of prisma/demoProduction.ts) to start it again.`);
  }
  const admin = await prisma.user.findFirst({ where: { role: "admin", active: true }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("No admin account to record the demo as. Create one first.");

  await prisma.warehouse.create({ data: { name: SITE, kind: "FACTORY", type: "CENTRAL", code: "DMO", source: "demo data (prisma/demoProduction.ts)" } });
  await prisma.warehouse.create({ data: { name: STORE, site: SITE, source: "demo data (prisma/demoProduction.ts)" } });
  for (const code of BINS) await prisma.bin.create({ data: { code, warehouseName: STORE, source: "demo data", createdAt: new Date() } });
  // Two finished trucks in each bin, so each has procurement stock for a run to take.
  for (const [i, b] of BINS.entries()) {
    await stockedLot(b, String(40000 + (i % 5) * 1000), day(i % 20), `Demo supplier ${String.fromCharCode(65 + (i % 6))}`);
    await stockedLot(b, String(35000 + (i % 7) * 500), day(1 + (i % 20)), `Demo supplier ${String.fromCharCode(65 + ((i + 3) % 6))}`);
  }

  const user = { id: admin.id, role: "admin" as const };
  const preview = await previewProductionWorkbook(user, SITE, await workbook(demoRows()), "demo-production.xlsx");
  const errors = preview.sheets.flatMap((s) => s.errors.map((e) => `${s.name} row ${e.row}: ${e.message}`));
  if (errors.length) throw new Error(`The demo workbook was refused:\n${errors.slice(0, 40).join("\n")}${errors.length > 40 ? `\n… and ${errors.length - 40} more` : ""}`);
  const done = await commitProductionWorkbook(user, preview.token);
  console.log(`Demo production data added at ${SITE}: ${done.totalCreated} records, 15 production runs. On Production, pick "${SITE}" in the factory dropdown.`);
}

const removing = process.argv.includes("--remove");
(removing ? remove().then(() => console.log(`Demo production data removed (${SITE}).`)) : add())
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    // A half-added demo is taken out again, so the next try starts clean.
    if (!removing) await remove().catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
