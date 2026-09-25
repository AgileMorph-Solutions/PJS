/**
 * Consolidated Drying Batch — BOTH sites, one shape. Sheet "Drying Batch", header row 1, data from
 * row 2, in ANAGROCI DATA PROCUREMENT 2026.xlsx. See DryingBatch's own schema.prisma comment for
 * the full measured shape and why this file (not "Bouake RCN Drying Report.xlsx") is the real
 * source — that file's own "Drying & Sorting Report" sheet was opened and checked directly before
 * being ruled out: different header (row 2, not row 1), different column count (42, not 56),
 * Bouaké-only (no ANAGROCI-01/central rows at all), and a pivot-table tail glued onto the same tab.
 * None of that matches "consolidated, both sites" — this sheet does.
 */
import type ExcelJS from "exceljs";
import type { ImporterDef, ParsedRow } from "./types.js";
import { num, dec, text, dateParts, isBlankRow } from "./xlsxHelpers.js";

export interface DryingBatchRow {
  sn: number;
  dryingDate: string | null;
  dryingDateRaw: string | null;
  warehouseSite: string | null;
  warehouse: string | null;
  sourceBinNo: string | null;
  destinationBinNo: string | null;
  lotNoRaw: string | null;
  lotNo: string | null;
  whReceiptNoRaw: string | null;
  ficheNoRaw: string | null;
  originRaw: string | null;
  supplierNameRaw: string | null;
  supplierCodeRaw: string | null;
  ccakSupplierCodeRaw: string | null;
  status: string | null;
  dryType: string | null;
  destinationRaw: string | null;
  issuedGrossWithBagsPalletsKg: number | null;
  issuedPalletWeightKg: number | null;
  issuedGrossWithBagsKg: number | null;
  issuedBags: number | null;
  issuedNetWeightKg: number | null;
  receivedGrossWithBagsPalletsKg: number | null;
  receivedPalletWeightKg: number | null;
  receivedGrossWithBagsKg: number | null;
  receivedBags: number | null;
  receivedNetWeightKg: number | null;
  inputMoisturePct: number | null;
  inputNutCount: number | null;
  inputKor: number | null;
  outputMoisturePct: number | null;
  outputNutCount: number | null;
  outputKor: number | null;
  oil: number | null;
  rejection: number | null;
  goodKernel: number | null;
  immature: number | null;
  spotted: number | null;
  shell: number | null;
  voidField: number | null;
  moistureLossPct: number | null;
  dryingLossKg: number | null;
  dryingLossPct: number | null;
  triageLossKg: number | null;
  triageLossPct: number | null;
  damagedNutsKg: number | null;
  inputBagsForDrying: number | null;
  outputBagsAfterDrying: number | null;
  dryingOrPicking: string | null;
  remarks: string | null;
  issuedToProduction: string | null;
  reDryingDate: string | null;
  reDryingDateRaw: string | null;
  moistureFirstRedryPct: number | null;
  moistureSecondDryPct: number | null;
  issuedToProduction3: string | null;
  remarks4: string | null;
  needsLotAllocationClarificationRaw: string | null;
}

const SHEET = "Drying Batch";
const HEADER_ROW = 1;
const CHECK_PREFIX = 56;

const HEADER = [
  "No", "drying date", "warehouse site", "warehouse", "source bin no", "destination bin no",
  "lot no raw", "warehouse receipt no raw", "fiche no raw", "origin raw", "supplier name raw",
  "supplier code raw", "ccak supplier code raw", "status", "dry type", "destination raw",
  "issued gross with bags pallets kg", "issued pallet weight kg", "issued gross with bags kg",
  "issued bags", "issued net weight kg", "received gross with bags pallets kg",
  "received pallet weight kg", "received gross with bags kg", "received bags",
  "received net weight kg", "input moisture pct", "input nut count", "input kor",
  "output moisture pct", "output nut count", "output kor", "oil", "rejection", "good kernel",
  "immature", "spotted", "shell", "void", "moisture loss pct", "drying loss kg",
  "drying loss pct", "triage loss kg", "triage loss pct", "damaged nuts kg",
  "input bags for drying", "output bags after drying", "drying or picking", "remarks",
  "issued to production", "re drying date", "moisture first redry pct",
  "moisture second dry pct", "issued to production 3", "remarks 4",
  "needs lot allocation clarification",
];

/** Every real single Lot number in this dataset is small (1-454 Bouaké / 1-256 Yamoussoukro,
 * measured against WarehouseDischarge/Warehouse Receiving) — the 11 ambiguous numerically
 * concatenated values are all >= 246253, nowhere near this range. A wide, deliberately conservative
 * cutoff, not a guessed split point: it only has to separate "clearly one small lot number" from
 * "clearly several digits glued together", and 138/138 real rows fall unambiguously on one side or
 * the other of it. */
const MAX_PLAUSIBLE_SINGLE_LOT = 1000;

/** Contamination, not ambiguity: this column also holds bin codes on 41/138 rows (measured), not a
 * lot number at all. Recognisable by the sheet's own bin-code shape used everywhere else in this
 * schema (BIN-0xx / ANA-0xx). */
const BIN_CODE_SHAPE = /^(BIN|ANA)[-\s]?\d/i;

/** Populates a clean lotNo only when lotNoRaw is unambiguously one lot — never splits a joined or
 * concatenated value. Returns null for: comma/slash-joined text, a bin-code string, or an
 * implausibly large (concatenated) integer. */
