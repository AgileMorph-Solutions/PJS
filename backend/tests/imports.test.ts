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
import { offloadingsImporter } from "../src/domain/imports/offloadings.js";
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
  it("rejects the real 33-column 'BOUAKE RCN RECEIVING.xlsx' as ledger 4 (header mismatch, not a silent accept)", async () => {
    const wb = await loadWorkbook(path.join(DOCS, "drive-download-20260903T100404Z-1-001/BOUAKE RCN RECEIVING.xlsx"));
    const result = checkImporter(wb, "juteWarehouseTransfer");
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "header-mismatch") {
      // The known real difference: this file is missing "DRY/UNDRY" and "Transfer -Bouake".
      expect(result.expected).not.toEqual(result.found);
    } else {
      expect.fail(`expected a header-mismatch rejection, got: ${JSON.stringify(result)}`);
    }
  });

  it("accepts the real, correctly-shaped ledger 4 file", async () => {
    const wb = await loadWorkbook(path.join(DOCS, "BOUAKE RCN RECEIVING at Yamoussoukro as on 9.9.2026.xlsx"));
    expect(checkImporter(wb, "juteWarehouseTransfer")).toEqual({ ok: true });
  });

  it("rejects the ledger-4 shape when checked against a different importer's expected sheet", async () => {
    const wb = await loadWorkbook(path.join(DOCS, "BOUAKE RCN RECEIVING at Yamoussoukro as on 9.9.2026.xlsx"));
    const result = checkImporter(wb, "juteWarehouseStock");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing-sheet");
  });
});

