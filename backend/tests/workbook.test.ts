/**
 * The ANAGROCI workbook: one .xlsx, plain sheet names, plain column headers, used for Export and
 * Upload. These tests speak the way a person does ("Truck Reception", "Price (CFA/kg)") — never
 * table or column names — because that is the contract.
 *
 * The property the whole feature rests on is the round trip: export a section, upload the file
 * unchanged, and NOTHING is written — not a row, not an audit entry, not an updatedAt.
 */
import { PROFILE_FIELDS } from "@anagroci/contract/domain/supplierProfile";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { sheetsFor } from "../src/domain/workbook/sheets.js";
import { setStageFields } from "../src/services/receipts.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const P = "wbtest-";
const cookies: Record<string, string> = {};

async function mkUser(key: string, role: string, warehouse: string | null) {
  const u = await prisma.user.create({ data: { username: P + key, displayName: key, role, warehouse, passwordHash: hashPassword(PW) } });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: u.username, password: PW } });
  cookies[key] = String(res.headers["set-cookie"]).split(";")[0];
}

const get = (who: string | null, url: string) => app.inject({ method: "GET", url, headers: who ? { cookie: cookies[who] } : {} });

/** A hand-built multipart body: one file, plus optional text fields. */
function multipart(file: Buffer | ArrayBuffer, filename = "workbook.xlsx", fields: Record<string, string> = {}) {
  const boundary = "----wbtest" + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`));
  parts.push(Buffer.from(file as ArrayBuffer), Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}
async function preview(who: string, file: Buffer | ArrayBuffer, fields: Record<string, string> = {}) {
  const m = multipart(file, "workbook.xlsx", fields);
  return app.inject({ method: "POST", url: "/api/workbook/preview", payload: m.payload, headers: { cookie: cookies[who], "content-type": m.contentType } });
}
const commit = (who: string, token: string) => app.inject({ method: "POST", url: `/api/workbook/${token}/commit`, headers: { cookie: cookies[who] } });

async function load(buf: Buffer | ArrayBuffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  return wb;
}
const toBuf = (b: ExcelJS.Buffer) => Buffer.from(b as ArrayBuffer);
const sheetBody = (body: any, title: string) => body.sheets.find((s: any) => s.name === title);

// ── helpers that speak in headers ──────────────────────────────────────────────────────────────────
const headersOf = (ws: ExcelJS.Worksheet) => (ws.getRow(1).values as unknown[]).slice(1).map(String);
const colOf = (ws: ExcelJS.Worksheet, header: string) => {
  const i = headersOf(ws).indexOf(header);
  if (i < 0) throw new Error(`no column "${header}" on ${ws.name}`);
  return i + 1;
};
const rowOf = (ws: ExcelJS.Worksheet, header: string, value: string) => {
  const c = colOf(ws, header);
  for (let r = 2; r <= ws.rowCount; r++) if (String(ws.getRow(r).getCell(c).value) === value) return r;
  throw new Error(`no row with ${header} = ${value} on ${ws.name}`);
};
const setCell = (ws: ExcelJS.Worksheet, row: number, header: string, value: unknown) => { ws.getRow(row).getCell(colOf(ws, header)).value = value as ExcelJS.CellValue; };
/** Append a row with the given cells (the id column left blank = a new row). */
const addRow = (ws: ExcelJS.Worksheet, cells: Record<string, unknown>) => {
  const r = ws.rowCount + 1;
  for (const [h, v] of Object.entries(cells)) setCell(ws, r, h, v);
  return r;
};
async function edited(who: string, fn: (wb: ExcelJS.Workbook) => void | Promise<void>, url = "/api/workbook") {
  const wb = await load((await get(who, url)).rawPayload);
  await fn(wb);
  return toBuf(await wb.xlsx.writeBuffer());
}
const names = async (who: string, url = "/api/workbook") => (await load((await get(who, url)).rawPayload)).worksheets.map((w) => w.name);

const cleanupUsers = () => prisma.user.deleteMany({ where: { username: { startsWith: P } } });
beforeAll(async () => {
  await cleanupUsers();
  await mkUser("wi", "warehouse_incharge", "BOUAKE");
  await mkUser("wiY", "warehouse_incharge", "YAKRO FACTORY");
  await mkUser("bm", "branch_manager", "BOUAKE");
  await mkUser("admin", "admin", null);
});
afterAll(async () => {
  await cleanupUsers();
  await prisma.$disconnect();
  await app.close();
});

const VEH = "WBTEST-";
const SENTINEL = "REC-WBTEST-0001";
async function removeSentinels() {
  await prisma.receipt.deleteMany({ where: { OR: [{ id: { startsWith: "REC-WBTEST" } }, { vehicleNo: { startsWith: VEH } }] } });
  await prisma.warehouseDischarge.deleteMany({ where: { lotNo: { startsWith: "WBTEST" } } });
  await prisma.juteWarehouseTransferReceipt.deleteMany({ where: { truckRegistration: { startsWith: "WBTEST" } } });
  await prisma.juteWarehouseMovement.deleteMany({ where: { truckNumber: { startsWith: "WBTEST" } } });
  await prisma.supplier.deleteMany({ where: { code: { startsWith: "WBTEST" } } });
  await prisma.origin.deleteMany({ where: { name: { startsWith: "WBTEST" } } });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe("round trip: export then upload unchanged writes nothing", { timeout: 60_000 }, () => {
  for (const [who, type] of [["wi", "UNIT"], ["wiY", "CENTRAL"]] as const) {
    it(`${type} section: no new rows, no changes, no errors, no notices`, async () => {
      const dl = await get(who, "/api/workbook");
      expect(dl.statusCode).toBe(200);

      const counts = async () => ({
        receipts: await prisma.receipt.count(),
        timeline: await prisma.timelineEntry.count(),
        changes: await prisma.stageFieldChange.count(),
        discharges: await prisma.warehouseDischarge.count(),
        updated: (await prisma.receipt.aggregate({ _max: { updatedAt: true } }))._max.updatedAt?.toISOString(),
      });
      const before = await counts();

      const prev = await preview(who, dl.rawPayload);
      expect(prev.statusCode).toBe(200);
      const body = prev.json();
      const problems = body.sheets.flatMap((s: any) => s.errors.map((e: any) => `${s.name} row ${e.row} ${e.column ?? ""}: ${e.message}`));
      expect(problems.slice(0, 10)).toEqual([]);
      // Not vacuous: the section's sheets are really there, with real data in them.
      expect(body.sheets.map((s: any) => s.name)).toEqual(sheetsFor(type).map((s) => s.title));
      expect(body.notices).toEqual([]);
      expect(sheetBody(body, "Truck Reception").rows).toBeGreaterThan(100);
      expect(sheetBody(body, "Warehouse Receiving").rows).toBeGreaterThan(100);
      for (const s of body.sheets) {
        expect(s.created, `${s.name} created`).toBe(0);
        expect(s.changed, `${s.name} changed`).toBe(0);
        expect(s.unchanged, `${s.name} unchanged`).toBe(s.rows);
      }

      const done = await commit(who, body.token);
      expect(done.statusCode).toBe(200);
      expect(done.json().totalCreated + done.json().totalUpdated).toBe(0);
      expect(await counts()).toEqual(before);
    });
  }
});

describe("what the file looks like to a person", { timeout: 60_000 }, () => {
  it("has no README sheet and opens on Truck Reception, with plain sheet names", async () => {
    for (const [who, type] of [["wi", "UNIT"], ["wiY", "CENTRAL"]] as const) {
      const n = await names(who);
      expect(n[0]).toBe("Truck Reception");
      expect(n.some((x) => /readme/i.test(x) || x.startsWith("_"))).toBe(false);
      expect(n).toEqual(sheetsFor(type).map((s) => s.title));
      for (const x of n) expect(x).not.toMatch(/[a-z][A-Z]/); // no WarehouseDischarge / JuteWarehouseMovement
    }
  });

  it("uses plain column headers everywhere: no dots, no camelCase, none of the app's own columns", async () => {
    for (const who of ["wi", "wiY"]) {
      const wb = await load((await get(who, "/api/workbook")).rawPayload);
      for (const ws of wb.worksheets) {
        for (const h of headersOf(ws)) {
          expect(h, `${ws.name}: ${h}`).not.toMatch(/[a-z][A-Z]/);
          expect(h, `${ws.name}: ${h}`).not.toMatch(/[._]/);
          // The app's own columns by name — exact, since "Source Bin" is the client's own (where RCN came from).
          expect(["source", "sheetrow", "createdat", "updatedat", "seq", "status (derived)", "computed_balance", "balance_delta"], `${ws.name}: ${h}`).not.toContain(h.toLowerCase());
          expect(h, `${ws.name}: ${h}`).not.toMatch(/\b(derived|raw)\b/i);
        }
      }
    }
  });

  it("starts each sheet with the column that identifies a row, and says what blank means", async () => {
    const wb = await load((await get("wi", "/api/workbook")).rawPayload);
    expect(headersOf(wb.getWorksheet("Truck Reception")!)[0]).toBe("Receipt ID");
    expect(headersOf(wb.getWorksheet("Warehouse Receiving")!)[0]).toBe("Row ID");
    // The Suppliers sheet carries the client's LBA register, so it can be filled in bulk (contract supplierProfile.ts).
    expect(headersOf(wb.getWorksheet("Suppliers")!)).toEqual([
      "Supplier Code", "Supplier ID", "Supplier Name",
      ...PROFILE_FIELDS.filter((f) => f.key !== "name").map((f) => f.label),
      "Status",
    ]);
    expect(String((wb.getWorksheet("Truck Reception")!.getRow(1).getCell(1).note as any)?.texts?.map((t: any) => t.text).join("") ?? wb.getWorksheet("Truck Reception")!.getRow(1).getCell(1).note)).toMatch(/blank to add a new row/i);
  });

  it("asks for what the client's own Truck Reception sheet holds", async () => {
    const wb = await load((await get("wi", "/api/workbook")).rawPayload);
    expect(headersOf(wb.getWorksheet("Truck Reception")!)).toEqual(expect.arrayContaining([
      "Receipt ID", "Arrival Date", "Supplier Name", "Supplier Code", "Truck No", "Fiche Code", "Fiche No", "Gross Weight (kg)", "Net Weight (kg)",
      "Bags Count", "Good Bags", "Humid Bags", "Torn Bags", "Refraction (kg)", "Paid Weight (kg)", "Loaded Truck Weight (kg)", "Tare Weight (kg)",
      "Moisture (%)", "Nut Count", "KOR", "Final KOR", "Origin", "Remarks", "Week",
    ]));
    // Price and amount are hidden from the Warehouse Incharge (Oct 2026); an Admin's file still carries them.
    const mine = headersOf(wb.getWorksheet("Truck Reception")!);
    expect(mine).not.toContain("Price (CFA/kg)");
    expect(mine).not.toContain("Amount (CFA)");
    const admin = headersOf((await load((await get("admin", "/api/workbook?warehouse=BOUAKE")).rawPayload)).getWorksheet("Truck Reception")!);
    expect(admin).toEqual(expect.arrayContaining(["Price (CFA/kg)", "Amount (CFA)"]));
  });

  it("keeps the lab results in full on Warehouse Receiving, each section with the panel it records", async () => {
    const unit = headersOf((await load((await get("wi", "/api/workbook")).rawPayload)).getWorksheet("Warehouse Receiving")!);
    const central = headersOf((await load((await get("wiY", "/api/workbook")).rawPayload)).getWorksheet("Warehouse Receiving")!);
    for (const h of ["Sample – Good Kernel (g)", "Sample – KOR", "Final – Good Kernel (g)", "Final – Moisture (%)", "Final – Nut Count"]) {
      expect(unit, `Unit ${h}`).toContain(h);
      expect(central, `Central ${h}`).toContain(h);
    }
    expect(central).toContain("Sample – Murli");
    expect(unit).not.toContain("Sample – Murli");
    expect(central).toContain("Storage Area");
    expect(unit).not.toContain("Storage Area");
  });

  it("does not ask for values the app works out, or for the warehouse the section already decides", async () => {
    const wb = await load((await get("wi", "/api/workbook")).rawPayload);
    const all = wb.worksheets.flatMap(headersOf);
    for (const h of ["Balance", "Running Balance", "Weight Difference", "Difference", "Loss (%)", "Drying Loss (%)", "Warehouse Site", "Created At"]) expect(all).not.toContain(h);
    // A receipt's status is worked out from where it has got to, so it isn't a column on Truck Reception.
    expect(headersOf(wb.getWorksheet("Truck Reception")!)).not.toContain("Status");
    expect(headersOf(wb.getWorksheet("Jute Bags")!)).toEqual(["Row ID", "No", "Date", "Date (as written)", "Activity Type", "Supplier Code", "Warehouse Location", "Truck No", "Warehouse Receipt No", "Bags Issued", "Bags Received"]);
  });

  it("still shows a hand-typed date that was never a real date, instead of leaving it blank", async () => {
    const wb = await load((await get("wi", "/api/workbook")).rawPayload);
    const ws = wb.getWorksheet("Activity Ledger")!;
    const written = colOf(ws, "Date (as written)");
    let shown = 0;
    for (let r = 2; r <= ws.rowCount; r++) if (ws.getRow(r).getCell(written).value) shown++;
    expect(shown).toBeGreaterThan(400); // 508 such rows in the real data
  });
});

// ── editing and adding ─────────────────────────────────────────────────────────────────────────────

describe("editing and adding through the workbook", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    await removeSentinels();
    await prisma.receipt.create({ data: { id: SENTINEL, source: "entered", arrivalDate: "2026-09-30", supplierName: "WB Supplier", lbaCode: "", vehicleNo: VEH + "OLD", warehouse: "BOUAKE" } });
    await setStageFields(SENTINEL, "n-gate", { "VEHICLE NO.": VEH + "OLD", REMARKS: "100" });
    await setStageFields(SENTINEL, "n-verify", { "SUPPLIERS NAME": "WB Supplier" });
    await setStageFields(SENTINEL, "n-grn", { PRICE: "100" });
  });
  afterAll(removeSentinels);

  it("one edited cell is exactly one change, named in plain words, and audited", async () => {
    const buf = await edited("wi", (wb) => {
      const ws = wb.getWorksheet("Truck Reception")!;
      setCell(ws, rowOf(ws, "Receipt ID", SENTINEL), "Remarks", "150");
    });
    const body = (await preview("wi", buf)).json();
    expect(sheetBody(body, "Truck Reception")).toMatchObject({ created: 0, changed: 1 });
    expect(sheetBody(body, "Truck Reception").samples[0].changes).toEqual([{ column: "Remarks", from: "100", to: "150" }]);
    expect(body.errorCount).toBe(0);

    expect((await commit("wi", body.token)).json()).toMatchObject({ totalUpdated: 1, totalCreated: 0 });
    const r = (await get("wi", `/api/receipts/${SENTINEL}`)).json();
    expect(r.stageData["n-gate"]["REMARKS"]).toBe("150");
    expect(await prisma.stageFieldChange.findFirst({ where: { receiptId: SENTINEL, via: "import" } })).toMatchObject({ label: "REMARKS", oldValue: "100", newValue: "150" });
    expect(r.timeline[r.timeline.length - 1].note).toMatch(/Updated from workbook/);
  });

  it("changing supplier name or truck no keeps the receipt and its stage in step", async () => {
    const buf = await edited("wi", (wb) => {
      const ws = wb.getWorksheet("Truck Reception")!;
      const row = rowOf(ws, "Receipt ID", SENTINEL);
      setCell(ws, row, "Supplier Name", "WB Supplier 2");
      setCell(ws, row, "Truck No", VEH + "NEW-TRUCK");
      setCell(ws, row, "Remarks", null); // and clearing a cell clears the value
    });
    const body = (await preview("wi", buf)).json();
    expect(sheetBody(body, "Truck Reception").changed).toBe(1);
    await commit("wi", body.token);
    const r = (await get("wi", `/api/receipts/${SENTINEL}`)).json();
    expect(r).toMatchObject({ supplierName: "WB Supplier 2", vehicleNo: VEH + "NEW-TRUCK" });
    expect(r.stageData["n-verify"]["SUPPLIERS NAME"]).toBe("WB Supplier 2");
    expect(r.stageData["n-gate"]["VEHICLE NO."]).toBe(VEH + "NEW-TRUCK");
    expect(r.stageData["n-gate"]["REMARKS"]).toBe("");
  });

  it("a blank Receipt ID adds a truck at the section's warehouse; Pass issues its Lot, a new origin is added", async () => {
    const buf = await edited("wi", (wb) => {
      addRow(wb.getWorksheet("Truck Reception")!, {
        "Truck No": VEH + "NEW", "Supplier Name": "WB New", "Remarks": "77",
        "Origin": "WBTEST-ORIGIN", "Quality Result": "Pass ",
      });
    });
    const body = (await preview("wi", buf)).json();
    expect(body.errorCount).toBe(0);
    expect(sheetBody(body, "Truck Reception")).toMatchObject({ created: 1, changed: 0 });
    expect((await commit("wi", body.token)).json().totalCreated).toBe(1);

    const made = await prisma.receipt.findFirstOrThrow({ where: { vehicleNo: VEH + "NEW" } });
    expect(made).toMatchObject({ source: "entered", warehouse: "BOUAKE", supplierName: "WB New", origin: "WBTEST-ORIGIN" });
    // Numbered by the system: the warehouse's code, then the year of the arrival date.
    expect(made.id).toMatch(/^REC-BKE-\d{4}-\d{4,}$/);
    const r = (await get("wi", `/api/receipts/${made.id}`)).json();
    expect(r.stageData["n-gate"]["REMARKS"]).toBe("77");
    expect(r.stageData["n-gate"]["VEHICLE NO."]).toBe(VEH + "NEW"); // the stage got it too
    // The Pass in the same row issued the Lot — nobody typed it.
    expect(r.lotNo).toMatch(/^LOT-BKE-\d{4}-\d{4,}$/);
    expect(r.branches["n-qfs"]).toBe("pass");
    expect(await prisma.stageFieldChange.count({ where: { receiptId: made.id, via: "import" } })).toBeGreaterThanOrEqual(4);
    expect(r.timeline[r.timeline.length - 1].note).toMatch(/Created from workbook/);
  });

  it("a new Warehouse Receiving row needs no site and no number: it gets this warehouse and the next No", async () => {
    const maxBefore = (await prisma.warehouseDischarge.aggregate({ _max: { sn: true } }))._max.sn!;
    const buf = await edited("wi", (wb) => {
      addRow(wb.getWorksheet("Warehouse Receiving")!, { "Lot No": "WBTEST-D1", "Fiche CCA No": "F-WB", "Gross Weight Received (kg)": "12.50", "Sample – KOR": "47.5" });
    });
    const p1 = (await preview("wi", buf)).json();
    expect(p1.errorCount).toBe(0);
    expect(sheetBody(p1, "Warehouse Receiving")).toMatchObject({ created: 1, changed: 0 });
    await commit("wi", p1.token);

    const row = await prisma.warehouseDischarge.findFirstOrThrow({ where: { lotNo: "WBTEST-D1" } });
    expect(row.warehouseSite).toBe("BOUAKE");
    expect(row.sn).toBe(maxBefore + 1);
    expect(String(row.grossWtRecd)).toBe("12.5");
    expect(String(row.samplingKor)).toBe("47.5");
    expect(row.source).toMatch(/^workbook: /); // honest provenance, not invented

    // editing a Decimal reads back exactly
    const edit = await edited("wi", (wb) => {
      const ws = wb.getWorksheet("Warehouse Receiving")!;
      setCell(ws, rowOf(ws, "Lot No", "WBTEST-D1"), "Gross Weight Received (kg)", "13.25");
    });
    const p2 = (await preview("wi", edit)).json();
    expect(sheetBody(p2, "Warehouse Receiving")).toMatchObject({ changed: 1, created: 0 });
    expect(sheetBody(p2, "Warehouse Receiving").samples[0].changes).toEqual([{ column: "Gross Weight Received (kg)", from: "12.5", to: "13.25" }]);
    await commit("wi", p2.token);
    expect(String((await prisma.warehouseDischarge.findUniqueOrThrow({ where: { id: row.id } })).grossWtRecd)).toBe("13.25");
  });

  it("a Stock Transfers row from Bouaké is 'from' this warehouse without being told", async () => {
    const buf = await edited("wi", (wb) => {
      addRow(wb.getWorksheet("Stock Transfers")!, { "Truck Registration": "WBTEST-TR", "Lot No": "WBTEST-9", "Bags Dispatched": 100 });
    });
    const body = (await preview("wi", buf)).json();
    expect(body.errorCount).toBe(0);
    await commit("wi", body.token);
    const t = await prisma.juteWarehouseTransferReceipt.findFirstOrThrow({ where: { truckRegistration: "WBTEST-TR" } });
    expect(t).toMatchObject({ sourceWarehouse: "BOUAKE", bagsDispatched: 100, destinationWarehouse: null });
    expect(t.sn).toBeGreaterThan(415);
  });

  it("matches sheet and column names whatever the case or spacing, and ignores columns it doesn't use", async () => {
    const buf = await edited("wi", (wb) => {
      wb.removeWorksheet(wb.getWorksheet("Suppliers")!.id);
      const ws = wb.addWorksheet("suppliers"); // lower case: still the Suppliers sheet
      ws.addRow(["SUPPLIER   code", "supplier name", "Notes To Self"]);
      ws.addRow(["WBTEST-SUP", "WB Supplier Co", "x"]);
    });
    const body = (await preview("wi", buf)).json();
    expect(sheetBody(body, "Suppliers")).toMatchObject({ created: 1 });
    expect(body.notices).toEqual(['Suppliers: "Notes To Self" isn\'t a column we use — ignored.']);
    expect(body.errorCount).toBe(0);
    await commit("wi", body.token);
    expect(await prisma.supplier.findUnique({ where: { code: "WBTEST-SUP" } })).toMatchObject({ name: "WB Supplier Co" });
  });

  it("a column left out of the file leaves that field alone, never blanks it", async () => {
    const buf = await edited("wi", (wb) => {
      const ws = wb.getWorksheet("Truck Reception")!;
      const c = colOf(ws, "Remarks");
      ws.spliceColumns(c, 1);
    });
    const body = (await preview("wi", buf)).json();
    expect(sheetBody(body, "Truck Reception")).toMatchObject({ created: 0, changed: 0, errorCount: 0 });
  });
});

// ── what a bad upload does ─────────────────────────────────────────────────────────────────────────

describe("what a bad upload does", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    await removeSentinels();
    await prisma.receipt.create({ data: { id: SENTINEL, source: "entered", arrivalDate: "2026-09-30", supplierName: "", lbaCode: "", vehicleNo: VEH + "ERR", warehouse: "BOUAKE" } });
    // Written the importers' way: a person can no longer type a Lot (the system issues it).
    await setStageFields(SENTINEL, "n-lot", { "Lot Number": "WBTEST-LOT-A" }, { bypassValidation: true });
  });
  afterAll(removeSentinels);

  /** Preview `fn`'s edit and return the errors; also prove nothing was written by trying to commit. */
  async function errorsOf(fn: (wb: ExcelJS.Workbook) => void, who = "wi") {
    const count = async () => [await prisma.receipt.count(), await prisma.warehouseDischarge.count(), await prisma.supplier.count(), await prisma.juteWarehouseTransferReceipt.count()];
    const before = await count();
    const body = (await preview(who, await edited(who, fn))).json();
    expect((await commit(who, body.token)).statusCode, "a plan with problems must not commit").toBe(422);
    expect(await count()).toEqual(before);
    return body.sheets.flatMap((s: any) => s.errors.map((e: any) => ({ sheet: s.name, ...e })));
  }

  it("refuses an unknown Receipt ID rather than quietly creating it", async () => {
    const errs = await errorsOf((wb) => { addRow(wb.getWorksheet("Truck Reception")!, { "Receipt ID": "REC-9999-9999", "Truck No": VEH + "X" }); });
    expect(errs).toEqual([expect.objectContaining({ sheet: "Truck Reception", column: "Receipt ID", message: expect.stringMatching(/unknown receipt id/) })]);
  });

  it("names the sheet, row and the column's own header for a bad date, a bad number and a missing value", async () => {
    const errs = await errorsOf((wb) => {
      const ws = wb.getWorksheet("Warehouse Receiving")!;
      addRow(ws, { "Lot No": "WBTEST-D2", "Fiche CCA No": "F", "Arrival Date": "30/09/2026", "Gross Weight Received (kg)": "44,94" });
      addRow(ws, { "Truck No": "WBTEST-NOLOT" }); // lot and fiche missing
    });
    const msgs = errs.map((e: any) => `${e.column}: ${e.message}`);
    expect(msgs.some((m: string) => /^Arrival Date: .*isn't a date/.test(m))).toBe(true);
    expect(msgs.some((m: string) => /^Gross Weight Received \(kg\): .*decimal point/.test(m))).toBe(true);
    expect(msgs).toEqual(expect.arrayContaining(["Lot No: is required", "Fiche CCA No: is required"]));
    expect(errs.every((e: any) => e.sheet === "Warehouse Receiving" && e.row > 1)).toBe(true);
    expect(JSON.stringify(errs)).not.toMatch(/[a-z][A-Z]\w*:|\./); // never a column key like arrivalDate or Table.column
  });

  it("refuses another warehouse's rows, whichever sheet they are on", async () => {
    // The FIRST Yakro receipt in export order: the preview shows only the first few errors per sheet,
    // and Yakro has hundreds of receipts, so an arbitrary one would fall outside what it shows.
    const yakro = await prisma.receipt.findFirstOrThrow({ where: { warehouse: "YAKRO FACTORY" }, orderBy: { createdAt: "asc" } });
    // Yakro's file, uploaded as Bouaké: its receipts and its receiving rows belong elsewhere.
    const buf = await edited("wiY", (wb) => {
      const t = wb.getWorksheet("Truck Reception")!;
      setCell(t, rowOf(t, "Receipt ID", yakro.id), "Supplier Name", "hijacked");
      const w = wb.getWorksheet("Warehouse Receiving")!;
      setCell(w, 2, "Origin", "hijacked");
    });
    const body = (await preview("wi", buf)).json();
    expect(sheetBody(body, "Truck Reception").errors).toEqual(expect.arrayContaining([expect.objectContaining({ column: "Receipt ID", message: `${yakro.id} belongs to another warehouse` })]));
    expect(sheetBody(body, "Warehouse Receiving").errors[0].message).toMatch(/belongs to another warehouse/);
    // the Yakro-only columns aren't Bouaké columns: said so, not silently dropped
    expect(body.notices.join(" | ")).toMatch(/Warehouse Receiving: .*Storage Area.* (aren't columns we use|isn't a column we use)/);
    expect((await commit("wi", body.token)).statusCode).toBe(422);
    expect((await prisma.receipt.findUniqueOrThrow({ where: { id: yakro.id } })).supplierName).not.toBe("hijacked");
  });

  it("applies the app's own rules: a lot can't be typed, a bin needs a lot, a fail needs a reason", async () => {
    const errs = await errorsOf((wb) => {
      const ws = wb.getWorksheet("Truck Reception")!;
      addRow(ws, { "Truck No": VEH + "L1", "Lot No": "WBTEST-LOT-A" });            // a Lot can't be typed at all
      addRow(ws, { "Truck No": VEH + "L2", "Bin No": "BIN-X" });                    // bin, no lot
      addRow(ws, { "Truck No": VEH + "L3", "Quality Result": "Fail" });             // fail, no reason
      addRow(ws, { "Truck No": VEH + "L4", "Quality Result": "maybe" });            // not a decision
    });
    const msgs = errs.map((e: any) => e.message).join(" | ");
    expect(msgs).toMatch(/issued by the system/);
    expect(msgs).toMatch(/Bin/i);
    expect(msgs).toMatch(/reason/i);
    expect(msgs).toMatch(/isn't a valid decision/);
  });

  it("checks suppliers and unique numbers before writing", async () => {
    const errs = await errorsOf((wb) => {
      addRow(wb.getWorksheet("Jute Bags")!, { "Activity Type": "ISSUE", "Supplier Code": "NO-SUCH-SUPPLIER", "Bags Issued": 5 });
      const ws = wb.getWorksheet("Stock Transfers")!;
      addRow(ws, { "No": 99010, "Truck Registration": "WBTEST-T1" });
      addRow(ws, { "No": 99010, "Truck Registration": "WBTEST-T2" });
    });
    expect(errs.some((e: any) => e.sheet === "Jute Bags" && e.column === "Supplier Code" && /isn't a known Supplier Code/.test(e.message))).toBe(true);
    expect(errs.some((e: any) => /No "99010" is also used by row/.test(e.message))).toBe(true);
    // and a number already used by a stored row
    const existing = await prisma.juteWarehouseTransferReceipt.findFirstOrThrow({ orderBy: { sn: "asc" } });
    const errs2 = await errorsOf((wb) => { addRow(wb.getWorksheet("Stock Transfers")!, { "No": existing.sn, "Truck Registration": "WBTEST-T3" }); });
    expect(errs2.some((e: any) => /No ".+" already exists on another row/.test(e.message))).toBe(true);
  });

  it("refuses a sheet with no id column, and a repeated id", async () => {
    const noKey = await preview("wi", await edited("wi", (wb) => { wb.getWorksheet("Suppliers")!.spliceColumns(1, 1); }));
    expect(sheetBody(noKey.json(), "Suppliers").errors[0].message).toBe('the "Supplier Code" column is missing');

    const dup = await preview("wi", await edited("wi", (wb) => {
      const ws = wb.getWorksheet("Truck Reception")!;
      addRow(ws, { "Receipt ID": String(ws.getRow(2).getCell(1).value) });
    }));
    expect(sheetBody(dup.json(), "Truck Reception").errors.some((e: any) => /appears more than once/.test(e.message))).toBe(true);
  });

  it("rejects a file that isn't a workbook, and says which sheets aren't ours or aren't this section's", async () => {
    expect((await preview("wi", Buffer.from("not a workbook"))).statusCode).toBe(422);
    const buf = await edited("wi", (wb) => {
      wb.addWorksheet("Mystery").addRow(["a"]);
      wb.addWorksheet("WarehouseDischarge").addRow(["id"]);       // the old technical name
      wb.addWorksheet("Issued to Production").addRow(["Row ID"]);  // Central only
    });
    const notices = (await preview("wi", buf)).json().notices.join(" | ");
    expect(notices).toMatch(/Sheet "Mystery" isn't one of our sheets/);
    expect(notices).toMatch(/Sheet "WarehouseDischarge" isn't one of our sheets/);
    expect(notices).toMatch(/Sheet "Issued to Production" isn't part of the Unit workbook/);
  });
});

// ── Unit vs Central, and who may use it ────────────────────────────────────────────────────────────

describe("Unit vs Central, and who may use it", { timeout: 60_000 }, () => {
  it("differ only in the sheets a section carries", async () => {
    const unit = await names("wi");
    const central = await names("wiY");
    expect(unit).toContain("Jute Bags");
    expect(unit).toContain("Dispatch");
    expect(unit).not.toContain("Issued to Production");
    expect(central).toContain("Issued to Production");
    expect(central).not.toContain("Jute Bags");
    expect(central).not.toContain("Dispatch");
    for (const shared of ["Truck Reception", "Warehouse Receiving", "Drying", "Stock Transfers", "Activity Ledger", "Suppliers"]) {
      expect(unit).toContain(shared); expect(central).toContain(shared);
    }
  });

  it("holds only the section's rows", async () => {
    const ws = (await load((await get("wi", "/api/workbook")).rawPayload)).getWorksheet("Truck Reception")!;
    const total = ws.rowCount - 1;
    const mine = (await get("wi", "/api/receipts")).json();
    expect(total).toBe(mine.length);
    const ids = new Set(mine.map((r: any) => r.id));
    for (let r = 2; r <= ws.rowCount; r++) expect(ids.has(String(ws.getRow(r).getCell(1).value))).toBe(true);
  });

  it("gives a sample with the same sheets and headers but no rows", async () => {
    const wb = await load((await get("wi", "/api/workbook/template")).rawPayload);
    const real = await load((await get("wi", "/api/workbook")).rawPayload);
    expect(wb.worksheets.map((w) => w.name)).toEqual(real.worksheets.map((w) => w.name));
    for (const ws of wb.worksheets) {
      expect(ws.rowCount, ws.name).toBe(1);
      expect(headersOf(ws), ws.name).toEqual(headersOf(real.getWorksheet(ws.name)!));
    }
  });

  it("names the file after its section, for the sample and for an export", async () => {
    const name = (res: { headers: Record<string, unknown> }) => /filename="([^"]+)"/.exec(String(res.headers["content-disposition"]))![1];
    const today = new Date().toISOString().slice(0, 10);
    expect(name(await get("wi", "/api/workbook/template"))).toBe("ANAGROCI - Unit Warehouse - Sample.xlsx");
    expect(name(await get("wiY", "/api/workbook/template"))).toBe("ANAGROCI - Central Warehouse - Sample.xlsx");
    expect(name(await get("wi", "/api/workbook"))).toBe(`ANAGROCI - Unit Warehouse - Export ${today}.xlsx`);
    expect(name(await get("wiY", "/api/workbook?from=2026-09-01&to=2026-09-30"))).toBe("ANAGROCI - Central Warehouse - Export 2026-09-01 to 2026-09-30.xlsx");
  });

  it("lists the section's sheets by their plain titles", async () => {
    const info = (await get("wi", "/api/workbook/info")).json();
    expect(info).toMatchObject({ warehouse: "BOUAKE", type: "UNIT" });
    expect(info.sheets.map((s: any) => s.name)).toEqual(sheetsFor("UNIT").map((s) => s.title));
    expect(info.sheets.find((s: any) => s.name === "Suppliers")).toMatchObject({ master: true, dateLabel: null });
  });

  it("lets a Warehouse Incharge use only their own warehouse, and nobody else in", async () => {
    expect((await get("wi", "/api/workbook?warehouse=YAKRO FACTORY")).statusCode).toBe(403);
    expect((await get("wiY", "/api/workbook?warehouse=BOUAKE")).statusCode).toBe(403);
    expect((await get("bm", "/api/workbook")).statusCode).toBe(403);
    expect((await get("bm", "/api/workbook/template")).statusCode).toBe(403);
    expect((await preview("bm", Buffer.from("x"))).statusCode).toBe(403);
    expect((await get(null, "/api/workbook")).statusCode).toBe(401);
  });

  it("makes an admin choose a warehouse, then gives that warehouse's section", async () => {
    expect((await get("admin", "/api/workbook")).statusCode).toBe(422);
    expect(await names("admin", "/api/workbook?warehouse=YAKRO FACTORY")).toContain("Issued to Production");
    expect(await names("admin", "/api/workbook?warehouse=BOUAKE")).toContain("Jute Bags");
    expect((await get("admin", "/api/workbook?warehouse=YAMOUSSOUKRO")).statusCode).toBe(422); // no Unit/Central type
  });

  it("narrows dated sheets to a date range and reports rows with no date", async () => {
    const all = (await get("wi", "/api/receipts")).json() as { arrivalDate: string }[];
    const inRange = all.filter((r) => r.arrivalDate >= "2026-09-01" && r.arrivalDate <= "2026-09-30").length;
    const res = await get("wi", "/api/workbook?from=2026-09-01&to=2026-09-30");
    const wb = await load(res.rawPayload);
    expect(wb.getWorksheet("Truck Reception")!.rowCount - 1).toBe(inRange);
    expect(String(res.headers["content-disposition"])).toContain("2026-09-01 to 2026-09-30");
    expect(Number(res.headers["x-rows-without-date"])).toBeGreaterThan(0); // ledger rows with only hand-typed dates
    expect((await get("wi", "/api/workbook?from=2026-09-30&to=2026-09-01")).statusCode).toBe(422);
    expect(wb.getWorksheet("Suppliers")!.rowCount - 1).toBe(await prisma.supplier.count()); // never date-filtered
  });
});
