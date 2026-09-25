/**
 * Warehouse Receiving — sheet "Warehouse Receiving", header row 1, data from row 2, in
 * ANAGROCI DATA PROCUREMENT 2026.xlsx. Measured 710 rows = 454 BOUAKE + 256 YAMOUSSOUKRO. See
 * WarehouseDischarge's own schema.prisma comment (the "verbatim-only fields from a SECOND, richer
 * source" block) for the field-reuse-vs-new-column reasoning.
 *
 * NOTE the source-file correction: docs/Procurement/new sheets/"Bouake RCN Receiving at Factory
 * Report.xlsx" — the file this importer was originally assumed to read — was opened and checked
 * directly first. Its one sheet is named "Bouake Stock Reciving" and its header (row 6, 34 columns)
 * is byte-for-byte the EXISTING ledger-4 shape (juteWarehouseTransfer.ts) with more rows (467, not
 * 415) — a newer snapshot of that sheet, not this one. It needs no new importer; the existing one
 * already matches it. This importer's real source is the consolidated workbook instead, verified by
 * its measured row/column counts (710 rows, 83 columns, 454/256 site split) matching the plan
 * exactly.
 *
 * VERBATIM ONLY. This importer's commit function (services/imports.ts) must never call
 * writeLotsOntoReceipts() — that lot write-back is warehouseDischarges.ts's job alone, and calling
 * it again here for a sheet that reuses the SAME (warehouseSite, lotNo) pairs on 454/710 rows would
 * be redundant at best and a silent re-assignment risk at worst.
 */
import type ExcelJS from "exceljs";
import type { ImporterDef, ParsedRow } from "./types.js";
import { num, dec, text, dateParts, isBlankRow } from "./xlsxHelpers.js";

export interface QualityPanelQ1 {
  rejectionG: number | null;
  voidG: number | null;
  oilG: number | null;
  totalDefectG: number | null;
  goodKernelG: number | null;
  immatureG: number | null;
  spottedG: number | null;
  totalKernelsG: number | null;
  kor: number | null;
  murli: number | null;
  shot: number | null;
  fot: number | null;
  usefulKernelYieldPct: number | null;
  totalYieldPct: number | null;
  moisturePct: number | null;
  nutCount: number | null;
  shellG: number | null;
}

export interface QualityPanelQ2 {
  rejectionG: number | null;
  murliTotalPct: number | null;
  voidG: number | null;
  oilG: number | null;
  totalDefectG: number | null;
  goodKernelG: number | null;
  immatureG: number | null;
  spottedG: number | null;
  totalKernelsG: number | null;
  kor: number | null;
  murli: number | null;
  afterDryKor: number | null;
  shot: number | null;
  fot: number | null;
  usefulKernelYieldPct: number | null;
  totalYieldPct: number | null;
  moisturePct: number | null;
  nutCount: number | null;
  shellG: number | null;
}

export interface WarehouseReceivingRow {
  sn: number;
  warehouseSite: string;
  warehouse: string | null;
  initialBinNo: string | null;
  afterDryingBinNo: string | null;
  lotNo: string;
  lotDry: string | null;
  deliveryNoteNo: string | null;
  scaleLocation: string | null;
  whReceiptNo: string | null;
  ficheDateRaw: string | null;
  activity: string | null;
  ccakValidated: string | null;
  storageArea: string | null;
  ficheCca: string;
  truckNo: string | null;
  arrivalDate: string | null;
  arrivalDateRaw: string | null;
  dischargeDate: string | null;
  dischargeDateRaw: string | null;
  origin: string | null;
  supplierName: string | null;
  ccaNo: string | null;
  supplierCode: string | null;
  goodBagsOffloaded: number | null;
  damagedBagsOffloaded: number | null;
  totalBagsDischarged: number | null;
  reconditionBags: number | null;
  totalBagsStock: number | null;
  newBagsUsedRecondition: number | null;
  bonSacs: number | null;
  humidSacs: number | null;
  tornSacs: number | null;
  reconditionFlag: number | null;
  reconditionedBags: number | null;
  totalSacsLot: number | null;
  sacsExports: number | null;
  sacsBio: number | null;
  sacsBrousses: number | null;
  totalRecd: number | null;
  grossWtRecd: number | null;
  totalRefraction: number | null;
  grnQty: number | null;
  weightPaid: number | null;
  netWeight: number | null;
  weightDifferenceKg: number | null;
  netWeightBookKg: number | null;
  grnFreshQty: number | null;
  grnDriedQty: number | null;
  q1: QualityPanelQ1;
  q2: QualityPanelQ2;
}

