/**
 * Unit-warehouse offloading — sheet "DISCHARGEMENT", header row 4, data from row 5.
 *
 * This is the sheet where a Lot Number is ASSIGNED, which makes it the bridge the rest of the app
 * was missing: OFFLOADINGS (the receipts sheet) has no Lot column at all, so until this importer
 * existed every imported receipt had none. Measured on the real file: 454 rows, 454 distinct lots,
 * zero duplicates, and every row also carrying the arrival fiche — a clean 1:1 bridge from the
 * fiche namespace into the real lot namespace. See docs/UPLOAD_GUIDE.md.
 *
 * TWO THINGS THIS PARSER DOES DIFFERENTLY, both forced by the sheet:
 *
 * 1. It keys off COLUMN INDEX, never label. Columns 33-48 and 49-64 repeat the SAME 16 quality
 *    labels; a label->column map would silently collapse the two panels into one. The only thing
 *    telling them apart is the row-3 banner over each block, which is why `expectedAnchors` pins
 *    those two banners — without them a workbook with the panels swapped would fingerprint as a
 *    perfect match and every quality reading would be filed under the wrong sampling pass.
 * 2. It does NOT map anything onto receipt stages here. The lot write-back happens at commit time
 *    (services/imports.ts), because it needs the database to resolve fiche -> receipt.
 */
import type ExcelJS from "exceljs";
import type { ImporterDef, ParsedRow } from "./types.js";
import { num, dec, text, dateParts, isBlankRow } from "./xlsxHelpers.js";

/** One of the two quality panels. Identical shape both times — read through `readPanel()` so the
 * duplication stays structural rather than copy-pasted. */
