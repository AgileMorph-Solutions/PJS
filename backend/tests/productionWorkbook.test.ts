/**
 * The production workbook: one file creates a load from its tally sheet rows (its pallets and final weight) and the
 * load's moisture checks — through the same rules as the screens — and a preview writes nothing. The production run is
 * never in the file: it is started on screen, and a load finds it by its source bin. What the file can't do is as
 * important: weigh a load twice, take a bin that is in no run, change a saved check.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, setBranch, setStageFields } from "../src/services/receipts.js";
import {
  commitProductionWorkbook, downloadProductionWorkbook, previewProductionWorkbook,
} from "../src/services/productionWorkbook.js";
import { batchCalibration } from "../src/services/production/calibration.js";
import { acceptRcnReceipt, listRcnReceipts } from "../src/services/production/rcnReceipts.js";
import { startRun } from "../src/services/production/startRun.js";
import { TABS, tabHeader } from "../src/domain/productionWorkbook/tabs.js";

const prisma = new PrismaClient();
const app = buildApp();
const SITE = "PWB-FACTORY";
const GRN = "GRN Weight (kept separate from Gross/Net/Paid)";
let wi: { id: string; role: "warehouse_incharge" };
let pi: { id: string; role: "production_incharge" };
let qfsCookie = "";
let fmCookie = "";

async function cleanup() {
  await prisma.manualCalibration.deleteMany({ where: { sizingCheck: { batch: { warehouse: SITE } } } });
  await prisma.sizingCheck.deleteMany({ where: { batch: { warehouse: SITE } } });
  await prisma.rcnPallet.deleteMany({ where: { rcnReceipt: { batch: { warehouse: SITE } } } });
  await prisma.rcnEmptyPalletStack.deleteMany({ where: { rcnReceipt: { batch: { warehouse: SITE } } } });
  await prisma.rcnMoistureCheck.deleteMany({ where: { rcnReceipt: { batch: { warehouse: SITE } } } });
  await prisma.rcnReceipt.deleteMany({ where: { batch: { warehouse: SITE } } });
  await prisma.productionBatch.deleteMany({ where: { warehouse: SITE } });
  await prisma.receipt.deleteMany({ where: { warehouse: SITE } });
  await prisma.bin.deleteMany({ where: { code: { startsWith: "PWB-" } } });
  await prisma.productionWorkbookUpload.deleteMany({ where: { warehouse: SITE } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "pwb-" } } });
  await prisma.warehouse.deleteMany({ where: { name: SITE } });
}

async function lotInBin(bin: string, kg: string) {
  const r = await createReceipt(SITE, "2026-06-01");
  await setBranch(r.id, "n-qfs", "pass");
  await setStageFields(r.id, "n-bin", { "Bin Number": bin }, { bypassValidation: true });
  await setStageFields(r.id, "n-grn", { [GRN]: kg, PRICE: "470" }, { bypassValidation: true });
  await setBranch(r.id, "n-drying", "none");
  await setBranch(r.id, "n-xferdec", "production");
}

/** An .xlsx with the given tabs: first row the headers, then the rows. */
async function xlsx(tabs: Record<string, (string | number | null)[][]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [title, rows] of Object.entries(tabs)) {
    const ws = wb.addWorksheet(title);
    for (const r of rows) ws.addRow(r);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const LOADS = ["Date", "BTM No", "Source Bin No"];
const CHECKS = ["Check ID", "RCN Receipt ID", "BTM No", "Moisture (%)", "Nut Count", "Sample Weight (g)", "GK (g)", "Spot (g)", "Immature (g)", "Result"];
// The client's "1. RCN Receipts" Online columns, word for word — and none of the app's IDs.
const TALLY = ["DATE", "Source BIN", "Bin No", "BTM No", "Gross Weight (kg's)", "No of Bags", "Pallet Weight (Kg's)", "Dust", "Voids"];
// BTM 109's two pallets; the empty pallets weighed in two stacks, one per row as the sheet scatters them.
const BTM_109 = [
  ["2026-07-20", "PWB-03B", "ANA-03B", "109", 2335, 30, 120, 2.5, null],
  ["2026-07-20", "PWB-03B", "ANA-03B", "109", 2445.4, 30, 80, null, null],
];

/** The Production Incharge's upload: only Admin and the Production Incharge upload (18 Nov 2026), every tab. */
const preview = (buf: Buffer) => previewProductionWorkbook(pi, SITE, buf, "test.xlsx");
const previewAs = (who: { id: string; role: "warehouse_incharge" | "production_incharge" }, buf: Buffer) => previewProductionWorkbook(who, SITE, buf, "test.xlsx");
/** A tab's result by its title, or by an older name a test file still uses (those keep uploading). */
const titleOf = (name: string) => TABS.find((t) => t.title === name || t.aliases?.includes(name))!.title;
const byName = (p: Awaited<ReturnType<typeof preview>>, name: string) => p.sheets.find((s) => s.name === titleOf(name))!;

beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: SITE, kind: "FACTORY", type: "CENTRAL", code: "PWB" } });
  for (const code of ["PWB-03B", "PWB-10", "PWB-11"]) await prisma.bin.create({ data: { code } });
  await lotInBin("PWB-03B", "2950400");
  await lotInBin("PWB-10", "878200");
  await lotInBin("PWB-11", "640000");
  const u = await prisma.user.create({ data: { username: "pwb-wi", displayName: "wi", role: "warehouse_incharge", warehouse: SITE, passwordHash: hashPassword("test-password-1") } });
  wi = { id: u.id, role: "warehouse_incharge" };
  // Started on screen, never from the file. PWB-11 is in no run.
  await startRun(SITE, u.id, { name: "PWB-ANA-03B", startDate: "2026-07-19", bins: ["PWB-03B", "PWB-10"], proposedBy: "Warehouse team" });
  await prisma.user.create({ data: { username: "pwb-qfs", displayName: "qfs", role: "qfs_officer", warehouse: SITE, passwordHash: hashPassword("test-password-1") } });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "pwb-qfs", password: "test-password-1" } });
  qfsCookie = String(res.headers["set-cookie"]).split(";")[0]!;
  const p = await prisma.user.create({ data: { username: "pwb-pi", displayName: "pi", role: "production_incharge", warehouse: SITE, passwordHash: hashPassword("test-password-1") } });
  pi = { id: p.id, role: "production_incharge" };
  await prisma.user.create({ data: { username: "pwb-fm", displayName: "fm", role: "factory_manager", warehouse: SITE, passwordHash: hashPassword("test-password-1") } });
  const fm = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "pwb-fm", password: "test-password-1" } });
  fmCookie = String(fm.headers["set-cookie"]).split(";")[0]!;
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

