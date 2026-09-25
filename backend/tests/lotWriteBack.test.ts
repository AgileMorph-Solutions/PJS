/**
 * The Lot write-back the warehouseDischarges importer does on commit: matching a discharge row to
 * a receipt by FICHE and writing the sheet's own Lot Number onto it. See
 * backend/src/services/receiptLinks.ts and docs/UPLOAD_GUIDE.md's "The Lot write-back" section for
 * the reasoning (Sept 2026 client call: Lot, not FICHE, is what the client tracks a batch by).
 *
 * The real file exercises three of the four conflict rules cleanly (see tests/imports.test.ts and
 * the coverage numbers in docs/UPLOAD_GUIDE.md) but never produces a genuine "lot already held by a
 * DIFFERENT receipt" conflict — that needs a synthetic fixture to prove the rule actually fires
 * rather than being dead code.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { previewImport, commitImport } from "../src/services/imports.js";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

// Verbatim DISCHARGEMENT shape — mirrors warehouseDischargesImporter's private HEADER/PANEL_LABELS,
// duplicated here rather than imported since they're intentionally private to that module (same
// convention tests/imports.test.ts already uses for OFFLOADINGS/ledger-1's synthetic workbooks).
const PANEL_LABELS = [
  "BROWNS/Rejection (gm)", "VOIDS (gm)", "OIL (gm)", "TOT DEFECT", "Good Kernel (gm)",
  "Immature (gm)", "Spotted (gm)", "TOT KERNELS gm", "KOR", "SHOT", "FOT",
  "Useful Kernels Yield %", "Total Yield %", "Moisture", "NC", "Shell (gm)",
];
const HEADER = [
  "S. No.", "Warehouse  / Site", "Warehouse", "UNLOADING BIN", "AFTER DRYING BIN", "Lot No",
  "SCALE LOCATION", "W/H Receipt No.", "No. Fiche CCA", "Truck No.", "Arrival Date",
  "Discharge Date", "Origin", "Supplier Name", "Supplier's Code", "Bon Sacs", "Humid Sacs",
  "Sacs déchirés", "Recon Sacs", "Total Sacs/lot", "sacs exports", "sacs bio", "sacs brousses",
  "Total Recd", "Gross Wt Recd", "Total Refraction (On Gross Wt)", "GRN qt(kg)", "Weight Paid",
  "Net Weight", "Diff", "GRN FRESH qty(kg)", "GRN dried qty(kg)",
  ...PANEL_LABELS, ...PANEL_LABELS,
];

function buildDischargeWorkbook(rows: { sn: number; lot: string; fiche: string; warehouse: string }[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("DISCHARGEMENT");
  sheet.addRow([]); // row 1
  sheet.addRow([]); // row 2
  const banner = new Array(64).fill("");
  banner[32] = "Detailed Quality Information ------------------------------------- (Sampling Report)";
  banner[48] = "Detailed Quality Information ------------------------------------- (Final Offloading Report)";
  sheet.addRow(banner); // row 3 — the anchors
  sheet.addRow(HEADER); // row 4
  for (const r of rows) {
    const row = new Array(64).fill("");
    // Column B ("Warehouse / Site", idx 1) is what the parser's skip-guard requires — a blank here
    // means the row is dropped before write-back ever runs. Column C (the store, idx 2) is left
    // blank: it's untested here and irrelevant to the four conflict rules under test.
    row[0] = r.sn; row[1] = r.warehouse; row[5] = r.lot; row[8] = r.fiche;
    sheet.addRow(row);
  }
  return wb;
}

async function commitDischarges(rows: { sn: number; lot: string; fiche: string; warehouse: string }[], filename: string) {
  const wb = buildDischargeWorkbook(rows);
  const buffer = (await wb.xlsx.writeBuffer()) as unknown as Buffer;
  const preview = await previewImport(buffer, filename, "warehouseDischarges");
  return commitImport(preview.token, { skipFlagged: true });
}

describe("Lot write-back — the four conflict rules", () => {
  const RECEIPT_A = "REC-LOTWRITEBACK-TEST-A";
  const RECEIPT_B = "REC-LOTWRITEBACK-TEST-B";
  // A receipt for the ambiguous-fiche test — ambiguity has to be checked against a fiche that DOES
  // resolve to a receipt (mirrors the real data: fiche 82130 matches a real receipt AND appears
  // twice in the sheet). An unmatched-and-duplicated fiche reports as unmatched, by design — there
  // is no receipt to be ambiguous about — so this needs its own receipt, distinct from A and B.
  const RECEIPT_D = "REC-LOTWRITEBACK-TEST-D";
  let warehouseName: string;

  beforeAll(async () => {
    const wh = await prisma.warehouse.findFirst();
    warehouseName = wh!.name;
    for (const id of [RECEIPT_A, RECEIPT_B, RECEIPT_D]) {
      await prisma.receipt.deleteMany({ where: { id } });
      await prisma.receipt.create({
        data: { id, source: "entered", arrivalDate: "2026-01-01", supplierName: "", lbaCode: "", vehicleNo: "", warehouse: warehouseName },
      });
    }
    await prisma.stageVerifyDocs.create({ data: { receiptId: RECEIPT_A, fiche: "LWB-FICHE-A" } });
    await prisma.stageVerifyDocs.create({ data: { receiptId: RECEIPT_B, fiche: "LWB-FICHE-B" } });
    await prisma.stageVerifyDocs.create({ data: { receiptId: RECEIPT_D, fiche: "LWB-FICHE-DUP" } });
    await prisma.warehouseDischarge.deleteMany({ where: { lotNo: { startsWith: "LWB-" } } });
  });
  afterAll(async () => {
    await prisma.warehouseDischarge.deleteMany({ where: { lotNo: { startsWith: "LWB-" } } });
    for (const id of [RECEIPT_A, RECEIPT_B, RECEIPT_D]) await prisma.receipt.deleteMany({ where: { id } });
  });

  it("writes the Lot onto the matching receipt", async () => {
    const result = await commitDischarges(
      [{ sn: 1, lot: "LWB-100", fiche: "LWB-FICHE-A", warehouse: warehouseName }],
      "lwb-write.xlsx"
    );
    expect(result.lotWriteBack).toMatchObject({ written: 1, skippedUnmatched: 0, skippedAmbiguous: 0, skippedConflict: 0 });
    const row = await prisma.stageLotAssignment.findUnique({ where: { receiptId: RECEIPT_A } });
    expect(row?.lotNumber).toBe("LWB-100");
    expect(row?.warehouseName).toBe(warehouseName);
  });

  it("re-committing the identical row is a no-op (idempotent re-upload)", async () => {
    const result = await commitDischarges(
      [{ sn: 1, lot: "LWB-100", fiche: "LWB-FICHE-A", warehouse: warehouseName }],
      "lwb-write.xlsx"
    );
    expect(result.lotWriteBack).toMatchObject({ written: 0, skippedConflict: 0 });
  });

  it("skips a fiche that matches no receipt, and reports it", async () => {
    const result = await commitDischarges(
      [{ sn: 2, lot: "LWB-200", fiche: "LWB-FICHE-NOWHERE", warehouse: warehouseName }],
      "lwb-unmatched.xlsx"
    );
    expect(result.lotWriteBack).toMatchObject({ written: 0, skippedUnmatched: 1, skippedAmbiguous: 0, skippedConflict: 0 });
  });

  it("skips both rows when the same fiche appears twice in one upload (ambiguous)", async () => {
    const result = await commitDischarges(
      [
        { sn: 3, lot: "LWB-300", fiche: "LWB-FICHE-DUP", warehouse: warehouseName },
        { sn: 4, lot: "LWB-301", fiche: "LWB-FICHE-DUP", warehouse: warehouseName },
      ],
      "lwb-ambiguous.xlsx"
    );
    expect(result.lotWriteBack).toMatchObject({ written: 0, skippedAmbiguous: 2, skippedConflict: 0 });
    const d = await prisma.stageLotAssignment.findUnique({ where: { receiptId: RECEIPT_D } });
    expect(d?.lotNumber ?? null).toBeNull(); // neither of the two ambiguous rows won
  });

  it("refuses to move a lot onto a different receipt when that lot is already held", async () => {
    // Receipt A already holds LWB-100 (written above). Receipt B's fiche now claims the SAME lot,
    // in the same warehouse — this must be refused and reported, never silently reassigned.
    const result = await commitDischarges(
      [{ sn: 5, lot: "LWB-100", fiche: "LWB-FICHE-B", warehouse: warehouseName }],
      "lwb-conflict.xlsx"
    );
    expect(result.lotWriteBack).toMatchObject({ written: 0, skippedUnmatched: 0, skippedAmbiguous: 0, skippedConflict: 1 });

    const [a, b] = await Promise.all([
      prisma.stageLotAssignment.findUnique({ where: { receiptId: RECEIPT_A } }),
      prisma.stageLotAssignment.findUnique({ where: { receiptId: RECEIPT_B } }),
    ]);
    expect(a?.lotNumber).toBe("LWB-100"); // unchanged — the conflict didn't move it
    expect(b?.lotNumber ?? null).toBeNull(); // B never got a lot
  });

  it("the same lot IS assignable in a DIFFERENT warehouse — uniqueness is per warehouse, not global", async () => {
    const other = await prisma.warehouse.findFirst({ where: { name: { not: warehouseName } } });
    if (!other) return; // only one warehouse seeded in this environment — nothing to prove here
    await prisma.receipt.deleteMany({ where: { id: "REC-LOTWRITEBACK-TEST-C" } });
    await prisma.receipt.create({
      data: { id: "REC-LOTWRITEBACK-TEST-C", source: "entered", arrivalDate: "2026-01-01", supplierName: "", lbaCode: "", vehicleNo: "", warehouse: other.name },
    });
    await prisma.stageVerifyDocs.create({ data: { receiptId: "REC-LOTWRITEBACK-TEST-C", fiche: "LWB-FICHE-C" } });
    try {
      // Deliberately the SAME lot value ("LWB-100") receipt A already holds — that's the point.
      // WarehouseDischarge's own storage key is (warehouseSite, lotNo), scoped to THIS fixture's
      // "LWB-write.xlsx"-style site value (unrelated to receipt.warehouse, which is what the Lot
      // WRITE-BACK below actually scopes by) — so its own createMany({skipDuplicates}) harmlessly
      // stores or skips this row independent of what's under test here.
      const result = await commitDischarges(
        [{ sn: 6, lot: "LWB-100", fiche: "LWB-FICHE-C", warehouse: other.name }],
        "lwb-other-warehouse.xlsx"
      );
      expect(result.lotWriteBack).toMatchObject({ written: 1, skippedConflict: 0 });
      const c = await prisma.stageLotAssignment.findUnique({ where: { receiptId: "REC-LOTWRITEBACK-TEST-C" } });
      expect(c?.lotNumber).toBe("LWB-100");
      expect(c?.warehouseName).toBe(other.name);
    } finally {
      await prisma.receipt.deleteMany({ where: { id: "REC-LOTWRITEBACK-TEST-C" } });
    }
  });
});
