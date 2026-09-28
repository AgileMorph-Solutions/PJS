/**
 * Jute ledger 4 (warehouse-to-warehouse-movement) — sheet "Bouake Stock Reciving", header row 6,
 * data from row 7, skip a row if col A (SN) isn't a clean number. Mirrors tools/extract-jute.py's
 * `extract_l4()`/`L4_COLS` exactly, all 34 real columns (the ledger form only shows 12 of these —
 * see juteBags.ts — but normalization doesn't discard the other 22, and neither does this).
 *
 * This is the shape the real corruption case involves — see headerCheck.ts and
 * docs/UPLOAD_GUIDE.md. `sn` is a real source-provided key (confirmed unique 1–367 in the real
 * data) — `JuteWarehouseTransferReceipt.sn` is already `@unique`, so commit-time dedup is a plain
 * `skipDuplicates`, no content-key heuristic needed (unlike ledger 1's artificial `seq`).
 */
import type ExcelJS from "exceljs";
import type { ImporterDef, ParsedRow } from "./types.js";
import { num, dec, text, dateParts, isBlankRow } from "./xlsxHelpers.js";

export interface JuteWarehouseTransferRow {
  sn: number;
  receivedDate: string | null;
  rawDate: string | null;
  month: string | null;
  dryUndry: string | null;
  idTransfer: string | null;
  truckRegistration: string | null;
  lotNo: string | null;
  lotDry: string | null;
  noFiche: string | null;
  ccaFicheNumber: string | null;
  binNo: string | null;
  damagedBags: number | null;
  newBagsUsed: number | null;
  recondition: number | null;
  sourceWarehouse: string | null;
  origin: string | null;
  bagsDispatched: number | null;
  bagsReceived: number | null;
  reportedDifference: number | null;
  finalBagsAfterRebagging: number | null;
  reportedDiff: number | null;
  laissePasserEntree: string | null;
  fullyLoadedTruckWeight: number | null;
  emptyTruckTareWeight: number | null;
  grossWeightReceived: number | null;
  netWeightAtArrival: number | null;
  netWeightDispatched: number | null;
  weightDifference: number | null;
  korReceived: number | null;
  korReceivedRaw: string | null;
  korDispatched: number | null;
  korDispatchedRaw: string | null;
  moistureReceived: number | null;
  moistureReceivedRaw: string | null;
  moistureDispatched: number | null;
  moistureDispatchedRaw: string | null;
  ncArrival: string | null;
  comment: string | null;
}

const SHEET = "Bouake Stock Reciving";
const HEADER_ROW = 6;
// Verbatim from the real workbook, EXCEPT trimmed — readHeaderRow()/text() trim every cell it
// reads (the raw cells for "Transfer -Bouake" and "Gross Weight (Yakro) Recived" both have a
// trailing space in the source), so the expected list must match what that trimmed comparison
// actually produces, not the raw untrimmed cell text.
const HEADER = [
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

/** For a decimal column: (parsed number, raw text if the cell wasn't numeric) — mirrors
 * extract-jute.py's `dec(val)` + `field + "Raw"` twin. */
function decWithRaw(cell: ExcelJS.Cell): [number | null, string | null] {
  const d = dec(cell);
  if (d !== null) return [d, null];
  return [null, text(cell)];
}

function parse(workbook: ExcelJS.Workbook): ParsedRow<JuteWarehouseTransferRow>[] {
  const sheet = workbook.getWorksheet(SHEET)!;
  const out: ParsedRow<JuteWarehouseTransferRow>[] = [];

  for (let r = HEADER_ROW + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (isBlankRow(row, 34)) continue;

    const sn = num(row.getCell(1));
    if (sn === null) continue; // extract_l4(): `if num(v[0]) is None: continue`

    const { iso: receivedDate, raw: rawDate } = dateParts(row.getCell(2));
    const [korReceived, korReceivedRaw] = decWithRaw(row.getCell(29));
    const [korDispatched, korDispatchedRaw] = decWithRaw(row.getCell(30));
    const [moistureReceived, moistureReceivedRaw] = decWithRaw(row.getCell(31));
    const [moistureDispatched, moistureDispatchedRaw] = decWithRaw(row.getCell(32));

    const sourceWarehouse = text(row.getCell(15));

    const data: JuteWarehouseTransferRow = {
      sn, receivedDate, rawDate,
      month: text(row.getCell(3)), dryUndry: text(row.getCell(4)), idTransfer: text(row.getCell(5)),
      truckRegistration: text(row.getCell(6)), lotNo: text(row.getCell(7)), lotDry: text(row.getCell(8)),
      noFiche: text(row.getCell(9)), ccaFicheNumber: text(row.getCell(10)), binNo: text(row.getCell(11)),
      damagedBags: num(row.getCell(12)), newBagsUsed: num(row.getCell(13)), recondition: num(row.getCell(14)),
      sourceWarehouse, origin: text(row.getCell(16)),
      bagsDispatched: num(row.getCell(17)), bagsReceived: num(row.getCell(18)),
      reportedDifference: num(row.getCell(19)), finalBagsAfterRebagging: num(row.getCell(20)),
      reportedDiff: num(row.getCell(21)), laissePasserEntree: text(row.getCell(22)),
      fullyLoadedTruckWeight: num(row.getCell(23)), emptyTruckTareWeight: num(row.getCell(24)),
      grossWeightReceived: num(row.getCell(25)), netWeightAtArrival: num(row.getCell(26)),
      netWeightDispatched: num(row.getCell(27)), weightDifference: num(row.getCell(28)),
      korReceived, korReceivedRaw, korDispatched, korDispatchedRaw,
      moistureReceived, moistureReceivedRaw, moistureDispatched, moistureDispatchedRaw,
      ncArrival: text(row.getCell(33)), comment: text(row.getCell(34)),
    };

    // Real data always states this (col 15, "Transfer -Bouake") — 0/367 rows hit this guard. Kept
    // as an explicit skip rather than a silent "?? BOUAKE" default at commit time: a transfer's
    // source is exactly the kind of fact ground rule §4 forbids guessing, and a genuinely blank
    // cell here is surfaced as a skipped row (commitImport's skippedInvalid) instead.
    out.push(
      sourceWarehouse?.trim()
        ? { sheetRow: r, data }
        : { sheetRow: r, data, skipReason: "no source warehouse — this row's own key, never guessed" }
    );
  }
  return out;
}

export const juteWarehouseTransferImporter: ImporterDef<JuteWarehouseTransferRow> = {
  id: "juteWarehouseTransfer",
  label: "Jute warehouse-to-warehouse transfers",
  exampleFilename: "Bouake RCN Receiving at Factory Report.xlsx",
  expectedSheet: SHEET,
  headerRow: HEADER_ROW,
  expectedHeader: HEADER,
  checkHeaderPrefix: HEADER.length,
  parse,
};