describe("the sample", () => {
  // Team decision, Nov 2026: tabs in the client's own file numbers read as random, and the Read me and "New" tags went
  // unread. The sample follows the floor step by step, in plain tabs.
  it("is one file, step by step in the floor's order, headers only: no Read me, nothing marked New", async () => {
    const built = await downloadProductionWorkbook(SITE, {}, true);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(built.buffer as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "1. RCN Receipts", "2. RCN Receipts summary", "3. Input RCN Quality",
      "4. Wholes Manual Calibration", "5. Silo Moves",
      "6. Cooking Process", "7. Cooking Cycles Monitoring", "8. Cooking Waste Water", "9. Cooling", "10. Cooling Checks",
      "11. Shelling Process", "12. Shelling Line wise Data", "13. Shelling Machine Frequency", "14. Shelling Machine Quality", "15. Uncut Checks", "16. Shell Waste Sample",
      "17. Shelled Kernels Quality",
      "18. Boiler Consumption", "19. Waste Management Dispatch", "20. Shell Dispatch Tracker",
    ]);
    expect(wb.worksheets.every((w) => w.actualRowCount === 1)).toBe(true);
    // Nothing says "New": not a tab name, not a header, not a header's note.
    for (const ws of wb.worksheets) {
      expect(ws.name, ws.name).not.toMatch(/new/i);
      ws.getRow(1).eachCell((cell) => expect(JSON.stringify(cell.note ?? ""), `${ws.name} · ${cell.value}`).not.toMatch(/New:/));
    }
    // One colour per stage on the tab strip: the three Intake tabs share one, Cooking another.
    const color = (name: string) => wb.getWorksheet(name)!.properties.tabColor?.argb;
    expect(color("1. RCN Receipts")).toBe(color("3. Input RCN Quality"));
    expect(color("6. Cooking Process")).toBe(color("10. Cooling Checks"));
    expect(color("1. RCN Receipts")).not.toBe(color("6. Cooking Process"));
    expect(built.filename).toBe("ANAGROCI - Production - Sample.xlsx");
  });

  it("a file downloaded before keeps uploading under its old tab names", async () => {
    const p = await preview(await xlsx({ "19. RCN Receipts Tally Sheet": [TALLY], "New · Cooling": [["Lot No", "Cooling Silo", "Date In", "Time In"]] }));
    expect(p.notices.filter((n) => /isn't one of the production workbook's tabs/.test(n))).toEqual([]);
  });
});

