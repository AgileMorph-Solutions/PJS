/**
 * Unit-warehouse dispatch OUT — sheet "CHARGEMENT", header row 4, data from row 5. See
 * WarehouseDispatchLine's own schema.prisma comment for the full measured shape.
 *
 * THE THING THIS PARSER MUST NOT DO: gate on S.No. Measured on the real file: 544 data lines pass
 * "any of columns 1-41 non-blank", but only 424 of those carry a clean S.No — the other 120 are
 * CONTINUATION lines (one dispatch/voyage drew from more than one source bin, so it gets more than
 * one line, and only the first carries the voyage's full header fields). Gating on S.No the way
 * offloadings.ts/drying.ts do would silently drop those 120 real lines.
 */
import type ExcelJS from "exceljs";
import type { ImporterDef, ParsedRow } from "./types.js";
import { num, dec, text, dateParts, isBlankRow } from "./xlsxHelpers.js";

export interface QualityPanelFlat {
  browns: number | null;
  voids: number | null;
  oil: number | null;
  totDefect: number | null;
  goodKernel: number | null;
  immature: number | null;
  spotted: number | null;
  totKernels: number | null;
  kor: number | null;
  shot: number | null;
  fot: number | null;
  usefulKernelsYield: number | null;
  totalYield: number | null;
  moisture: number | null;
  nc: number | null;
  shell: number | null;
}

export interface WarehouseDispatchLineRow {
  sn: number | null;
  chargeDate: string | null;
  chargeDateRaw: string | null;
  warehouseSite: string | null;
  vyogeNumber: string | null;
  remark: string | null;
  scaleLocation: string | null;
  warehouse: string | null;
  whOrDirect: string | null;
  bin: string | null;
  origin: string | null;
  truckNo: string | null;
  transporter: string | null;
  driver: string | null;
  phone: string | null;
  whReceiptNo: string | null;
  ficheCca: string | null;
  binwiseLoadedBags: number | null;
  totalBags: number | null;
  grossWt: number | null;
  netWeight: number | null;
  status: string | null;
  unloadingStatus: string | null;
  panel: QualityPanelFlat;
  bagsYakro: number | null;
  grossYakro: number | null;
  differenceWeight: number | null;
}

const SHEET = "CHARGEMENT";
const HEADER_ROW = 4;
const CHECK_PREFIX = 41;

const PANEL_LABELS = [
  "BROWNS/Rejection(gm)", "VOIDS(gm)", "OIL(gm)", "TOTDEFECT", "GoodKernel(gm)", "Immature(gm)",
  "Spotted(gm)", "TOTKERNELSgm", "KOR", "SHOT", "FOT", "UsefulKernelsYield%", "TotalYield%",
  "Moisture", "NC", "Shell(gm)",
];

// Verbatim from the real workbook, trimmed. Columns 42-45 exist but are blank in the header row
// (a trailing-blank-formatted-columns tail, same case warehouseDischarges.ts documents) — the
// fingerprint stops at 41.
const HEADER = [
  "S.No.", "ChargeDate", "Warehouse/Site", "VYOGE NUMBER", "REMARK", "SCALE LOCATION", "Warehouse",
  "WH OR DIRECT", "BIN", "Origin", "TruckNo.", "TRANSPORTER", "DRIVER", "PHONE", "W/HReceiptNo.",
  "No.FicheCCA", "BINWISE LOADED BAGS", "TotalBAGS", "GrossWt", "NetWeight", "STATUS",
  "UNLOADING STATUS",
  ...PANEL_LABELS,
  "BAGS YAKRO", "GROSS YAKRO", "DIFFERENCE WEIGHT",
];

const PANEL_START = 23; // "BROWNS/Rejection(gm)" is column 23 (1-based)

function readPanel(row: ExcelJS.Row, startCol: number): QualityPanelFlat {
  const at = (offset: number) => dec(row.getCell(startCol + offset));
  return {
    browns: at(0), voids: at(1), oil: at(2), totDefect: at(3), goodKernel: at(4), immature: at(5),
    spotted: at(6), totKernels: at(7), kor: at(8), shot: at(9), fot: at(10),
    usefulKernelsYield: at(11), totalYield: at(12), moisture: at(13), nc: at(14), shell: at(15),
  };
}

function parse(workbook: ExcelJS.Workbook): ParsedRow<WarehouseDispatchLineRow>[] {
  const sheet = workbook.getWorksheet(SHEET)!;
  const out: ParsedRow<WarehouseDispatchLineRow>[] = [];

  for (let r = HEADER_ROW + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    // The one and only gate: any of columns 1-41 non-blank. NOT "does this row have an S.No" —
    // see this file's header comment for why that would silently drop 120 real continuation lines.
    if (isBlankRow(row, CHECK_PREFIX)) continue;

    const charge = dateParts(row.getCell(2));

    const data: WarehouseDispatchLineRow = {
      sn: num(row.getCell(1)),
      chargeDate: charge.iso,
      chargeDateRaw: charge.raw,
      warehouseSite: text(row.getCell(3)),
      vyogeNumber: text(row.getCell(4)),
      remark: text(row.getCell(5)),
      scaleLocation: text(row.getCell(6)),
      warehouse: text(row.getCell(7)),
      whOrDirect: text(row.getCell(8)),
      bin: text(row.getCell(9)),
      origin: text(row.getCell(10)),
      truckNo: text(row.getCell(11)),
      transporter: text(row.getCell(12)),
      driver: text(row.getCell(13)),
      phone: text(row.getCell(14)),
      whReceiptNo: text(row.getCell(15)),
      ficheCca: text(row.getCell(16)),
      binwiseLoadedBags: num(row.getCell(17)),
      totalBags: num(row.getCell(18)),
      grossWt: dec(row.getCell(19)),
      netWeight: dec(row.getCell(20)),
      status: text(row.getCell(21)),
      unloadingStatus: text(row.getCell(22)),
      panel: readPanel(row, PANEL_START),
      bagsYakro: num(row.getCell(39)),
      grossYakro: dec(row.getCell(40)),
      differenceWeight: dec(row.getCell(41)),
    };

    // No skip guards at all: every one of the 544 gated-in lines is written. A continuation line
    // legitimately has no S.No, no VYOGE NUMBER (40/544 lines, gated-in ones too), no Fiche — none
    // of that makes it a bad row, since this importer does no write-back that would need any of them.
    out.push({ sheetRow: r, data });
  }
  return out;
}

export const warehouseDispatchesImporter: ImporterDef<WarehouseDispatchLineRow> = {
  id: "warehouseDispatches",
  label: "Unit-warehouse dispatch out (CHARGEMENT)",
  exampleFilename: "Dispatch RCN from Bouake Warehouse Report.xlsx",
  expectedSheet: SHEET,
  headerRow: HEADER_ROW,
  expectedHeader: HEADER,
  checkHeaderPrefix: CHECK_PREFIX,
  parse,
};