const SHEET = "Warehouse Receiving";
const HEADER_ROW = 1;
const CHECK_PREFIX = 83;

const HEADER = [
  "No", "warehouse site", "warehouse", "initial bin no", "after drying bin no", "lot no", "lot dry",
  "delivery note no", "scale location", "warehouse receipt no", "fiche date", "activity",
  "ccak validated", "storage area", "fiche cca no", "truck no", "arrival date", "discharge date",
  "origin", "supplier name", "cca no", "supplier code", "good bags offloaded",
  "damaged bags offloaded", "total bags discharged", "recondition bags", "total bags stock",
  "new bags used recondition", "good bags", "humid bags", "torn bags", "recondition flag",
  "reconditioned bags", "total bags lot", "export bags", "bio bags", "brousse bags",
  "total received bags", "gross weight kg", "total refraction kg", "grn qty kg", "paid weight kg",
  "net weight kg", "weight difference kg", "net weight book kg", "grn fresh qty kg",
  "grn dried qty kg", "q1 rejection g", "q1 void g", "q1 oil g", "q1 total defect g",
  "q1 good kernel g", "q1 immature g", "q1 spotted g", "q1 total kernels g", "q1 kor", "q1 murli",
  "q1 shot", "q1 fot", "q1 useful kernel yield pct", "q1 total yield pct", "q1 moisture pct",
  "q1 nut count", "q1 shell g", "q2 rejection g", "q2 murli total pct", "q2 void g", "q2 oil g",
  "q2 total defect g", "q2 good kernel g", "q2 immature g", "q2 spotted g", "q2 total kernels g",
  "q2 kor", "q2 murli", "q2 after dry kor", "q2 shot", "q2 fot", "q2 useful kernel yield pct",
  "q2 total yield pct", "q2 moisture pct", "q2 nut count", "q2 shell g",
];