export interface QualityPanel {
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

export interface WarehouseDischargeRow {
  sn: number;
  warehouseSite: string | null;
  warehouse: string | null;
  unloadingBin: string | null;
  afterDryingBin: string | null;
  /** The sheet's own key — unique across all 454 rows. */
  lotNo: string;
  scaleLocation: string | null;
  whReceiptNo: string | null;
  /** The bridge back to a Receipt. Two real rows carry two slash-joined fiches ("69883/69881");
   * kept exactly as written, because the receipts sheet carries the same joined value. */
  ficheCca: string;
  truckNo: string | null;
  arrivalDate: string | null;
  arrivalDateRaw: string | null;
  dischargeDate: string | null;
  dischargeDateRaw: string | null;
  origin: string | null;
  supplierName: string | null;
  supplierCode: string | null;
  bonSacs: number | null;
  humidSacs: number | null;
  tornSacs: number | null;
  reconSacs: number | null;
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
  diff: number | null;
  grnFreshQty: number | null;
  grnDriedQty: number | null;
  sampling: QualityPanel;
  finalOffload: QualityPanel;
}

const SHEET = "DISCHARGEMENT";
const HEADER_ROW = 4;

/** The 16 quality labels, appearing verbatim at columns 33-48 AND again at 49-64. */
const PANEL_LABELS = [
  "BROWNS/Rejection (gm)", "VOIDS (gm)", "OIL (gm)", "TOT DEFECT", "Good Kernel (gm)",
  "Immature (gm)", "Spotted (gm)", "TOT KERNELS gm", "KOR", "SHOT", "FOT",
  "Useful Kernels Yield %", "Total Yield %", "Moisture", "NC", "Shell (gm)",
];

// Verbatim from the real workbook as readHeaderRow()/text() produce it — i.e. trimmed. Note
// "Warehouse  / Site" keeps its internal double space; that is really in the sheet.
const HEADER = [
  "S. No.", "Warehouse  / Site", "Warehouse", "UNLOADING BIN", "AFTER DRYING BIN", "Lot No",
  "SCALE LOCATION", "W/H Receipt No.", "No. Fiche CCA", "Truck No.", "Arrival Date",
  "Discharge Date", "Origin", "Supplier Name", "Supplier's Code", "Bon Sacs", "Humid Sacs",
  "Sacs déchirés", "Recon Sacs", "Total Sacs/lot", "sacs exports", "sacs bio", "sacs brousses",
  "Total Recd", "Gross Wt Recd", "Total Refraction (On Gross Wt)", "GRN qt(kg)", "Weight Paid",
  "Net Weight", "Diff", "GRN FRESH qty(kg)", "GRN dried qty(kg)",
  ...PANEL_LABELS,
  ...PANEL_LABELS,
];

/** Columns 65-67 exist in the sheet but are blank in the header — the "real trailing
 * blank-formatted columns" case types.ts documents, so the fingerprint stops at 64. */
const CHECK_PREFIX = 64;

const SAMPLING_START = 33;
const FINAL_OFFLOAD_START = 49;

function readPanel(row: ExcelJS.Row, startCol: number): QualityPanel {
  const at = (offset: number) => dec(row.getCell(startCol + offset));
  return {
    browns: at(0), voids: at(1), oil: at(2), totDefect: at(3), goodKernel: at(4), immature: at(5),
    spotted: at(6), totKernels: at(7), kor: at(8), shot: at(9), fot: at(10),
    usefulKernelsYield: at(11), totalYield: at(12), moisture: at(13), nc: at(14), shell: at(15),
  };
}

function parse(workbook: ExcelJS.Workbook): ParsedRow<WarehouseDischargeRow>[] {
  const sheet = workbook.getWorksheet(SHEET)!;
  const out: ParsedRow<WarehouseDischargeRow>[] = [];

  for (let r = HEADER_ROW + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (isBlankRow(row, CHECK_PREFIX)) continue;

    const sn = num(row.getCell(1));
    // A repeated header band or a summary tail has no clean S. No. — same skip rule the other
    // importers use on their own first column.
    if (sn === null) continue;

    const lotNo = text(row.getCell(6)) ?? "";
    const ficheCca = text(row.getCell(9)) ?? "";
    const arrival = dateParts(row.getCell(11));
    const discharge = dateParts(row.getCell(12));

    const data: WarehouseDischargeRow = {
      sn,
      warehouseSite: text(row.getCell(2)),
      warehouse: text(row.getCell(3)),
      unloadingBin: text(row.getCell(4)),
      afterDryingBin: text(row.getCell(5)),
      lotNo,
      scaleLocation: text(row.getCell(7)),
      whReceiptNo: text(row.getCell(8)),
      ficheCca,
      truckNo: text(row.getCell(10)),
      arrivalDate: arrival.iso,
      arrivalDateRaw: arrival.raw,
      dischargeDate: discharge.iso,
      dischargeDateRaw: discharge.raw,
      origin: text(row.getCell(13)),
      supplierName: text(row.getCell(14)),
      supplierCode: text(row.getCell(15)),
      bonSacs: num(row.getCell(16)),
      humidSacs: num(row.getCell(17)),
      tornSacs: num(row.getCell(18)),
      reconSacs: num(row.getCell(19)),
      totalSacsLot: num(row.getCell(20)),
      sacsExports: num(row.getCell(21)),
      sacsBio: num(row.getCell(22)),
      sacsBrousses: num(row.getCell(23)),
      totalRecd: num(row.getCell(24)),
      grossWtRecd: dec(row.getCell(25)),
      totalRefraction: dec(row.getCell(26)),
      grnQty: dec(row.getCell(27)),
      weightPaid: dec(row.getCell(28)),
      netWeight: dec(row.getCell(29)),
      diff: dec(row.getCell(30)),
      grnFreshQty: dec(row.getCell(31)),
      grnDriedQty: dec(row.getCell(32)),
      sampling: readPanel(row, SAMPLING_START),
      finalOffload: readPanel(row, FINAL_OFFLOAD_START),
    };

    // All three are guards rather than filters — 0 rows hit any of them on the real file. A row
    // without a Lot can't do this sheet's one job; without a fiche it has no way back to a
    // receipt; without a site its Lot isn't even unique (WarehouseDischarge's real key is
    // (warehouseSite, lotNo) — a lot number alone collides across sites, see that model's comment).
    const skipReason = !lotNo
      ? "no Lot Number — this sheet's own key"
      : !ficheCca
        ? "no Fiche — nothing to match a receipt on"
        : !data.warehouseSite?.trim()
          ? "no Warehouse/Site — this sheet's Lot Number is only unique together with its site"
          : undefined;

    out.push(skipReason ? { sheetRow: r, data, skipReason } : { sheetRow: r, data });
  }
  return out;
}

export const warehouseDischargesImporter: ImporterDef<WarehouseDischargeRow> = {
  id: "warehouseDischarges",
  label: "Unit-warehouse offloading (Lot assignment)",
  exampleFilename: "Suppliers Offloading_Bouake Warehouse Report.xlsx",
  expectedSheet: SHEET,
  headerRow: HEADER_ROW,
  expectedHeader: HEADER,
  checkHeaderPrefix: CHECK_PREFIX,
  /** The only thing distinguishing the two identical quality panels — see this file's header. */
  expectedAnchors: [
    { row: 3, col: SAMPLING_START, contains: "Sampling Report" },
    { row: 3, col: FINAL_OFFLOAD_START, contains: "Final Offloading Report" },
  ],
  parse,
};
