/**
 * Receipts — sheet "Truck Reception" inside "ANAGROCI DATA PROCUREMENT 2026.xlsx", header row 1,
 * data from row 2. Replaces the old "OFFLOADINGS" importer (offloadings.ts, retired): same 986
 * physical trucks, same row-for-row values (verified against the old sheet before retiring it),
 * but every column is renamed and two columns are simply gone in this export — "RM/FG" and "REF."
 * have no equivalent here at all. Per ground rule #4 (never fabricate), those two stage fields
 * (stages.ts's n-gate.rmFg / n-verify.ref) are left with no sample value and never written by this
 * importer — see stages.ts's own comment on those two fields.
 *
 * The OUTPUT shape (the labels used as `stageData` keys below) is unchanged from offloadings.ts —
 * those labels are the wire format every stage table/StageForm/StageField mapping already expects
 * (STAGE_FIELD_MAP keys off stages.ts's own `n` label, not this sheet's column header text). This
 * importer's whole job is translating the new sheet's columns into that existing vocabulary, so
 * commitReceipts() in services/imports.ts needs no change at all — only this parser is new.
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

const SHEET = "Truck Reception";
const HEADER_ROW = 1;
// Verbatim from the real workbook, trimmed.
const HEADER = [
  "No", "arrival date", "offloading date", "payment type", "warehouse location", "warehouse code",
  "supplier name", "supplier code", "truck no", "fiche code", "fiche offloading no", "bags count",
  "gross weight kg", "net weight kg", "good bags", "humid bags", "torn bags", "refraction kg",
  "paid weight kg", "price cfa per kg", "amount cfa", "moisture pct", "nut count", "kor",
  "final kor", "origin", "remarks", "week",
];

const has = (v: string): boolean => v.trim() !== "";
const any = (...vs: string[]): boolean => vs.some(has);

function parse(workbook: ExcelJS.Workbook): ParsedRow<OffloadingRow>[] {
  const sheet = workbook.getWorksheet(SHEET)!;
  const out: ParsedRow<OffloadingRow>[] = [];

  for (let r = HEADER_ROW + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const no = text(row.getCell(1));
    // Same skip rule as offloadings.ts: no serial number, no row. This sheet's own header repeats
    // "No" rather than "S N" — the check is on the VALUE (blank/absent), not the literal text.
    if (no === null) continue;
    if (isBlankRow(row, 28)) continue;

    const col = (i: number) => text(row.getCell(i)) ?? "";
    const dateCol = (i: number) => {
      const { iso, raw } = dateParts(row.getCell(i));
      return iso ?? raw ?? "";
    };

    const arrivalDate = dateCol(2);
    const offloadingDate = dateCol(3);
    const paymentType = col(4);
    const whLocation = col(5);
    const whNo = col(6);
    const supplierName = col(7);
    const supplierCode = col(8);
    const truckNo = col(9);
    const ficheCode = col(10);
    const ficheOffloadingNo = col(11);
    const bagsCount = col(12);
    const grossWt = col(13);
    const netWt = col(14);
    const goodBags = col(15);
    const humidBags = col(16);
    const tornBags = col(17);
    const refractionKg = col(18);
    const paidWt = col(19);
    const price = col(20);
    const amount = col(21);
    const moisturePct = col(22);
    const nutCount = col(23);
    const kor = col(24);
    const finalKor = col(25);
    const origin = col(26);

    const stageData: Record<string, Record<string, string>> = {
      // Same label vocabulary offloadings.ts wrote — "RM/FG" is simply never included: the new
      // sheet has no column for it, and there is nothing to invent one from.
      "n-gate": {
        "S N": no, "DATE OF ARRIVAL": arrivalDate, "CREDIT/CASH": paymentType,
        "WH LOCATION": whLocation, "WH NO.": whNo, "VEHICLE NO.": truckNo,
      },
      "n-tare": { "Tare / empty truck weight (kg)": "" },
    };

    // "REF." has no equivalent column in this sheet either — never included, same reasoning.
    if (any(supplierName, supplierCode)) {
      stageData["n-verify"] = {
        "SUPPLIERS NAME": supplierName, "LBA CODE": supplierCode, "FICHE CODE": ficheCode,
        "FICHE": ficheOffloadingNo, "ORIGIN": origin,
      };
    }
    if (any(moisturePct, nutCount, kor, finalKor)) {
      stageData["n-qfs"] = {
        "MOIS. (moisture)": moisturePct, "NUT COUNT": nutCount, "KOR": kor, "FINAL KOR": finalKor,
      };
    }
    if (has(grossWt)) {
      stageData["n-gross"] = { "GROSS WT KGS": grossWt };
    }
    if (any(bagsCount, goodBags, humidBags, tornBags, refractionKg, offloadingDate)) {
      stageData["n-unload"] = {
        "DATE OF OFFLOADING": offloadingDate, "SACS (bags)": bagsCount,
        "BON SACS (good bags)": goodBags, "HUMID SACS (damp bags)": humidBags,
        "Sacs déchirés (torn bags)": tornBags, "Refraction": refractionKg,
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
        arrivalDate, supplierName, lbaCode: supplierCode, vehicleNo: truckNo,
        warehouse: whLocation, origin, stageData,
      },
    });
  }
  return out;
}

export const truckReceptionImporter: ImporterDef<OffloadingRow> = {
  id: "truckReception",
  label: "RCN Receipts",
  exampleFilename: "ANAGROCI DATA PROCUREMENT 2026.xlsx",
  expectedSheet: SHEET,
  headerRow: HEADER_ROW,
  expectedHeader: HEADER,
  checkHeaderPrefix: HEADER.length,
  parse,
};