describe("the columns", () => {
  // The client's own headers, read from their files in PJS-docs/Files And Flow/Production (Nov 2026).
  const lead = (id: string) => TABS.find((t) => t.id === id)!.fields.filter((f) => !f.isNew).map((f) => f.label);
  it("each client tab starts with that file's columns, in its order and words; the app's columns all come after", () => {
    expect(lead("wasteTrucks")).toEqual(["SL.NO", "DATE", "Week", "Month", "TRUCK NO", "Weighment Slip", "TARE WEIGHT", "GROSS WEIGHT", "NET WEIGHT (KGS)", "Vendor", "Category", "Price (HT)"]);
    expect(lead("shellTrucks")).toEqual(["SL.NO", "DATE", "Week", "Month", "TRUCK NO", "Weighment Slip", "TARE WEIGHT", "GROSS WEIGHT", "NET WEIGHT (KGS)", "Vendor"]);
    expect(lead("receipts")).toEqual(["S.No", "Date", "Month", "Year", "Crop Year", "BTM No", "Source Bin No", "BIN No", "Received Gross Qty (kgs)", "Pallets+Bags Wt (kgs)", "Net Weight (kgs)"]);
    expect(lead("boiler")).toEqual(["SL.NO", "DATE", "Week", "Month", "Material", "QTY Consumed (Kg's)"]);
    expect(lead("entry:cooker_log")).toEqual(["SL.NO", "DATE", "Week", "Month", "Cooker No", "Size Description", "Size (mm)", "Start Time", "End Time", "Total Time", "Set temperature (deg C)", "Set Pressure (bar)", "Lot No", "Bin No", "Silo Name", "Gate No", "Quantity (kg's)"]);
    for (const t of TABS.filter((x) => !x.isNew)) {
      const firstNew = t.fields.findIndex((f) => f.isNew);
      expect(firstNew === -1 || t.fields.slice(firstNew).every((f) => f.isNew), t.title).toBe(true);
    }
  });

  it("the RCN Receipts summary tab is the client's register, with no app ID either", () => {
    expect(TABS.find((t) => t.id === "receipts")!.fields.map((f) => f.label)).not.toContain("RCN Receipt ID");
  });

  it("the RCN Receipts tab is the client's Online sheet, column for column, with none of the app's IDs (they confuse the floor)", () => {
    expect(TABS.find((t) => t.id === "tally")!.fields.map((f) => f.label)).toEqual([
      "SL.NO", "DATE", "Week", "Month", "Source BIN", "Bin No", "BTM No", "Pallet No", "Gross Weight (kg's)", "No of Bags", "Bags Weight (kg's)", "Pallet Weight (Kg's)", "Net Weight (kg's)", "Dust", "Voids",
    ]);
  });

  it("no two columns of a tab read as one: silo A++'s kg must never land in silo A", () => {
    for (const tab of TABS) {
      const headers = tab.fields.map((f) => tabHeader(f.label));
      expect(new Set(headers).size, tab.title).toBe(headers.length);
    }
  });
});

