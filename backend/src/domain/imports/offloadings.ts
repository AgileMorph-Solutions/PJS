/**
 * Receipts — sheet "OFFLOADINGS", header row 2, data from row 3. Mirrors
 * tools/extract-seed.py's `read_offloadings()` column reads exactly (same 28 columns, same skip
 * rule: skip a row if col A is empty or literally "S N").
 *
 * What this file does NOT mirror, deliberately: extract-seed.py's `TIERS`/`pick_tier()` — that
 * `random.seed(42)`-weighted system exists only to make a curated 50-row DEMO sample cover all 10
 * statuses realistically. It is demo scaffolding, not a model of real per-truck progress, and
 * porting it here would mean fabricating which stages a real uploaded truck reached. Instead:
 *
 *   A stage gets a StageEntry if and only if at least one of its mapped fields is non-empty in
 *   this row. Two deliberate exceptions, both matching precedent already in this codebase:
 *     - n-tare is always created present-but-empty (the client's process notes confirm every
 *       truck physically passes tare weighing even though OFFLOADINGS has no column for it — the
 *       existing `tare_never_recorded` finding already documents this).
 *     - n-lot / n-bin / n-stock / n-drying / n-otheract / n-ledger / n-xferdec / n-reject are
 *       NEVER created here — OFFLOADINGS captures none of them, so creating them would invent
 *       progress that didn't happen. n-qfs is created when quality fields are present, but its
 *       pass/fail branch is left unset — the sheet has no real pass/fail signal.
 *
 * See docs/UPLOAD_GUIDE.md for the plain-language version of this rule.
 */
import type ExcelJS from "exceljs";
import type { ImporterDef, ParsedRow } from "./types.js";
import { text, dateParts, isBlankRow } from "./xlsxHelpers.js";

export interface OffloadingRow {
  arrivalDate: string;
  supplierName: string;
  lbaCode: string;
  vehicleNo: string;
  warehouse: string;
  origin: string;
  /** Already in the exact stageId -> {label: value} shape toColumnPayload()/StageEntry expect —
   * only the receipt id (assigned at commit time, batch-wide) is missing from this being a
   * ready-to-write Receipt. */
  stageData: Record<string, Record<string, string>>;
}

const SHEET = "OFFLOADINGS";
const HEADER_ROW = 2;
// Verbatim from the real workbook. Column 29 ("REMARKS") exists in the sheet but was never read
// by extract-seed.py either — checked here for the fingerprint but not parsed into any field.
const HEADER = [
  "S N", "DATE OF ARRIVAL", "DATE OF OFFLOADING", "RM/FG", "CREDIT/CASH", "WH LOCATION", "WH NO.",
  "SUPPLIERS NAME", "LBA CODE", "VEHICLE NO.", "FICHE CODE", "REF.", "FICHE", "SACS",
  "GROSS WT KGS", "NET WT KGS", "BON SACS", "HUMID SACS", "Sacs déchirés", "Refraction", "PAID WT",
  "PRICE", "AMOUNT", "MOIS.", "NUT COUNT", "KOR", "FINAL KOR", "ORIGIN", "REMARKS",
];

/** Non-empty-string check on a possibly-null value — this is the entire "did the truck reach this
 * stage" signal for every stage below except the two deliberate exceptions noted at the top. */
const has = (v: string): boolean => v.trim() !== "";
const any = (...vs: string[]): boolean => vs.some(has);

function parse(workbook: ExcelJS.Workbook): ParsedRow<OffloadingRow>[] {
  const sheet = workbook.getWorksheet(SHEET)!;
  const out: ParsedRow<OffloadingRow>[] = [];

  for (let r = HEADER_ROW + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const sn = text(row.getCell(1));
    // extract-seed.py: `if sn is None or str(sn).strip() == "S N": continue`
    if (sn === null || sn === "S N") continue;
    if (isBlankRow(row, 28)) continue;

    const col = (i: number) => text(row.getCell(i)) ?? "";
    const dateCol = (i: number) => {
      const { iso, raw } = dateParts(row.getCell(i));
      return iso ?? raw ?? "";
    };

    const dateOfArrival = dateCol(2);
    const dateOfOffloading = dateCol(3);
    const rmFg = col(4);
    const creditCash = col(5);
    const whLocation = col(6);
    const whNo = col(7);
    const suppliersName = col(8);
    const lbaCode = col(9);
    const vehicleNo = col(10);
    const ficheCode = col(11);
    const ref = col(12);
    const fiche = col(13);
    const sacs = col(14);
    const grossWt = col(15);
    const netWt = col(16);
    const bonSacs = col(17);
    const humidSacs = col(18);
    const sacsDechires = col(19);
    const refraction = col(20);
    const paidWt = col(21);
    const price = col(22);
    const amount = col(23);
    const mois = col(24);
    const nutCount = col(25);
    const kor = col(26);
    const finalKor = col(27);
    const origin = col(28);

    const stageData: Record<string, Record<string, string>> = {
      // Always present: a row that passed the skip filter has, definitionally, reached the gate.
      "n-gate": {
        "S N": sn, "DATE OF ARRIVAL": dateOfArrival, "RM/FG": rmFg, "CREDIT/CASH": creditCash,
        "WH LOCATION": whLocation, "WH NO.": whNo, "VEHICLE NO.": vehicleNo,
      },
      // Always present-but-empty: a real physical step OFFLOADINGS just never captured a column
      // for — see this function's header comment and the existing tare_never_recorded finding.
      "n-tare": { "Tare / empty truck weight (kg)": "" },
    };

    if (any(suppliersName, lbaCode)) {
      stageData["n-verify"] = {
        "SUPPLIERS NAME": suppliersName, "LBA CODE": lbaCode, "FICHE CODE": ficheCode,
        "REF.": ref, "FICHE": fiche, "ORIGIN": origin,
      };
    }
    if (any(mois, nutCount, kor, finalKor)) {
      // Branch (pass/fail) deliberately left unset — see header comment.
      stageData["n-qfs"] = {
        "MOIS. (moisture)": mois, "NUT COUNT": nutCount, "KOR": kor, "FINAL KOR": finalKor,
      };
    }
    if (has(grossWt)) {
      stageData["n-gross"] = { "GROSS WT KGS": grossWt };
    }
    if (any(sacs, bonSacs, humidSacs, sacsDechires, refraction, dateOfOffloading)) {
      stageData["n-unload"] = {
        "DATE OF OFFLOADING": dateOfOffloading, "SACS (bags)": sacs, "BON SACS (good bags)": bonSacs,
        "HUMID SACS (damp bags)": humidSacs, "Sacs déchirés (torn bags)": sacsDechires,
        "Refraction": refraction,
      };
    }
    if (any(netWt, paidWt)) {
      stageData["n-netwt"] = { "NET WT KGS": netWt, "PAID WT": paidWt };
    }
    if (any(price, amount)) {
      stageData["n-grn"] = { "PRICE": price, "AMOUNT": amount };
    }

    out.push({
      sheetRow: r,
      data: {
        arrivalDate: dateOfArrival, supplierName: suppliersName, lbaCode, vehicleNo,
        warehouse: whLocation, origin, stageData,
      },
    });
  }
  return out;
}

export const offloadingsImporter: ImporterDef<OffloadingRow> = {
  id: "receipts",
  label: "RCN Receipts",
  exampleFilename: "Rcn Offloading Details 2026.xlsx",
  expectedSheet: SHEET,
  headerRow: HEADER_ROW,
  expectedHeader: HEADER,
  checkHeaderPrefix: HEADER.length,
  parse,
};