describe("receipts importer — per-stage presence from real row data, never fabricated", () => {
  const HEADER = [
    "S N", "DATE OF ARRIVAL", "DATE OF OFFLOADING", "RM/FG", "CREDIT/CASH", "WH LOCATION", "WH NO.",
    "SUPPLIERS NAME", "LBA CODE", "VEHICLE NO.", "FICHE CODE", "REF.", "FICHE", "SACS",
    "GROSS WT KGS", "NET WT KGS", "BON SACS", "HUMID SACS", "Sacs déchirés", "Refraction", "PAID WT",
    "PRICE", "AMOUNT", "MOIS.", "NUT COUNT", "KOR", "FINAL KOR", "ORIGIN", "REMARKS",
  ];

  function buildOffloadingsWorkbook(rows: (string | number)[][]): ExcelJS.Workbook {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("OFFLOADINGS");
    sheet.addRow([]); // row 1: title/blank, matching the real sheet's header-at-row-2 shape
    sheet.addRow(HEADER); // row 2
    for (const r of rows) sheet.addRow(r);
    return wb;
  }

  it("does not create n-gross when GROSS WT KGS is blank, but does create it when present", () => {
    const full = new Array(29).fill("");
    full[0] = "1"; full[1] = "2026-01-05"; full[5] = "YAKRO"; full[6] = "WH-1";
    full[7] = "ACME SUPPLIER"; full[8] = "LBA-1"; full[9] = "TRK-1"; full[14] = "12000";

    const noGross = [...full];
    noGross[0] = "2"; noGross[14] = ""; // blank GROSS WT KGS

    const wb = buildOffloadingsWorkbook([full, noGross]);
    const rows = offloadingsImporter.parse(wb);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.data.stageData["n-gross"]).toBeTruthy();
    expect(rows[1]!.data.stageData["n-gross"]).toBeUndefined();
  });

  it("creates n-qfs when a quality field is present, but never sets a pass/fail branch on it", () => {
    const row = new Array(29).fill("");
    row[0] = "1"; row[1] = "2026-01-05"; row[5] = "YAKRO"; row[6] = "WH-1";
    row[23] = "8.5"; // MOIS.

    const wb = buildOffloadingsWorkbook([row]);
    const rows = offloadingsImporter.parse(wb);
    const qfs = rows[0]!.data.stageData["n-qfs"];
    expect(qfs).toBeTruthy();
    // The parsed stage payload is a flat label->value string map — there is no "branch" concept in
    // it at all, so a pass/fail decision can never be smuggled in here. The importer's commit path
    // (services/imports.ts) never calls setBranch() either — an admin records that decision later,
    // the same way any other receipt's decision gets recorded.
    expect(Object.keys(qfs!)).not.toContain("branch");
  });

  it("always creates n-gate and present-but-empty n-tare, and never n-lot/n-bin/n-drying (no real signal in OFFLOADINGS)", () => {
    const row = new Array(29).fill("");
    row[0] = "1"; row[1] = "2026-01-05"; row[5] = "YAKRO"; row[6] = "WH-1";

    const wb = buildOffloadingsWorkbook([row]);
    const stageData = offloadingsImporter.parse(wb)[0]!.data.stageData;
    expect(stageData["n-gate"]).toBeTruthy();
    expect(stageData["n-tare"]).toEqual({ "Tare / empty truck weight (kg)": "" });
    for (const neverCreated of ["n-lot", "n-bin", "n-stock", "n-drying", "n-otheract", "n-ledger", "n-xferdec", "n-reject"]) {
      expect(stageData[neverCreated], neverCreated).toBeUndefined();
    }
  });

  it("skips a row whose S N column is blank or literally 'S N' (a repeated header/title row)", () => {
    const blank = new Array(29).fill("");
    const titleRow = new Array(29).fill("");
    titleRow[0] = "S N";
    const wb = buildOffloadingsWorkbook([blank, titleRow]);
    expect(offloadingsImporter.parse(wb)).toHaveLength(0);
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

  function buildLedger1Workbook(rows: (string | number)[][]): ExcelJS.Workbook {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("JUTE BAGS ISSUED");
    sheet.addRow([]);
    sheet.addRow(["S N", "DATE", "ACTIVITIES TYPE", "SUPPLIER CODE", "WH LOCATION", "TRUCK NUMBER", "W/R NO.", "BAGS ISSUED", "BAGS RECEIVED", "BALANCE"]);
    for (const r of rows) sheet.addRow(r);
    return wb;
  }

  it("flags a row matching an existing row's content as a likely duplicate", async () => {
    const wb = buildLedger1Workbook([
      [1, "2026-02-15", "ISSUE", "", warehouseName, "TEST-TRUCK-1", "WR-TEST-1", 10, "", 500],
    ]);
    const buffer = (await wb.xlsx.writeBuffer()) as unknown as Buffer;
    const preview = await previewImport(buffer, "test-ledger1.xlsx", "juteWarehouseStock");
    expect(preview.duplicateCount).toBe(1);
    expect(preview.findings.some((f) => f.id === "likely_duplicate_rows")).toBe(true);
  });

  it("does not flag a row with different content as a duplicate", async () => {
    const wb = buildLedger1Workbook([
      [2, "2026-02-16", "ISSUE", "", warehouseName, "DIFFERENT-TRUCK", "WR-TEST-2", 7, "", 493],
    ]);
    const buffer = (await wb.xlsx.writeBuffer()) as unknown as Buffer;
    const preview = await previewImport(buffer, "test-ledger1.xlsx", "juteWarehouseStock");
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
    for (const id of ["receipts", "dryingJobs", "juteWarehouseStock", "juteWarehouseTransfer"] as const) {
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
    for (const id of ["receipts", "dryingJobs", "juteWarehouseStock", "juteWarehouseTransfer", "warehouseDischarges"] as const) {
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
  const CONSOLIDATED = path.join(DOCS, "ANAGROCI DATA PROCUREMENT 2026.xlsx");

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
  const CONSOLIDATED = path.join(DOCS, "ANAGROCI DATA PROCUREMENT 2026.xlsx");

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
  const CONSOLIDATED = path.join(DOCS, "ANAGROCI DATA PROCUREMENT 2026.xlsx");

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