describe("one file, the whole of Intake", () => {
  const file = () => xlsx({
    "RCN Tally Sheet": [TALLY, ...BTM_109],
    // Too wet first, then OK after drying: two rows for one load, in the order they happened.
    "Moisture Checks": [CHECKS, [null, null, "109", 11.2, 180, 1000, 230, 12, 13, "Hold"], [null, null, "109", 9.8, 180, 1000, 230, 12, 13, "OK"]],
  });

  it("previews every row as new, says what the load comes to, and writes nothing", async () => {
    const p = await preview(await file());
    expect(p.errorCount).toBe(0);
    expect(p.sheets.map((s) => [s.name, s.created])).toEqual([["1. RCN Receipts", 2], ["3. Input RCN Quality", 2]]);
    // 4,780.4 gross − 39 (60 bags) − 200 (pallets) = 4,541.4 net; − 2.5 dust = 4,538.9 to the silos.
    expect(p.notices).toContain("1. RCN Receipts: BTM 109 from PWB-03B (new load) · 2 pallets · 60 bags · gross 4,780.4 kg · net 4,541.4 kg · to silos 4,538.9 kg.");
    expect(await prisma.rcnReceipt.count({ where: { batch: { warehouse: SITE } } })).toBe(0);
  });

  it("applies it with no approval left waiting: the load finds its run by its bin, is weighed, its checks approved and the load accepted", async () => {
    const p = await preview(await file());
    const done = await commitProductionWorkbook(pi, p.token);
    expect(done.totalCreated).toBe(4);
    const [load] = await listRcnReceipts(SITE);
    // An upload needs no approval (18 Nov 2026): the Production Incharge's file finishes the load and accepts it.
    expect(load).toMatchObject({ batchCode: expect.stringMatching(/^PR-PWB-2026-\d{3}$/), date: "2026-07-20", btmNo: "109", binCode: "PWB-03B", status: "calibrated" });
    expect(load!.acceptance).not.toBeNull();
    expect(load!.moistureChecks.map((c) => [c.decision, c.status])).toEqual([["hold", "approved"], ["ok", "approved"]]);
    expect(load!.pallets.map((p) => [p.grossKg, p.factoryBin])).toEqual([["2335", "ANA-03B"], ["2445.4", "ANA-03B"]]);
    expect(load!.finalWeight).toMatchObject({ emptyPallets: [{ weightKg: "120" }, { weightKg: "80" }], dustKg: "2.5", voidsKg: "" });
  });

  it("the same tally sheet again is the same weighing: nothing is added twice", async () => {
    const p = await preview(await xlsx({ "RCN Tally Sheet": [TALLY, ...BTM_109] }));
    expect(p.errorCount).toBe(0);
    expect(p.totalCreated + p.totalChanged).toBe(0);
    expect(byName(p, "RCN Tally Sheet").unchanged).toBe(2);
  });

  it("a token is used once", async () => {
    const p = await preview(await xlsx({ "RCN Receipts summary": [LOADS] }));
    await commitProductionWorkbook(pi, p.token);
    await expect(commitProductionWorkbook(pi, p.token)).rejects.toThrow(/expired/);
  });

  it("an export uploaded back unchanged changes nothing", async () => {
    const built = await downloadProductionWorkbook(SITE, {}, false);
    const p = await preview(Buffer.from(built.buffer as ArrayBuffer));
    expect(p.errorCount).toBe(0);
    expect(p.totalCreated + p.totalChanged).toBe(0);
    expect(byName(p, "RCN Tally Sheet").unchanged).toBe(2);
  });

  it("the export's RCN Receipts summary tab is the client's register: one row per load, its kg worked out from the pallets", async () => {
    const built = await downloadProductionWorkbook(SITE, {}, false);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(built.buffer as ArrayBuffer);
    const ws = wb.getWorksheet("2. RCN Receipts summary")!;
    const head = (ws.getRow(1).values as unknown[]).slice(1);
    const row = Object.fromEntries(head.map((h, i) => [String(h), ws.getRow(2).getCell(i + 1).value]));
    expect(row).toMatchObject({
      "BTM No": "109", "Source Bin No": "PWB-03B", "BIN No": "ANA-03B", "Received Gross Qty (kgs)": 4780.4, "Pallets+Bags Wt (kgs)": 239,
      "Net Weight (kgs)": 4541.4, "Dust (kgs)": "2.5", "Net Weight Transferred to Silos (kgs)": 4538.9,
    });
  });
});

