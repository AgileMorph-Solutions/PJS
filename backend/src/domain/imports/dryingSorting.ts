/**
 * Bouaké-side drying/sorting detail — sheet "Drying & Sorting Report" inside "Bouake RCN Drying
 * Report.xlsx", header row 2, data from row 3. Measured 57 real rows (the sheet's formatted extent
 * runs to row 631, but every row past the 57th is blank across all 31 real columns — checked with
 * `isBlankRow`, not assumed from the sheet's nominal size).
 *
 * Column 23 repeats column 21's exact label ("Draige Loss Kg's") — the same duplicate-panel trap
 * warehouseDischarges.ts documents — so this parser reads by COLUMN INDEX only, never by label.
 * See schema.prisma's DryingSortingReport model for the full column-by-column reasoning.
 */
import type ExcelJS from "exceljs";
import type { ImporterDef, ParsedRow } from "./types.js";
import { num, dec, text, dateParts, isBlankRow } from "./xlsxHelpers.js";
import { resolveCleanLotNo } from "./dryingBatch.js";

export interface DryingSortingRow {
  sn: number | null;
  dryingDate: string | null;
  dryingDateRaw: string | null;
  warehouseSite: string | null;
  warehouse: string | null;
  unloadingBin: string | null;
  afterDryingBin: string | null;
  lotNo: string | null;
  lotNoRaw: string | null;
  whReceiptNoRaw: string | null;
  origin: string | null;
  supplierName: string | null;
  supplierCodeAnagroci: string | null;
  supplierCodeCcak: string | null;
  issuedNetWeightGrn: number | null;
  receivedNetWeightAfterDrying: number | null;
  inputMoisture: number | null;
  inputNutCount: number | null;
  inputKor: number | null;
  outputMoisture: number | null;
  outputNutCount: number | null;
  outputKor: number | null;
  drainageLossKg: number | null;
  lossPct: number | null;
  drainageLossKg2: number | null;
  drainageLossPct: number | null;
  goodOrDriedSacs: string | null;
  damagedNutsKgTriage: number | null;
  totalSacReceived: string | null;
  inputBagsForDrying: number | null;
  outputBagsAfterDrying: number | null;
  dryingPicking: string | null;
  remarks: string | null;
}

const SHEET = "Drying & Sorting Report";
const HEADER_ROW = 2;
const CHECK_PREFIX = 31;
const HEADER = [
  "S.No.", "DATE", "Warehouse/Site", "Warehouse", "UNLOADING BIN", "AFTER DRYING BIN", "Lot No",
  "W/H Receipt No.", "Origin", "Supplier Name", "Supplier's Code (Anagroci)",
  "Supplier's Code (CCAK)", "Issued Net Weight (GRN)", "Received Net Weight (After Drying)",
  "Input Moisture", "INPUT NUT COUNT", "INPUT KOR", "Output Moisture", "OUTPUT NUT COUNT",
  "OUTPUT KOR", "Draige Loss Kg's", "Loss%", "Draige Loss Kg's", "DRIAGE LOSS  %",
  "Good or Dried Sacs", "Damaged nuts - KGS/ TRIAGE", "Total Sac Received",
  "INPUT BAGS FOR DRYING", "OUTPUT BAGS AFTER DRING", "DRYING/ PICKING", "REMARKS",
];

function parse(workbook: ExcelJS.Workbook): ParsedRow<DryingSortingRow>[] {
  const sheet = workbook.getWorksheet(SHEET)!;
  const out: ParsedRow<DryingSortingRow>[] = [];

  for (let r = HEADER_ROW + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (isBlankRow(row, CHECK_PREFIX)) continue;

    const sn = num(row.getCell(1));
    if (sn === null) continue; // no serial number — a repeated header band or a stray formatted row

    const { iso: dryingDate, raw: dryingDateRaw } = dateParts(row.getCell(2));
    const lotCell = row.getCell(7);
    const lotNoRaw = text(lotCell);
    const lotNoFromNumber = dec(lotCell);

    out.push({
      sheetRow: r,
      data: {
        sn, dryingDate, dryingDateRaw,
        warehouseSite: text(row.getCell(3)), warehouse: text(row.getCell(4)),
        unloadingBin: text(row.getCell(5)), afterDryingBin: text(row.getCell(6)),
        lotNo: resolveCleanLotNo(lotNoFromNumber ?? lotNoRaw),
        lotNoRaw: lotNoRaw ?? (lotNoFromNumber !== null ? String(lotNoFromNumber) : null),
        whReceiptNoRaw: text(row.getCell(8)),
        origin: text(row.getCell(9)), supplierName: text(row.getCell(10)),
        supplierCodeAnagroci: text(row.getCell(11)), supplierCodeCcak: text(row.getCell(12)),
        issuedNetWeightGrn: dec(row.getCell(13)), receivedNetWeightAfterDrying: dec(row.getCell(14)),
        inputMoisture: dec(row.getCell(15)), inputNutCount: dec(row.getCell(16)),
        inputKor: dec(row.getCell(17)), outputMoisture: dec(row.getCell(18)),
        outputNutCount: dec(row.getCell(19)), outputKor: dec(row.getCell(20)),
        drainageLossKg: dec(row.getCell(21)), lossPct: dec(row.getCell(22)),
        drainageLossKg2: dec(row.getCell(23)), drainageLossPct: dec(row.getCell(24)),
        goodOrDriedSacs: text(row.getCell(25)), damagedNutsKgTriage: dec(row.getCell(26)),
        totalSacReceived: text(row.getCell(27)), inputBagsForDrying: num(row.getCell(28)),
        outputBagsAfterDrying: num(row.getCell(29)), dryingPicking: text(row.getCell(30)),
        remarks: text(row.getCell(31)),
      },
    });
  }
  return out;
}

export const dryingSortingImporter: ImporterDef<DryingSortingRow> = {
  id: "dryingSorting",
  label: "Drying & Sorting Report (Bouaké detail)",
  exampleFilename: "Bouake RCN Drying Report.xlsx",
  expectedSheet: SHEET,
  headerRow: HEADER_ROW,
  expectedHeader: HEADER,
  checkHeaderPrefix: CHECK_PREFIX,
  parse,
};