export function resolveCleanLotNo(raw: string | number | null): string | null {
  if (raw === null) return null;
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw > 0 && raw < MAX_PLAUSIBLE_SINGLE_LOT ? String(raw) : null;
  }
  const s = raw.trim();
  if (!s) return null;
  if (/[,/]/.test(s)) return null; // joined, e.g. "387, 401"
  if (BIN_CODE_SHAPE.test(s)) return null; // contamination, e.g. "BIN-03B"
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n > 0 && n < MAX_PLAUSIBLE_SINGLE_LOT ? s : null;
  }
  return null; // any other unrecognised shape — never guess, leave it out
}

/** Reads "lot no raw" as whichever raw shape the cell actually is (number or text), for
 * resolveCleanLotNo() and for the verbatim twin — never coerces one into the other. */
function rawLotCell(cell: ExcelJS.Cell): { asNumber: number | null; asText: string | null } {
  const n = dec(cell);
  if (n !== null) return { asNumber: n, asText: String(n) };
  return { asNumber: null, asText: text(cell) };
}

function parse(workbook: ExcelJS.Workbook): ParsedRow<DryingBatchRow>[] {
  const sheet = workbook.getWorksheet(SHEET)!;
  const out: ParsedRow<DryingBatchRow>[] = [];

  for (let r = HEADER_ROW + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (isBlankRow(row, CHECK_PREFIX)) continue;

    const sn = num(row.getCell(1));
    if (sn === null) continue; // this sheet's own row-order key; 0/138 real rows lack one

    const drying = dateParts(row.getCell(2));
    const reDrying = dateParts(row.getCell(51));
    const lot = rawLotCell(row.getCell(7));
    const lotNo = resolveCleanLotNo(lot.asNumber ?? lot.asText);

    const data: DryingBatchRow = {
      sn,
      dryingDate: drying.iso, dryingDateRaw: drying.raw,
      warehouseSite: text(row.getCell(3)), warehouse: text(row.getCell(4)),
      sourceBinNo: text(row.getCell(5)), destinationBinNo: text(row.getCell(6)),
      lotNoRaw: lot.asText, lotNo,
      whReceiptNoRaw: text(row.getCell(8)), ficheNoRaw: text(row.getCell(9)),
      originRaw: text(row.getCell(10)), supplierNameRaw: text(row.getCell(11)),
      supplierCodeRaw: text(row.getCell(12)), ccakSupplierCodeRaw: text(row.getCell(13)),
      status: text(row.getCell(14)), dryType: text(row.getCell(15)),
      destinationRaw: text(row.getCell(16)),
      issuedGrossWithBagsPalletsKg: dec(row.getCell(17)), issuedPalletWeightKg: dec(row.getCell(18)),
      issuedGrossWithBagsKg: dec(row.getCell(19)), issuedBags: num(row.getCell(20)),
      issuedNetWeightKg: dec(row.getCell(21)),
      receivedGrossWithBagsPalletsKg: dec(row.getCell(22)), receivedPalletWeightKg: dec(row.getCell(23)),
      receivedGrossWithBagsKg: dec(row.getCell(24)), receivedBags: num(row.getCell(25)),
      receivedNetWeightKg: dec(row.getCell(26)),
      inputMoisturePct: dec(row.getCell(27)), inputNutCount: dec(row.getCell(28)),
      inputKor: dec(row.getCell(29)), outputMoisturePct: dec(row.getCell(30)),
      outputNutCount: dec(row.getCell(31)), outputKor: dec(row.getCell(32)),
      oil: dec(row.getCell(33)), rejection: dec(row.getCell(34)), goodKernel: dec(row.getCell(35)),
      immature: dec(row.getCell(36)), spotted: dec(row.getCell(37)), shell: dec(row.getCell(38)),
      voidField: dec(row.getCell(39)),
      moistureLossPct: dec(row.getCell(40)), dryingLossKg: dec(row.getCell(41)),
      dryingLossPct: dec(row.getCell(42)), triageLossKg: dec(row.getCell(43)),
      triageLossPct: dec(row.getCell(44)), damagedNutsKg: dec(row.getCell(45)),
      inputBagsForDrying: num(row.getCell(46)), outputBagsAfterDrying: num(row.getCell(47)),
      dryingOrPicking: text(row.getCell(48)), remarks: text(row.getCell(49)),
      issuedToProduction: text(row.getCell(50)),
      reDryingDate: reDrying.iso, reDryingDateRaw: reDrying.raw,
      moistureFirstRedryPct: dec(row.getCell(52)), moistureSecondDryPct: dec(row.getCell(53)),
      issuedToProduction3: text(row.getCell(54)), remarks4: text(row.getCell(55)),
      needsLotAllocationClarificationRaw: text(row.getCell(56)),
    };

    out.push({ sheetRow: r, data });
  }
  return out;
}

export const dryingBatchImporter: ImporterDef<DryingBatchRow> = {
  id: "dryingBatch",
  label: "Drying Batch (consolidated, both sites)",
  exampleFilename: "ANAGROCI DATA PROCUREMENT 2026.xlsx",
  expectedSheet: SHEET,
  headerRow: HEADER_ROW,
  expectedHeader: HEADER,
  checkHeaderPrefix: CHECK_PREFIX,
  parse,
};