describe("the client's own tally sheet, pasted in as it is", () => {
  // The Online sheet: a title over its headers, its formula columns (SL.NO, Week, Month, Pallet No, Bags Weight, Net
  // Weight), and a totals row at the bottom. BTM 122 came from two bins, so it is two loads, each with its own dust.
  const ONLINE = ["SL.NO", "DATE", "Week", "Month", "Source BIN", "Bin No", "BTM No", "Pallet No", "Gross Weight (kg's)", "No of Bags", "Bags Weight (kg's)", "Pallet Weight (Kg's)", "Net Weight (kg's)", "Dust", "Voids"];
  const file = () => xlsx({
    Online: [
      ["RCN Receipts Tally Sheet"],
      ONLINE,
      [1, "2026-08-05", 32, "Aug-26", "PWB-03B", "ANA-03B", "122", 1, 2400, 30, 19.5, 210, 2170.5, 200, 2],
      [2, "2026-08-05", 32, "Aug-26", "PWB-10", "ANA-10", "122", 1, 2300, 30, 19.5, 205, 2075.5, 150, null],
      [3, "2026-08-05", 32, "Aug-26", "PWB-10", "ANA-10", "122", 1, 2200, 30, 19.5, null, 2180.5, 145, 1],
      [null, null, null, null, null, null, null, 3, 6900, 90, 58.5, 415, 6426.5, 495, 3],
    ],
    Print: [["Description", "Quantity"], ["Total Gross Weight", 6900]],
  });

  it("reads it: one load per BTM and bin, the formula columns and the totals row read past, dust added up as its SUMIF does", async () => {
    const p = await preview(await file());
    expect(p.sheets.flatMap((s) => s.errors)).toEqual([]);
    expect(byName(p, "RCN Tally Sheet").created).toBe(3);
    expect(p.notices).toEqual(expect.arrayContaining([
      expect.stringMatching(/1 row with no BTM, bin or date .* skipped/),
      expect.stringMatching(/Sheet "Print" isn't one of the production workbook's tabs/),
      // 2,400 − 19.5 − 210 = 2,170.5 net; − 200 dust − 2 voids = 1,968.5.
      "1. RCN Receipts: BTM 122 from PWB-03B (new load) · 1 pallets · 30 bags · gross 2,400 kg · net 2,170.5 kg · to silos 1,968.5 kg.",
      // 4,500 − 39 − 205 = 4,256 net; dust 150 + 145 = 295, voids 1 → 3,960 to the silos.
      "1. RCN Receipts: BTM 122 from PWB-10 (new load) · 2 pallets · 60 bags · gross 4,500 kg · net 4,256 kg · to silos 3,960 kg.",
    ]));
    expect(p.notices.some((n) => /SL\.NO|Week|Bags Weight/.test(n))).toBe(false);
  });

  it("a bin in no production run starts one: the file's new bins, from their earliest date, by the New run screen's rules", async () => {
    const p = await preview(await xlsx({
      "RCN Tally Sheet": [TALLY, ["2026-08-07", "PWB-11", "ANA-11", "123", 2000, 30, 200, null, null], ["2026-08-06", "PWB-11", "ANA-11", "124", 2100, 30, 210, null, null]],
      // A bin already in a run joins it: no second run for PWB-10.
      "RCN Receipts summary": [LOADS, ["2026-08-08", "125", "PWB-10"]],
    }));
    expect(p.sheets.flatMap((s) => s.errors)).toEqual([]);
    expect(p.notices).toContain("A new production run PR-PWB-2026-002 starts on 2026-08-06 with PWB-11, the file's bins that were in no run.");
    expect(byName(p, "RCN Tally Sheet").created).toBe(2);
    expect(byName(p, "RCN Receipts summary").created).toBe(1);
    // Previewed only.
    expect(await prisma.productionBatch.count({ where: { warehouse: SITE } })).toBe(1);
  });

  it("a bin the New run screen would refuse starts no run, and its loads say why", async () => {
    const p = await preview(await xlsx({ "RCN Tally Sheet": [TALLY, ["2026-08-06", "PWB-NOPE", "ANA-11", "123", 2000, 30, 200, null, null]] }));
    expect(p.notices.some((n) => /new production run/.test(n))).toBe(false);
    expect(byName(p, "RCN Tally Sheet").errors.map((e) => [e.row, e.message])).toEqual([[2, expect.stringMatching(/PWB-NOPE isn't in Masters › Bins, so no production run can start with it/)]]);
  });
});

describe("what the file can't do — the screens' own refusals, row by row", () => {
  it("takes a load's steps in any order, as the screens do: pallets before the moisture check", async () => {
    const p = await preview(await xlsx({
      "RCN Tally Sheet": [TALLY, ["2026-07-21", "PWB-10", "ANA-03B", "110", 2000, 30, null, null, null]],
      "Moisture Checks": [CHECKS, [null, null, "110", 9.5, 180, null, null, null, null, "OK"]],
    }));
    expect(p.sheets.flatMap((s) => s.errors)).toEqual([]);
    expect(p.sheets.map((s) => [s.name, s.created])).toEqual([["1. RCN Receipts", 1], ["3. Input RCN Quality", 1]]);
    expect(p.notices).toContain("1. RCN Receipts: BTM 110 from PWB-10 (new load) · 1 pallets · 30 bags · gross 2,000 kg · no pallet weight yet.");
    // Previewed only: the tests below go on from the one load.
    expect(await prisma.rcnReceipt.count({ where: { batch: { warehouse: SITE } } })).toBe(1);
  });

  it("won't weigh a load twice: different pallets for a load already weighed are refused", async () => {
    const p = await preview(await xlsx({ "RCN Tally Sheet": [TALLY, ["2026-07-20", "PWB-03B", "ANA-03B", "109", 9999, 30, null, null, null]] }));
    expect(byName(p, "RCN Tally Sheet").errors.map((e) => e.message)).toEqual([expect.stringMatching(/BTM 109 from PWB-03B already has 2 pallets weighed .* change it on RR-PWB-2026-0001's screen/)]);
  });

  it("an RCN Receipts summary row for a load the tally sheet already made is that load, not a second one", async () => {
    const p = await preview(await xlsx({ "RCN Receipts summary": [LOADS, ["2026-07-20", "109", "PWB-03B"]] }));
    expect(byName(p, "RCN Receipts summary")).toMatchObject({ created: 0, unchanged: 1 });
    expect(byName(p, "RCN Receipts summary").warnings).toEqual([]);
  });

  it("a load the upload accepted takes no more checks from the Production Incharge's file, as on screen: only Admin corrects it", async () => {
    const p = await preview(await xlsx({ "Moisture Checks": [CHECKS, [null, null, "109", 9.5, 180, null, null, null, null, "OK"]] }));
    expect(byName(p, "Moisture Checks").errors.map((e) => e.message)).toEqual([expect.stringMatching(/Production has accepted RR-PWB-2026-0001/)]);
  });

  it("the register's Crop Year fills the gap on a load the tally sheet made, and a crop year must be a year", async () => {
    const CROP = ["Date", "Crop Year", "BTM No", "Source Bin No"];
    const p = await preview(await xlsx({ "RCN Receipts summary": [CROP, ["2026-07-20", "2026", "109", "PWB-03B"], ["2026-08-09", "26", "126", "PWB-10"]] }));
    expect(byName(p, "RCN Receipts summary").changed).toBe(1);
    expect(byName(p, "RCN Receipts summary").errors.map((e) => [e.row, e.message])).toEqual([[3, expect.stringMatching(/Crop year "26" should be a year/)]]);
  });

  it("a column the tab needs must be there", async () => {
    const p = await preview(await xlsx({ "RCN Tally Sheet": [["Gross Weight (kg's)", "No of Bags"], [1, 1]] }));
    expect(byName(p, "RCN Tally Sheet").errors[0]!.message).toMatch(/"BTM No" column is missing/);
  });
});

describe("Calibration in the same file", () => {
  const RUNS = ["Run ID", "RCN Receipt ID", "BTM No", "Date", "Size A++ (>25mm)", "Size A (24mm)", "Size E (18mm)"];
  // A file from before Intake & Calibration became one stage (Nov 2026) still carries this tab.
  const CHECKS2 = ["Check ID", "Batch Name", "Date", "Sampling Point", "BIN NO", "Nut Count per KG", "Sample Qty (gm)", "A++ (g)", "A (g)", "AB (g)", "DE (g)", "< DE (g)", "Result"];
  const MOVES = ["Move ID", "Date", "From Silo", "To Silo", "Kg Moved"];
  // PWB-ANA-03B's BTM 109 hands over 2335 + 2445.4 − 39 (60 bags) − 200 (pallets) − 2.5 (dust) = 4,538.9 kg.
  const file = () => xlsx({
    "Calibration Runs": [RUNS, [null, null, "109", "2026-07-21", 500, 3000, null], [null, null, "109", "2026-07-22", null, 1000, 38.9]],
    "Silo Checks": [
      CHECKS2,
      [null, "PWB-ANA-03B", "2026-07-22", "A", "PWB-03B", 143, 1000, null, 203, 625, null, 172, "Fail"],
      [null, "PWB-ANA-03B", "2026-07-22", "DE", null, null, 1000, null, null, null, 950, 50, "OK"],
    ],
    "Silo Moves": [MOVES, [null, "2026-07-23", "A", "AB", 400]],
  });

  // Calibration is after the acceptance: every load the file made was accepted by its upload; any other is accepted here.
  beforeAll(async () => {
    for (const r of await listRcnReceipts(SITE)) if (r.status === "waiting_for_acceptance") await acceptRcnReceipt(SITE, pi, r.id);
  });

  it("previews checks and moves leaning on each other, ignores the old kg-per-silo tab with a reason, and writes nothing", async () => {
    const p = await previewAs(pi, await file());
    expect(p.errorCount).toBe(0);
    expect(p.sheets.map((s) => [s.name, s.created])).toEqual([["4. Wholes Manual Calibration", 2], ["5. Silo Moves", 1]]);
    expect(p.notices).toContain('Sheet "Calibration Runs" — ignored: kg per silo are no longer recorded. A load goes into the silos, as net − dust − voids, when production accepts it.');
    expect(await prisma.sizingCheck.count({ where: { batch: { warehouse: SITE } } })).toBe(0);
  });

  it("applies them: DE reads as silo E, a check is approved as it is saved, and a move leaves the silos' total alone", async () => {
    await commitProductionWorkbook(pi, (await previewAs(pi, await file())).token);
    const load = (await listRcnReceipts(SITE)).find((r) => r.btmNo === "109")!;
    expect(load.status).toBe("calibrated");
    const cal = (await batchCalibration(SITE, "PWB-ANA-03B"))!;
    // Every load at the site production accepted is in the silos, BTM 109's 4,538.9 kg among them.
    const all = (await listRcnReceipts(SITE)).filter((r) => r.acceptance);
    expect(all.map((r) => r.btmNo)).toContain("109");
    expect(cal.silos.cookedKg).toBe(0);
    expect(cal.silos.stockKg).toBe(cal.silos.inKg);
    expect(cal.siloChecks.A).toMatchObject({ state: "re_sized" });
    expect(cal.siloChecks.E).toMatchObject({ state: "ok" });
    expect(cal.sizingChecks.every((c) => c.status === "approved")).toBe(true);
  });

  it("the same file again creates nothing: an upload is never duplicated", async () => {
    const p = await previewAs(pi, await xlsx({
      "Silo Checks": [CHECKS2, [null, "PWB-ANA-03B", "2026-07-22", "A", "PWB-03B", 143, 1000, null, 203, 625, null, 172, "Fail"]],
      "Silo Moves": [MOVES, [null, "2026-07-23", "A", "AB", 400]],
    }));
    expect(p.errorCount).toBe(0);
    expect(p.totalCreated).toBe(0);
  });

  it("an export uploaded back unchanged changes nothing, Calibration tabs included", async () => {
    const built = await downloadProductionWorkbook(SITE, {}, false);
    const p = await previewAs(pi, Buffer.from(built.buffer as ArrayBuffer));
    expect(p.errorCount).toBe(0);
    expect(p.totalCreated + p.totalChanged).toBe(0);
    expect(byName(p, "Silo Checks").unchanged).toBe(2);
    expect(byName(p, "Silo Moves").unchanged).toBe(1);
  });

  it("gives the screens' own refusals, row by row", async () => {
    const p = await previewAs(pi, await xlsx({
      "Silo Checks": [CHECKS2, [null, "PWB-ANA-03B", "2026-07-24", "Z", null, null, 1000, 1000, null, null, null, null, "OK"], [null, "PWB-ANA-03B", "2026-07-24", "A", "BIN-NOPE", null, 1000, null, 1000, null, null, null, "OK"]],
      "Silo Moves": [MOVES, [null, "2026-07-24", "E", "A", 1], [null, "2026-07-24", "A", "AB", 0]],
    }));
    expect(byName(p, "Silo Checks").errors.map((e) => e.message)).toEqual([expect.stringMatching(/Choose the silo the sample was taken from/), expect.stringMatching(/BIN-NOPE is not in production run/)]);
    expect(byName(p, "Silo Moves").errors.map((e) => e.message)).toEqual([expect.stringMatching(/E \(18 mm\) has no failed check/), expect.stringMatching(/Kg moved must be a number above 0/)]);
  });
});

describe("who may upload, and the log of who did", () => {
  const cookieOf = async (username: string) =>
    String((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: "test-password-1" } })).headers["set-cookie"]).split(";")[0]!;

  it("only Admin and the Production Incharge: the Warehouse Incharge records a load on screen, and can't upload the file", async () => {
    const wiCookie = await cookieOf("pwb-wi");
    expect((await app.inject({ method: "POST", url: "/api/production/workbook/preview", headers: { cookie: wiCookie } })).statusCode).toBe(403);
    // Called past the route, the rules still write nothing of theirs.
    const p = await previewProductionWorkbook(wi, SITE, await xlsx({ "RCN Tally Sheet": [TALLY, ...BTM_109] }), "test.xlsx");
    expect(p.sheets).toEqual([]);
    expect(p.notices).toContain("1. RCN Receipts: skipped — only Admin and the Production Incharge upload this workbook.");
  });

  it("logs every applied upload: who, when, which file and what it wrote; a preview logs nothing", async () => {
    const before = await prisma.productionWorkbookUpload.count({ where: { warehouse: SITE } });
    const p = await previewProductionWorkbook(pi, SITE, await xlsx({ "RCN Receipts summary": [LOADS, ["2026-08-30", "777", "PWB-10"]] }), "log-test.xlsx");
    expect(await prisma.productionWorkbookUpload.count({ where: { warehouse: SITE } })).toBe(before);
    await commitProductionWorkbook(pi, p.token);
    const res = await app.inject({ method: "GET", url: "/api/production/workbook/uploads?warehouse=PWB-FACTORY", headers: { cookie: await cookieOf("pwb-pi") } });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0]).toMatchObject({ filename: "log-test.xlsx", uploadedBy: "pi", uploadedByRole: "production_incharge", created: 1, updated: 0, tabs: [{ name: "2. RCN Receipts summary", created: 1, updated: 0 }] });
    // The Factory Manager reads the log; the warehouse team doesn't.
    expect((await app.inject({ method: "GET", url: "/api/production/workbook/uploads?warehouse=PWB-FACTORY", headers: { cookie: fmCookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/production/workbook/uploads?warehouse=PWB-FACTORY", headers: { cookie: await cookieOf("pwb-wi") } })).statusCode).toBe(403);
  });

  it("a QFS Officer keeps entering checks on screen, for the Incharge to approve", async () => {
    const res = await app.inject({ method: "GET", url: "/api/production/workbook/info", headers: { cookie: qfsCookie } });
    expect(res.statusCode).toBe(403);
  });

  it("the Factory Manager downloads it but can't upload", async () => {
    expect((await app.inject({ method: "GET", url: "/api/production/workbook/info", headers: { cookie: fmCookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/production/workbook/preview", headers: { cookie: fmCookie } })).statusCode).toBe(403);
  });
});