function parse(workbook: ExcelJS.Workbook): ParsedRow<WarehouseReceivingRow>[] {
  const sheet = workbook.getWorksheet(SHEET)!;
  const out: ParsedRow<WarehouseReceivingRow>[] = [];

  for (let r = HEADER_ROW + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (isBlankRow(row, CHECK_PREFIX)) continue;

    const sn = num(row.getCell(1));
    const warehouseSite = text(row.getCell(2));
    const lotNo = text(row.getCell(6)) ?? "";
    const ficheCca = text(row.getCell(15)) ?? "";
    const arrival = dateParts(row.getCell(17));
    const discharge = dateParts(row.getCell(18));

    const data: WarehouseReceivingRow = {
      sn: sn ?? 0,
      warehouseSite: warehouseSite ?? "",
      warehouse: text(row.getCell(3)),
      initialBinNo: text(row.getCell(4)),
      afterDryingBinNo: text(row.getCell(5)),
      lotNo,
      lotDry: text(row.getCell(7)),
      deliveryNoteNo: text(row.getCell(8)),
      scaleLocation: text(row.getCell(9)),
      whReceiptNo: text(row.getCell(10)),
      ficheDateRaw: text(row.getCell(11)),
      activity: text(row.getCell(12)),
      ccakValidated: text(row.getCell(13)),
      storageArea: text(row.getCell(14)),
      ficheCca,
      truckNo: text(row.getCell(16)),
      arrivalDate: arrival.iso, arrivalDateRaw: arrival.raw,
      dischargeDate: discharge.iso, dischargeDateRaw: discharge.raw,
      origin: text(row.getCell(19)),
      supplierName: text(row.getCell(20)),
      ccaNo: text(row.getCell(21)),
      supplierCode: text(row.getCell(22)),
      goodBagsOffloaded: num(row.getCell(23)),
      damagedBagsOffloaded: num(row.getCell(24)),
      totalBagsDischarged: num(row.getCell(25)),
      reconditionBags: num(row.getCell(26)),
      totalBagsStock: num(row.getCell(27)),
      newBagsUsedRecondition: num(row.getCell(28)),
      bonSacs: num(row.getCell(29)),
      humidSacs: num(row.getCell(30)),
      tornSacs: num(row.getCell(31)),
      reconditionFlag: num(row.getCell(32)),
      reconditionedBags: num(row.getCell(33)),
      totalSacsLot: num(row.getCell(34)),
      sacsExports: num(row.getCell(35)),
      sacsBio: num(row.getCell(36)),
      sacsBrousses: num(row.getCell(37)),
      totalRecd: num(row.getCell(38)),
      grossWtRecd: dec(row.getCell(39)),
      totalRefraction: dec(row.getCell(40)),
      grnQty: dec(row.getCell(41)),
      weightPaid: dec(row.getCell(42)),
      netWeight: dec(row.getCell(43)),
      weightDifferenceKg: dec(row.getCell(44)),
      netWeightBookKg: dec(row.getCell(45)),
      grnFreshQty: dec(row.getCell(46)),
      grnDriedQty: dec(row.getCell(47)),
      q1: {
        rejectionG: dec(row.getCell(48)), voidG: dec(row.getCell(49)), oilG: dec(row.getCell(50)),
        totalDefectG: dec(row.getCell(51)), goodKernelG: dec(row.getCell(52)),
        immatureG: dec(row.getCell(53)), spottedG: dec(row.getCell(54)),
        totalKernelsG: dec(row.getCell(55)), kor: dec(row.getCell(56)), murli: dec(row.getCell(57)),
        shot: dec(row.getCell(58)), fot: dec(row.getCell(59)),
        usefulKernelYieldPct: dec(row.getCell(60)), totalYieldPct: dec(row.getCell(61)),
        moisturePct: dec(row.getCell(62)), nutCount: dec(row.getCell(63)), shellG: dec(row.getCell(64)),
      },
      q2: {
        rejectionG: dec(row.getCell(65)), murliTotalPct: dec(row.getCell(66)),
        voidG: dec(row.getCell(67)), oilG: dec(row.getCell(68)), totalDefectG: dec(row.getCell(69)),
        goodKernelG: dec(row.getCell(70)), immatureG: dec(row.getCell(71)),
        spottedG: dec(row.getCell(72)), totalKernelsG: dec(row.getCell(73)),
        kor: dec(row.getCell(74)), murli: dec(row.getCell(75)), afterDryKor: dec(row.getCell(76)),
        shot: dec(row.getCell(77)), fot: dec(row.getCell(78)),
        usefulKernelYieldPct: dec(row.getCell(79)), totalYieldPct: dec(row.getCell(80)),
        moisturePct: dec(row.getCell(81)), nutCount: dec(row.getCell(82)), shellG: dec(row.getCell(83)),
      },
    };

    // Same three guards as warehouseDischarges.ts, for the same reasons — this table's real key is
    // (warehouseSite, lotNo), and ficheCca is the only bridge back to a Receipt (even though this
    // importer never uses it to write one).
    const skipReason = sn === null
      ? "no S.No — this sheet's own row-order key"
      : !lotNo
        ? "no Lot Number — this table's own key"
        : !ficheCca
          ? "no Fiche — nothing to match a receipt on"
          : !warehouseSite?.trim()
            ? "no Warehouse/Site — this sheet's Lot Number is only unique together with its site"
            : undefined;

    out.push(skipReason ? { sheetRow: r, data, skipReason } : { sheetRow: r, data });
  }
  return out;
}

export const warehouseReceivingImporter: ImporterDef<WarehouseReceivingRow> = {
  id: "warehouseReceiving",
  label: "Warehouse Receiving (verbatim, both sites)",
  exampleFilename: "ANAGROCI DATA PROCUREMENT 2026.xlsx",
  expectedSheet: SHEET,
  headerRow: HEADER_ROW,
  expectedHeader: HEADER,
  checkHeaderPrefix: CHECK_PREFIX,
  parse,
};
