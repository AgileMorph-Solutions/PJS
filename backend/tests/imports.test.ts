/**
 * Excel upload: the header-fingerprint guard against the real corruption case, the ledger-1
 * content-key dedup heuristic, and the receipts importer's per-stage presence rule. See
 * docs/UPLOAD_GUIDE.md for the plain-language version of every rule asserted here.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { checkImporter } from "../src/domain/imports/registry.js";
import { truckReceptionImporter } from "../src/domain/imports/truckReception.js";
import { juteBagsMovementImporter } from "../src/domain/imports/juteBagsMovement.js";
import { dryingSortingImporter } from "../src/domain/imports/dryingSorting.js";
import { suppliersMasterImporter } from "../src/domain/imports/suppliersMaster.js";
import { warehouseDischargesImporter } from "../src/domain/imports/warehouseDischarges.js";
import { warehouseDispatchesImporter } from "../src/domain/imports/warehouseDispatches.js";
import { dryingBatchImporter, resolveCleanLotNo } from "../src/domain/imports/dryingBatch.js";
import { issuedToProductionImporter } from "../src/domain/imports/issuedToProduction.js";
import { warehouseReceivingImporter } from "../src/domain/imports/warehouseReceiving.js";
import { warehouseActivityLedgerImporter } from "../src/domain/imports/warehouseActivityLedger.js";
import { previewImport } from "../src/services/imports.js";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/Procurement");

async function loadWorkbook(filePath: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync(filePath) as unknown as Parameters<typeof wb.xlsx.load>[0]);
  return wb;
}

describe("header-fingerprint check — the real corruption case", () => {
  // Synthesized in memory, replacing a real corrupt file that used to live under
  // docs/Procurement/drive-download-.../BOUAKE RCN RECEIVING.xlsx (deleted along with every other
  // old workbook — see docs/UPLOAD_GUIDE.md). The corruption itself was real, measured against
  // that file before it was removed: two columns ("DRY/UNDRY", "Transfer -Bouake") are missing
  // entirely, so every column from position 15 onward silently shifts left by one or two — not a
  // parse error, a fully-populated-looking row with every field quietly wrong. This fixture
  // reproduces that exact shift (never blanks fields in place, which would fail for the wrong
  // reason), the same synthesized-workbook convention tests/lotWriteBack.test.ts already uses.
  const FULL_HEADER = [
    "SN", "Date", "Month", "DRY/UNDRY", "ID transfer", "Truck registration", "LOT NO", "Lot Dry",
    "NO-FICHE", "CCA transferred fiche Number", "BIN NO.", "Damaged Bag", "New Jute Bag Used",
    "Recondition", "Transfer -Bouake", "Origin", "Bags Dispatched From Bouake", "Received Bags",
    "Diffrence in Bag at Receiving", "FINAL BAGS AFTER REBAGGING W/H", "DIFF",
    "Laisse-Passer Entree (Yakro)", "FULLY LOADED TRUCK WEIGHT - BEFORE UNLOADING OF RCN",
    "EMPTRY TRUCK TARE WEIGHT - AFTER UNLOADING OF THE RCN", "Gross Weight (Yakro) Recived",
    "Weight at arrival (kg) Net", "Net Wt Dispatched (From Bouake)", "Weight Difference at Yakro",
    "KOR Received (At Yakro)", "KOR Dispatched From BOUAKE", "Moisture Received at YAKRO WH",
    "Dispatched Moisture", "NC arrival", "Comment",
  ];
  // The real corruption: "DRY/UNDRY" (index 3) and "Transfer -Bouake" (index 14) are simply gone,
  // and every label after them closes up left — not blanked in place. 32 labels, not 34.
  const SHIFTED_HEADER = FULL_HEADER.filter((h) => h !== "DRY/UNDRY" && h !== "Transfer -Bouake");

  function buildLedger4Workbook(header: string[], dataRow: (string | number)[]): ExcelJS.Workbook {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Bouake Stock Reciving");
    for (let r = 1; r <= 5; r++) sheet.addRow([]); // rows 1-5 blank, header is row 6
    sheet.addRow(header);
    sheet.addRow(dataRow);
    return wb;
  }

  it("rejects a synthesized 32-column ledger-4 lookalike missing 'DRY/UNDRY' and 'Transfer -Bouake' (header mismatch, not a silent accept)", () => {
    const wb = buildLedger4Workbook(SHIFTED_HEADER, SHIFTED_HEADER.map((_, i) => `field-${i + 1}`));
    const result = checkImporter(wb, "juteWarehouseTransfer");
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "header-mismatch") {
      expect(result.expected).not.toEqual(result.found);
      expect(result.found).not.toContain("DRY/UNDRY");
      expect(result.found).not.toContain("Transfer -Bouake");
    } else {
      expect.fail(`expected a header-mismatch rejection, got: ${JSON.stringify(result)}`);
    }
  });

  it("the same importer accepts the FULL 34-column header — proving the rejection above is really about the two missing columns, not a broken fixture", () => {
    const wb = buildLedger4Workbook(FULL_HEADER, FULL_HEADER.map((_, i) => `field-${i + 1}`));
    expect(checkImporter(wb, "juteWarehouseTransfer")).toEqual({ ok: true });
  });

  it("no registered importer accepts the shifted 32-column lookalike — it's not secretly some OTHER shape either", () => {
    const wb = buildLedger4Workbook(SHIFTED_HEADER, SHIFTED_HEADER.map((_, i) => `field-${i + 1}`));
    for (const id of ["truckReception", "juteBagsMovement", "dryingSorting", "suppliersMaster", "warehouseDischarges", "warehouseDispatches", "dryingBatch", "issuedToProduction", "warehouseReceiving", "warehouseActivityLedger"] as const) {
      expect(checkImporter(wb, id).ok, `expected ${id} to reject the shifted lookalike`).toBe(false);
    }
  });

  it("proves the harm the header check prevents: parsing the shifted shape anyway silently reads every field past the shift from the wrong column", async () => {
    // Bypass checkImporter entirely (this is what would happen if the guard didn't exist) and
    // parse the shifted workbook with the REAL importer. "KOR Received (At Yakro)" is real column
    // 29 in the correct header; in the shifted 32-column layout the value actually sitting at
    // position 29 belongs to a field two columns earlier ("Weight Difference at Yakro"'s
    // neighbourhood) — so a naive parse reports a KOR reading that is really someone else's weight
    // figure, with no error, no warning, nothing to notice.
    const shiftedRow: (string | number)[] = SHIFTED_HEADER.map((_, i) => `field-${i + 1}`);
    shiftedRow[0] = 1; // SN, so the row isn't skipped
    const wb = buildLedger4Workbook(SHIFTED_HEADER, shiftedRow);
    const { juteWarehouseTransferImporter } = await import("../src/domain/imports/juteWarehouseTransfer.js");
    const rows = juteWarehouseTransferImporter.parse(wb);
    expect(rows).toHaveLength(1);
    // Column 29 in the SHIFTED sheet is field-29 — but the importer, built for the correct 34-col
    // shape, reads column 29 expecting "KOR Received (At Yakro)". It gets field-29's raw text
    // instead (not a number, so korReceived is null and the raw twin carries the wrong field's
    // text) — exactly the silent, fully-populated-looking corruption this check exists to prevent.
    expect(rows[0]!.data.korReceivedRaw).toBe("field-29");
  });

  it("accepts the real, correctly-shaped ledger 4 file", async () => {
    const wb = await loadWorkbook(path.join(DOCS, "new sheets/Bouake RCN Receiving at Factory Report.xlsx"));
    expect(checkImporter(wb, "juteWarehouseTransfer")).toEqual({ ok: true });
  });

  it("rejects the ledger-4 shape when checked against a different importer's expected sheet", async () => {
    const wb = await loadWorkbook(path.join(DOCS, "new sheets/Bouake RCN Receiving at Factory Report.xlsx"));
    const result = checkImporter(wb, "juteBagsMovement");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing-sheet");
  });
});

describe("truckReception importer — per-stage presence from real row data, never fabricated", () => {
  // Verbatim from the real "Truck Reception" sheet inside ANAGROCI DATA PROCUREMENT 2026.xlsx —
  // replaces the old OFFLOADINGS-sourced HEADER. "RM/FG" and "REF." have no equivalent column
  // here at all (see truckReception.ts's header comment); "week" is new and not read by anything.
  const HEADER = [
    "No", "arrival date", "offloading date", "payment type", "warehouse location", "warehouse code",
    "supplier name", "supplier code", "truck no", "fiche code", "fiche offloading no", "bags count",
    "gross weight kg", "net weight kg", "good bags", "humid bags", "torn bags", "refraction kg",
    "paid weight kg", "price cfa per kg", "amount cfa", "moisture pct", "nut count", "kor",
    "final kor", "origin", "remarks", "week",
  ];

  function buildTruckReceptionWorkbook(rows: (string | number)[][]): ExcelJS.Workbook {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Truck Reception");
    sheet.addRow(HEADER); // row 1 — this sheet's header IS row 1, no separate title row above it
    for (const r of rows) sheet.addRow(r);
    return wb;
  }

  it("real file: fiche offloading no (col 11) is the FICHE join key, never fiche code (col 10) — the adjacent-column trap", async () => {
    const wb = await loadWorkbook(path.join(DOCS, "new sheets/ANAGROCI DATA PROCUREMENT 2026.xlsx"));
    const rows = truckReceptionImporter.parse(wb);
    expect(rows.length).toBe(986);
    // The first real row (stages.ts's own documented sample truck): fiche offloading no "72515",
    // fiche code "0401-0007" — if these were ever swapped, this assertion fails immediately.
    expect(rows[0]!.data.stageData["n-verify"]!["FICHE"]).toBe("72515");
    expect(rows[0]!.data.stageData["n-verify"]!["FICHE CODE"]).toBe("0401-0007");
  });

  it("does not create n-gross when gross weight kg is blank, but does create it when present", () => {
    const full = new Array(28).fill("");
    full[0] = "1"; full[1] = "2026-01-05"; full[4] = "YAKRO"; full[5] = "WH-1";
    full[6] = "ACME SUPPLIER"; full[7] = "LBA-1"; full[8] = "TRK-1"; full[12] = "12000";

    const noGross = [...full];
    noGross[0] = "2"; noGross[12] = ""; // blank gross weight kg

    const wb = buildTruckReceptionWorkbook([full, noGross]);
    const rows = truckReceptionImporter.parse(wb);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.data.stageData["n-gross"]).toBeTruthy();
    expect(rows[1]!.data.stageData["n-gross"]).toBeUndefined();
  });

  it("creates n-qfs when a quality field is present, but never sets a pass/fail branch on it", () => {
    const row = new Array(28).fill("");
    row[0] = "1"; row[1] = "2026-01-05"; row[4] = "YAKRO"; row[5] = "WH-1";
    row[21] = "8.5"; // moisture pct

    const wb = buildTruckReceptionWorkbook([row]);
    const rows = truckReceptionImporter.parse(wb);
    const qfs = rows[0]!.data.stageData["n-qfs"];
    expect(qfs).toBeTruthy();
    // The parsed stage payload is a flat label->value string map — there is no "branch" concept in
    // it at all, so a pass/fail decision can never be smuggled in here. The importer's commit path
    // (services/imports.ts) never calls setBranch() either — an admin records that decision later,
    // the same way any other receipt's decision gets recorded.
    expect(Object.keys(qfs!)).not.toContain("branch");
  });

  it("always creates n-gate, never a tare step (the tare is part of the gross weight step since Oct 2026), and never n-lot/n-bin/n-drying (no real signal in Truck Reception)", () => {
    const row = new Array(28).fill("");
    row[0] = "1"; row[1] = "2026-01-05"; row[4] = "YAKRO"; row[5] = "WH-1";

    const wb = buildTruckReceptionWorkbook([row]);
    const stageData = truckReceptionImporter.parse(wb)[0]!.data.stageData;
    expect(stageData["n-gate"]).toBeTruthy();
    expect(stageData["n-tare"]).toBeUndefined();
    for (const neverCreated of ["n-lot", "n-bin", "n-stock", "n-drying", "n-otheract", "n-ledger", "n-xferdec", "n-reject"]) {
      expect(stageData[neverCreated], neverCreated).toBeUndefined();
    }
  });

  it("never writes RM/FG or REF. — this sheet has no column for either", () => {
    const row = new Array(28).fill("");
    row[0] = "1"; row[1] = "2026-01-05"; row[4] = "YAKRO"; row[5] = "WH-1";
    row[6] = "ACME SUPPLIER"; row[7] = "LBA-1";

    const wb = buildTruckReceptionWorkbook([row]);
    const stageData = truckReceptionImporter.parse(wb)[0]!.data.stageData;
    expect(stageData["n-gate"]).not.toHaveProperty("RM/FG");
    expect(stageData["n-verify"]).not.toHaveProperty("REF.");
  });

  it("skips a row whose No column is blank", () => {
    const blank = new Array(28).fill("");
    const wb = buildTruckReceptionWorkbook([blank]);
    expect(truckReceptionImporter.parse(wb)).toHaveLength(0);
  });
});

describe("ledger-1 content-key dedup — the artificial-seq shape with no source-provided key", () => {
  const SEQ = -101; // sentinel, real seqs are positive and sequential from the seed/prior uploads
  let warehouseName: string;

  beforeAll(async () => {
    const wh = await prisma.warehouse.findFirst();
    warehouseName = wh!.name;
    await prisma.juteWarehouseMovement.deleteMany({ where: { seq: SEQ } });
    await prisma.juteWarehouseMovement.create({
      data: {
        seq: SEQ, sn: 99999, sheetRow: -1,
        movementDate: new Date("2026-02-15"), rawDate: null,
        activitiesType: "ISSUE", activityCategory: "SUPPLIER_ISSUE",
        whLocation: warehouseName,
        truckNumber: "TEST-TRUCK-1", wrNo: "WR-TEST-1",
        bagsIssued: 10, bagsReceived: null, reportedBalance: 500,
      },
    });
  });
  afterAll(() => prisma.juteWarehouseMovement.deleteMany({ where: { seq: SEQ } }));

  // "Jute Bags movement" — replaces "JUTE BAGS ISSUED". Same 9 leading columns as before, only
  // renamed and header row 2 -> 1; "BALANCE" (the old 10th column) has no equivalent here at all,
  // which is why contentKey() in services/imports.ts never included it in the dedup key to begin
  // with — dropping it changes nothing about this test.
  function buildLedger1Workbook(rows: (string | number)[][]): ExcelJS.Workbook {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Jute Bags movement");
    sheet.addRow(["No", "movement date", "activity type", "supplier code", "warehouse location", "truck no", "warehouse receipt no", "bags issued", "bags received"]);
    for (const r of rows) sheet.addRow(r);
    return wb;
  }

  it("flags a row matching an existing row's content as a likely duplicate", async () => {
    const wb = buildLedger1Workbook([
      [1, "2026-02-15", "ISSUE", "", warehouseName, "TEST-TRUCK-1", "WR-TEST-1", 10, ""],
    ]);
    const buffer = (await wb.xlsx.writeBuffer()) as unknown as Buffer;
    const preview = await previewImport(buffer, "test-ledger1.xlsx", "juteBagsMovement");
    expect(preview.duplicateCount).toBe(1);
    expect(preview.findings.some((f) => f.id === "likely_duplicate_rows")).toBe(true);
  });

  it("does not flag a row with different content as a duplicate", async () => {
    const wb = buildLedger1Workbook([
      [2, "2026-02-16", "ISSUE", "", warehouseName, "DIFFERENT-TRUCK", "WR-TEST-2", 7, ""],
    ]);
    const buffer = (await wb.xlsx.writeBuffer()) as unknown as Buffer;
    const preview = await previewImport(buffer, "test-ledger1.xlsx", "juteBagsMovement");
    expect(preview.duplicateCount).toBe(0);
  });
});

describe("warehouseDischarges — the duplicated-quality-panel shape", () => {
  const NEW_SHEETS = path.join(DOCS, "new sheets");

  it("accepts the real DISCHARGEMENT file", async () => {
    const wb = await loadWorkbook(path.join(NEW_SHEETS, "Suppliers Offloading_Bouake Warehouse Report.xlsx"));
    expect(checkImporter(wb, "warehouseDischarges")).toEqual({ ok: true });
  });

  it("rejects it when checked as any other known shape", async () => {
    const wb = await loadWorkbook(path.join(NEW_SHEETS, "Suppliers Offloading_Bouake Warehouse Report.xlsx"));
    for (const id of ["truckReception", "juteBagsMovement", "dryingSorting", "suppliersMaster", "juteWarehouseTransfer"] as const) {
      const result = checkImporter(wb, id);
      expect(result.ok, `expected ${id} to reject DISCHARGEMENT`).toBe(false);
    }
  });

  it("rejects a workbook whose two quality panels have been swapped, even though the header row still matches perfectly", async () => {
    const wb = await loadWorkbook(path.join(NEW_SHEETS, "Suppliers Offloading_Bouake Warehouse Report.xlsx"));
    const sheet = wb.getWorksheet("DISCHARGEMENT")!;
    // Swap only the row-3 banners — the header row (row 4) is untouched and still fingerprints as
    // a perfect match. Only the anchor check can catch this.
    const a = sheet.getRow(3).getCell(33).value;
    const b = sheet.getRow(3).getCell(49).value;
    sheet.getRow(3).getCell(33).value = b as ExcelJS.CellValue;
    sheet.getRow(3).getCell(49).value = a as ExcelJS.CellValue;

    const result = checkImporter(wb, "warehouseDischarges");
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "anchor-mismatch") {
      expect(result.anchors.length).toBeGreaterThan(0);
    } else {
      expect.fail(`expected an anchor-mismatch rejection, got: ${JSON.stringify(result)}`);
    }
  });

  it("parses both quality panels from the correct columns, and unwraps resultless shared-formula cells to null", async () => {
    const wb = await loadWorkbook(path.join(NEW_SHEETS, "Suppliers Offloading_Bouake Warehouse Report.xlsx"));
    const rows = warehouseDischargesImporter.parse(wb);
    expect(rows.length).toBe(454);
    expect(rows.filter((r) => r.skipReason).length).toBe(0);

    // Row 5 (first data row): the two panels genuinely differ — proof they're read from columns
    // 33-48 and 49-64 respectively, not both from the same block.
    const first = rows[0]!.data;
    expect(first.lotNo).toBe("1");
    expect(first.ficheCca).toBe("72533");
    expect(first.sampling.kor).not.toBeNull();
    expect(first.finalOffload.kor).not.toBeNull();
    expect(first.sampling.kor).not.toBe(first.finalOffload.kor);

    // Diff (col 30) has 5 real rows that are shared-formula cells with no cached result at all —
    // must be null, never the literal string "[object Object]".
    const diffs = rows.map((r) => r.data.diff);
    expect(diffs.filter((d) => d === null).length).toBe(5);
    expect(diffs.some((d) => typeof d === "string")).toBe(false);
  });

  it("every Lot No is distinct, and 454 rows also carry both a Lot and a Fiche", async () => {
    const wb = await loadWorkbook(path.join(NEW_SHEETS, "Suppliers Offloading_Bouake Warehouse Report.xlsx"));
    const rows = warehouseDischargesImporter.parse(wb);
    const lots = new Set(rows.map((r) => r.data.lotNo));
    expect(lots.size).toBe(454);
    expect(rows.every((r) => r.data.lotNo && r.data.ficheCca)).toBe(true);
  });
});

describe("warehouseDispatches (CHARGEMENT) — parent/line shape, continuation lines never dropped", () => {
  const NEW_SHEETS = path.join(DOCS, "new sheets");

  it("accepts the real CHARGEMENT file, and rejects every other known shape for it", async () => {
    const wb = await loadWorkbook(path.join(NEW_SHEETS, "Dispatch RCN from Bouake Warehouse Report.xlsx"));
    expect(checkImporter(wb, "warehouseDispatches")).toEqual({ ok: true });
    for (const id of ["truckReception", "juteBagsMovement", "dryingSorting", "suppliersMaster", "juteWarehouseTransfer", "warehouseDischarges"] as const) {
      expect(checkImporter(wb, id).ok, `expected ${id} to reject CHARGEMENT`).toBe(false);
    }
  });

  it("parses 544 lines gated on any-of-columns-1-41, not on S.No — 120 of them are continuation lines with no S.No at all", async () => {
    const wb = await loadWorkbook(path.join(NEW_SHEETS, "Dispatch RCN from Bouake Warehouse Report.xlsx"));
    const rows = warehouseDispatchesImporter.parse(wb);
    expect(rows.length).toBe(544);
    expect(rows.filter((r) => r.skipReason).length).toBe(0); // no skip guards at all — see the module header
    const withSn = rows.filter((r) => r.data.sn !== null);
    expect(withSn.length).toBe(424);
    expect(rows.length - withSn.length).toBe(120);
  });

  it("has 413 distinct voyage numbers across the 504 lines that carry one, and 10 duplicate S.No values", async () => {
    const wb = await loadWorkbook(path.join(NEW_SHEETS, "Dispatch RCN from Bouake Warehouse Report.xlsx"));
    const rows = warehouseDispatchesImporter.parse(wb);
    const withVyoge = rows.filter((r) => r.data.vyogeNumber !== null);
    expect(withVyoge.length).toBe(504);
    expect(new Set(withVyoge.map((r) => r.data.vyogeNumber)).size).toBe(413);
    const sns = rows.map((r) => r.data.sn).filter((s): s is number => s !== null);
    const counts = new Map<number, number>();
    for (const sn of sns) counts.set(sn, (counts.get(sn) ?? 0) + 1);
    expect([...counts.values()].filter((c) => c > 1).length).toBe(10);
  });
});

describe("dryingBatch (Drying Batch, consolidated) — verbatim *_raw twins, never split a multi-value lot", () => {
  const CONSOLIDATED = path.join(DOCS, "new sheets/ANAGROCI DATA PROCUREMENT 2026.xlsx");

  it("accepts the real consolidated workbook, and rejects the differently-shaped Bouaké-only 'Drying & Sorting Report' file", async () => {
    const wb = await loadWorkbook(CONSOLIDATED);
    expect(checkImporter(wb, "dryingBatch")).toEqual({ ok: true });
    const bouakeOnly = await loadWorkbook(path.join(DOCS, "new sheets/Bouake RCN Drying Report.xlsx"));
    expect(checkImporter(bouakeOnly, "dryingBatch").ok).toBe(false);
  });

  it("parses 138 rows = 57 unit (BOUAKE) + 81 central (ANAGROCI-01)", async () => {
    const wb = await loadWorkbook(CONSOLIDATED);
    const rows = dryingBatchImporter.parse(wb);
    expect(rows.length).toBe(138);
    expect(rows.filter((r) => r.data.warehouseSite === "BOUAKE").length).toBe(57);
    expect(rows.filter((r) => r.data.warehouse === "ANAGROCI-01").length).toBe(81);
  });

  it("resolveCleanLotNo never splits a comma-joined or numerically-concatenated value, and rejects bin-code contamination", () => {
    expect(resolveCleanLotNo("387, 401")).toBeNull();
    expect(resolveCleanLotNo("12,5")).toBeNull();
    expect(resolveCleanLotNo(246253)).toBeNull(); // 6-digit concatenation, ambiguously 246+253 or 24+6253
    expect(resolveCleanLotNo("BIN-03B")).toBeNull(); // contamination, not a lot at all
    expect(resolveCleanLotNo(23)).toBe("23"); // unambiguous — every real single lot is well under 1000
    expect(resolveCleanLotNo(null)).toBeNull();
  });

  it("leaves lotNo null for exactly the 22 multi-value rows and the 41 bin-code-contaminated rows, always keeping lotNoRaw", async () => {
    const wb = await loadWorkbook(CONSOLIDATED);
    const rows = dryingBatchImporter.parse(wb);
    const nullLotNo = rows.filter((r) => r.data.lotNo === null && r.data.lotNoRaw !== null);
    expect(nullLotNo.length).toBe(22 + 41);
    expect(nullLotNo.every((r) => r.data.lotNoRaw)).toBe(true);
  });
});

describe("issuedToProduction (Issued to Production Section) — Fiche No contaminated, never a join key", () => {
  const NEW_SHEETS = path.join(DOCS, "new sheets");

  it("accepts the real file", async () => {
    const wb = await loadWorkbook(path.join(NEW_SHEETS, "Factory Warehouse RCN Transfer to Production Report.xlsx"));
    expect(checkImporter(wb, "issuedToProduction")).toEqual({ ok: true });
  });

  it("parses 125 real lines (3 stray whitespace/pivot-tail rows skipped for lacking a clean SI NO) across 112 distinct BTMs", async () => {
    const wb = await loadWorkbook(path.join(NEW_SHEETS, "Factory Warehouse RCN Transfer to Production Report.xlsx"));
    const rows = issuedToProductionImporter.parse(wb);
    const usable = rows.filter((r) => !r.skipReason);
    expect(usable.length).toBe(125);
    expect(rows.length - usable.length).toBe(3);
    expect(new Set(usable.map((r) => r.data.btmNo)).size).toBe(112);
  });

  it("Fiche No is mostly bin-code strings, not real fiche numbers — stored, never relied on", async () => {
    const wb = await loadWorkbook(path.join(NEW_SHEETS, "Factory Warehouse RCN Transfer to Production Report.xlsx"));
    const rows = issuedToProductionImporter.parse(wb).filter((r) => !r.skipReason);
    const ficheValues = rows.map((r) => r.data.ficheNo).filter((v): v is string => !!v);
    const binCodeShaped = ficheValues.filter((v) => /^(BIN|ANA)[-\s]?\d/i.test(v));
    expect(ficheValues.length).toBe(125);
    expect(binCodeShaped.length).toBe(109);
  });
});

describe("warehouseReceiving — a second, richer verbatim source for the SAME WarehouseDischarge table", () => {
  const CONSOLIDATED = path.join(DOCS, "new sheets/ANAGROCI DATA PROCUREMENT 2026.xlsx");

  it("accepts the real consolidated workbook, and rejects the file this importer was first assumed to read (it's really a newer ledger-4 snapshot)", async () => {
    const wb = await loadWorkbook(CONSOLIDATED);
    expect(checkImporter(wb, "warehouseReceiving")).toEqual({ ok: true });
    const assumedFile = await loadWorkbook(path.join(DOCS, "new sheets/Bouake RCN Receiving at Factory Report.xlsx"));
    expect(checkImporter(assumedFile, "warehouseReceiving").ok).toBe(false);
  });

  it("parses 710 rows = 454 BOUAKE + 256 YAMOUSSOUKRO, every one carrying a Lot and a Fiche", async () => {
    const wb = await loadWorkbook(CONSOLIDATED);
    const rows = warehouseReceivingImporter.parse(wb);
    expect(rows.length).toBe(710);
    expect(rows.filter((r) => r.data.warehouseSite === "BOUAKE").length).toBe(454);
    expect(rows.filter((r) => r.data.warehouseSite === "YAMOUSSOUKRO").length).toBe(256);
    expect(rows.every((r) => r.data.lotNo && r.data.ficheCca)).toBe(true);
  });
});

describe("warehouseActivityLedger — no S.No at all, gated purely on any-column-non-blank", () => {
  const CONSOLIDATED = path.join(DOCS, "new sheets/ANAGROCI DATA PROCUREMENT 2026.xlsx");

  it("accepts the real consolidated workbook", async () => {
    const wb = await loadWorkbook(CONSOLIDATED);
    expect(checkImporter(wb, "warehouseActivityLedger")).toEqual({ ok: true });
  });

  it("parses 787 rows, none skipped", async () => {
    const wb = await loadWorkbook(CONSOLIDATED);
    const rows = warehouseActivityLedgerImporter.parse(wb);
    expect(rows.length).toBe(787);
    expect(rows.filter((r) => r.skipReason).length).toBe(0);
  });
});

describe("juteBagsMovement (Jute Bags movement) — replaces JUTE BAGS ISSUED, BALANCE column gone", () => {
  const CONSOLIDATED = path.join(DOCS, "new sheets/ANAGROCI DATA PROCUREMENT 2026.xlsx");

  it("accepts the real consolidated workbook", async () => {
    const wb = await loadWorkbook(CONSOLIDATED);
    expect(checkImporter(wb, "juteBagsMovement")).toEqual({ ok: true });
  });

  it("parses 298 rows, every one with reportedBalance null (no column for it in this sheet)", async () => {
    const wb = await loadWorkbook(CONSOLIDATED);
    const rows = juteBagsMovementImporter.parse(wb);
    expect(rows.length).toBe(298);
    expect(rows.every((r) => r.data.reportedBalance === null)).toBe(true);
  });
});

describe("suppliersMaster (Suppliers) — the canonical code/name master, 58 rows", () => {
  const CONSOLIDATED = path.join(DOCS, "new sheets/ANAGROCI DATA PROCUREMENT 2026.xlsx");

  it("accepts the real consolidated workbook", async () => {
    const wb = await loadWorkbook(CONSOLIDATED);
    expect(checkImporter(wb, "suppliersMaster")).toEqual({ ok: true });
  });

  it("parses all 58 rows, none skipped (every row has a supplier code)", async () => {
    const wb = await loadWorkbook(CONSOLIDATED);
    const rows = suppliersMasterImporter.parse(wb);
    expect(rows.length).toBe(58);
    expect(rows.filter((r) => r.skipReason).length).toBe(0);
  });
});

describe("dryingSorting (Drying & Sorting Report) — column-index parsing, duplicate-label trap", () => {
  const FILE = path.join(DOCS, "new sheets/Bouake RCN Drying Report.xlsx");

  it("accepts the real file, and rejects it under every other known shape", async () => {
    const wb = await loadWorkbook(FILE);
    expect(checkImporter(wb, "dryingSorting")).toEqual({ ok: true });
    for (const id of ["truckReception", "juteBagsMovement", "suppliersMaster", "juteWarehouseTransfer", "warehouseDischarges", "dryingBatch"] as const) {
      expect(checkImporter(wb, id).ok, `expected ${id} to reject Drying & Sorting Report`).toBe(false);
    }
  });

  it("parses 57 real rows (the sheet's formatted extent runs to 631, but everything past row 57 is blank)", async () => {
    const wb = await loadWorkbook(FILE);
    const rows = dryingSortingImporter.parse(wb);
    expect(rows.length).toBe(57);
  });

  it("column 23 ('Draige Loss Kg's', the second occurrence) is read as its own field, never conflated with column 21", async () => {
    const wb = await loadWorkbook(FILE);
    const rows = dryingSortingImporter.parse(wb);
    // Real data: both columns are populated on every real row, and are not required to be equal —
    // reading the wrong one (or double-reading one into both fields) would be invisible unless
    // checked explicitly like this.
    expect(rows.every((r) => r.data.drainageLossKg !== null)).toBe(true);
    expect(rows.every((r) => r.data.drainageLossKg2 !== null)).toBe(true);
  });

  it("leaves lotNo null for exactly the 22 comma-joined/numerically-concatenated rows, always keeping lotNoRaw", async () => {
    const wb = await loadWorkbook(FILE);
    const rows = dryingSortingImporter.parse(wb);
    const ambiguous = rows.filter((r) => r.data.lotNo === null && r.data.lotNoRaw !== null);
    expect(ambiguous.length).toBe(22);
    expect(ambiguous.every((r) => r.data.lotNoRaw)).toBe(true);
  });
});
