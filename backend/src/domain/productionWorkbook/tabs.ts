/**
 * The production workbook's tabs, laid out so the client recognises their own files (team decision, Nov 2026):
 *
 * - A tab that stands for one of the client's Excel files is named after it ("19. RCN Receipts Tally Sheet", cut to
 *   Excel's 31 characters where needed) and starts with that file's columns, in its order and in its words.
 * - What the app adds — its IDs, approval, a check's result, the gate fields of a truck — comes after, marked `isNew`:
 *   the download colours those headers and notes "New: not in your Excel file".
 * - A record no client file has (cooling, a QC-4, ...) is its own tab at the end, named "New · …".
 * - The tabs are shown in that order but uploaded in the floor's order (RUN_ORDER), so a row can still rely on the
 *   rows of an earlier step (a load made from the tally sheet, a Lot cooled before it is shelled).
 *
 * `derived` columns are what the app works out (a status, KOR, a net weight, a week): the file shows them, an upload
 * never reads them. `aliases` are a column's or tab's older words, so a file downloaded before keeps uploading.
 */
import { canRunProduction, type Role } from "@anagroci/contract/data/roles";
import { SILO_SIZES, SIZING_GRADES, type SizingGrade } from "@anagroci/contract/domain/calibration";
import { WASTE_CATEGORIES } from "@anagroci/contract/domain/byProducts";
import { ENTRY_DEFS, ENTRY_KINDS, type EntryKind } from "@anagroci/contract/domain/lotEntries";

export interface TabField {
  key: string;
  label: string;
  derived?: boolean;
  /** Excel hands a time cell back as a date; this column keeps its HH:MM. */
  time?: boolean;
  /** A cell comment on the header: how to fill the column in. */
  note?: string;
  /** Not a column of the client's file: the app's own. */
  isNew?: boolean;
  /** Older words for this column, still read on upload. */
  aliases?: string[];
}

export type TabId =
  | "receipts" | "tally" | "checks" | "siloChecks" | "siloMoves" | "cooking" | "cooling" | "shellingDays" | "sorter"
  | "wasteTrucks" | "shellTrucks" | "boiler" | `entry:${EntryKind}`;

export interface Tab {
  id: TabId;
  title: string;
  /** Other sheet names read as this tab: the client's own, and the tab's older names. */
  aliases?: string[];
  /** The client's Excel file this tab stands for, as it is named; absent for a record no client file has. */
  file?: string;
  /** A record no client file has: the whole tab is the app's. */
  isNew?: boolean;
  /** The column that names an existing row; blank in it means "add a new one". */
  key: string;
  fields: TabField[];
  /** The date the export's range filter applies to. */
  dateKey: string;
  dateLabel: string;
  /** The stage of the floor the tab belongs to, and its colour on the tab strip (STAGES). */
  stage?: string;
  color?: string;
}

// The columns most of the client's sheets begin with. Worked out from the date (=WEEKNUM, =TEXT(date,"mmm-yy")).
const SL_NO: TabField = { key: "slNo", label: "SL.NO", derived: true };
const WEEK: TabField = { key: "week", label: "Week", derived: true };
const MONTH: TabField = { key: "month", label: "Month", derived: true };

const LOT_LINK: TabField = { key: "lotCode", label: "Lot No" };

/** The silo stock report's own column words: "Size A++ (>25mm)". */
export const runKgKey = (key: string) => `kg_${key}`;
const RUN_SIZES: TabField[] = SILO_SIZES.map((s) => ({ key: runKgKey(s.key), label: `Size ${s.code} (${s.mm.replace(" ", "")})` }));

/** The QC-2 sheet's own column words: "A++" … "DE", "< DE" (the app's earlier "A++ (g)" is still read). */
export const gramKey = (g: SizingGrade) => `g_${g}`;
const GRADE_WORD = (g: SizingGrade) => (g === "under" ? "< DE" : SILO_SIZES.find((s) => s.key === g)!.sheet);
const SAMPLE_GRAMS: TabField[] = SIZING_GRADES.map((g) => ({ key: gramKey(g), label: GRADE_WORD(g), aliases: [`${GRADE_WORD(g)} (g)`] }));

/**
 * One of a Lot record's fields under the client's column word. The screen's own label stays readable as an alias, and
 * the field's type gives its note (the sizes, a list's options).
 */
function v(kind: EntryKind, key: string, label: string, note?: string): TabField {
  const f = ENTRY_DEFS[kind].fields.find((x) => x.key === key);
  if (!f) throw new Error(`${kind} has no field ${key}`);
  return {
    key: `v_${key}`, label, time: f.type === "time", aliases: f.label === label ? undefined : [f.label],
    note: note ?? (f.type === "size" ? "The size: A++, A+, A, AB, B, BC, C, D or DE." : f.options ? f.options.join(", ") : undefined),
  };
}

/** A Lot record's tab. With `client`, those columns lead and everything else of the app's follows. */
function entryTab(kind: EntryKind, title: string, client?: { file: string; fields: TabField[] }, aliases: string[] = []): Tab {
  const def = ENTRY_DEFS[kind];
  const isNew = !client;
  // A record no client file has takes the shape of theirs: Date, then the Lot, then the readings, the app's ID last.
  const lead = client?.fields ?? [{ key: "date", label: "Date" }, LOT_LINK];
  const named = new Set(lead.map((f) => f.key));
  const rest = def.fields.filter((f) => !named.has(`v_${f.key}`)).map((f) => ({ ...v(kind, f.key, f.label), isNew: !isNew }));
  return {
    id: `entry:${kind}`,
    title,
    // The contract's sheet word was this tab's name until Nov 2026: a file downloaded before still uploads.
    aliases: [...aliases, def.sheet],
    file: client?.file,
    isNew: isNew || undefined,
    key: "id",
    dateKey: "date",
    dateLabel: "Date",
    fields: [
      ...lead,
      ...rest,
      { key: "id", label: "Entry ID", isNew: true },
      ...(def.decision ? [{ key: "decision", label: "Result", isNew: !isNew, note: `${def.decision.ok}, or ${def.decision.noValue === "wait" ? "Wait" : "No"}.` }] : []),
      ...(def.who === "qfs" ? [{ key: "status", label: "Approval", derived: true, isNew: !isNew }] : []),
    ],
  };
}

/** "12. Shelled Kernels Quality Report": one sheet for both sides of the colour sorter, told apart by its Sampling Point. */
export const SORTER_POINTS = [{ word: "Before CS", kind: "qc7_before" }, { word: "After CS", kind: "qc7_after" }] as const;

/** The truck columns both dispatch trackers share, in their order. */
const TRUCK_LEAD: TabField[] = [
  SL_NO,
  { key: "date", label: "DATE" },
  WEEK,
  MONTH,
  { key: "truckNo", label: "TRUCK NO" },
  { key: "slipNo", label: "Weighment Slip" },
  { key: "tareKg", label: "TARE WEIGHT" },
  { key: "grossKg", label: "GROSS WEIGHT" },
  { key: "netKg", label: "NET WEIGHT (KGS)", derived: true },
  { key: "buyer", label: "Vendor" },
];
/** The doc's gate procedure, which neither tracker has: the app's, after the client's columns. */
const TRUCK_GATE: TabField[] = [
  { key: "id", label: "Truck ID", isNew: true },
  { key: "driver", label: "Driver", isNew: true },
  { key: "documentsChecked", label: "Documents Checked", isNew: true, note: "Yes or No. A truck is weighed only after its documents are checked." },
  { key: "gatePassNo", label: "Gate Pass No", isNew: true, note: "Filling this in closes the truck, and takes its net weight out of the store." },
  { key: "status", label: "Status", derived: true, isNew: true },
];

const LOAD_IDS: TabField[] = [
  { key: "receiptId", label: "RCN Receipt ID", isNew: true, note: "The load this row is for. Or leave it blank: the BTM No (and BIN No) find it." },
];

const DEFINED: Tab[] = [
  {
    // The client's "19. RCN Receipts Tally Sheet" (its Online sheet), column for column and nothing else — none of the
    // app's IDs, which only the app shows — so its rows can be pasted in as they are. One row is one pallet; the rows of
    // one BTM from one Source BIN are one load. The sheet's own formula columns (SL.NO, Week, Month, Pallet No, Bags
    // Weight, Net Weight) are read past: the app works them out.
    // Named "RCN Receipts" (team, 18 Nov 2026): it is where a load is received. Its old name still uploads.
    id: "tally",
    title: "RCN Receipts",
    file: "19.RCN Receipts Tally Sheet.xlsx",
    aliases: ["1. RCN Tally Sheet", "RCN Tally Sheet", "19. RCN Receipts Tally Sheet", "Online", "RCN Receipts Tally Sheet"],
    key: "btmNo",
    dateKey: "date",
    dateLabel: "Date",
    fields: [
      SL_NO,
      { key: "date", label: "DATE", note: "The day the load arrived. A new load takes the date of its first row." },
      WEEK,
      MONTH,
      { key: "binCode", label: "Source BIN", note: "The warehouse bin the pallet came from, e.g. BIN-03B." },
      { key: "factoryBin", label: "Bin No", note: "The production bin the pallet goes into, e.g. ANA-03B." },
      { key: "btmNo", label: "BTM No" },
      { key: "palletNo", label: "Pallet No", derived: true },
      { key: "grossKg", label: "Gross Weight (kg's)" },
      { key: "bags", label: "No of Bags" },
      { key: "bagsKg", label: "Bags Weight (kg's)", derived: true },
      { key: "palletKg", label: "Pallet Weight (Kg's)", note: "The empty pallets, weighed in stacks: one weighing per row, on any row of the load." },
      { key: "netKg", label: "Net Weight (kg's)", derived: true },
      { key: "dustKg", label: "Dust", note: "Kg, on any one row of the load." },
      { key: "voidsKg", label: "Voids", note: "Kg, on any one row of the load." },
    ],
  },
  {
    // The client's "1. RCN Receipts" register: one row per load. Its kg are the tally sheet's totals, so here they are
    // worked out from the pallets, never typed. A row is only needed for a load with no pallets in the file yet. Named
    // "RCN Receipts summary" (team, 18 Nov 2026) now the tally tab is "RCN Receipts"; an older file's "2. RCN Receipts"
    // still reads as this tab (the client's own "1. RCN Receipts" would now be the tally tab's name, so it no longer does).
    id: "receipts",
    title: "RCN Receipts summary",
    file: "1. RCN Receipts.xlsx",
    aliases: ["2. RCN Receipts"],
    key: "btmNo",
    dateKey: "date",
    dateLabel: "Date",
    fields: [
      { key: "slNo", label: "S.No", derived: true },
      { key: "date", label: "Date" },
      MONTH,
      { key: "year", label: "Year", derived: true },
      { key: "cropYear", label: "Crop Year", note: "As the register has it, e.g. 2026. Blank until known." },
      { key: "btmNo", label: "BTM No" },
      { key: "binCode", label: "Source Bin No", note: "The warehouse bin the load came from. The production run is the one this bin is in." },
      { key: "factoryBin", label: "BIN No", derived: true },
      { key: "grossKg", label: "Received Gross Qty (kgs)", derived: true },
      { key: "tareKg", label: "Pallets+Bags Wt (kgs)", derived: true },
      { key: "netKg", label: "Net Weight (kgs)", derived: true },
      { key: "dustKg", label: "Dust (kgs)", derived: true, isNew: true },
      { key: "voidsKg", label: "Voids (kgs)", derived: true, isNew: true },
      { key: "toSilosKg", label: "Net Weight Transferred to Silos (kgs)", derived: true, isNew: true },
      { key: "status", label: "Status", derived: true, isNew: true },
    ],
  },
  {
    // The client's "2. Input RCN Quality report". Its Date, Month, Year and Crop Year are the load's.
    id: "checks",
    title: "Input RCN Quality",
    file: "2. Input RCN Quality report.xlsx",
    aliases: ["2. Input RCN Quality report", "Moisture Checks", "Input RCN Quality report"],
    key: "id",
    dateKey: "loadDate",
    dateLabel: "Load date",
    fields: [
      { key: "slNo", label: "S.No", derived: true },
      { key: "loadDate", label: "Date", derived: true },
      MONTH,
      { key: "year", label: "Year", derived: true },
      { key: "cropYear", label: "Crop Year", derived: true },
      { key: "btmNo", label: "BTM NO", note: "Enough on its own when only one load has this BTM No." },
      { key: "binCode", label: "BIN No", aliases: ["Source Bin"], note: "Only needed when one BTM came from more than one bin (BTM 122 came from three)." },
      { key: "nutCount", label: "Nut Count" },
      { key: "moisture", label: "Moisture", aliases: ["Moisture (%)"] },
      { key: "sampleG", label: "Sample Weight (g)" },
      { key: "gkG", label: "GK (g)" },
      { key: "spotG", label: "Spot (g)" },
      { key: "immatureG", label: "Immature (g)" },
      { key: "oilG", label: "Oil (g)" },
      { key: "rejectionG", label: "Rejection (g)" },
      { key: "voidsG", label: "Voids (g)" },
      { key: "shellG", label: "Shell (g)" },
      { key: "fruitWasteG", label: "Fruit Waste", aliases: ["Fruit Waste (g)"] },
      { key: "kor", label: "KOR (lbs)", derived: true },
      { key: "shot", label: "SHOT (lbs)", derived: true },
      { key: "fot", label: "FOT (lbs)", derived: true },
      { key: "fruitWastePct", label: "Fruit Waste %", derived: true },
      { key: "gkYieldPct", label: "GK-Yield %", derived: true },
      { key: "totalYieldPct", label: "Total Yield %", derived: true },
      { key: "id", label: "Check ID", isNew: true },
      ...LOAD_IDS,
      { key: "decision", label: "Result", isNew: true, note: "OK, or Hold to dry and check again. A re-check is a new row." },
      { key: "status", label: "Approval", derived: true, isNew: true },
    ],
  },
  {
    // The client's "24. Wholes Manual Calibration", Sheet2: one QC-2 sample.
    id: "siloChecks",
    title: "Wholes Manual Calibration",
    file: "24. Wholes Manual Calibration.xlsx",
    aliases: ["24. Wholes Manual Calibration", "Silo Checks"],
    key: "id",
    dateKey: "date",
    dateLabel: "Date",
    fields: [
      { key: "date", label: "Date" },
      { key: "point", label: "Sampling Point", note: "The silo the sample came from (A++, A+, A, AB, B, BC, C, D, DE), or Received RCN." },
      { key: "binCode", label: "BIN NO", note: "Optional: the warehouse bin of the run the nuts came from." },
      { key: "sizeMm", label: "Size (mm)", derived: true },
      { key: "nutCount", label: "Nut Count per KG" },
      { key: "sampleG", label: "Sample Qty (gm)" },
      ...SAMPLE_GRAMS,
      { key: "errorG", label: "Error Check", derived: true },
      { key: "id", label: "Check ID", isNew: true },
      { key: "batchCode", label: "Batch Name", isNew: true, note: "The production run the sample is for." },
      { key: "decision", label: "Result", isNew: true, note: "OK, or Fail if the nuts must be moved to the right silo. A new check is a new row." },
      { key: "correctPct", label: "Correct Size (%)", derived: true, isNew: true },
      { key: "status", label: "Approval", derived: true, isNew: true },
    ],
  },
  {
    // The client's "6. Cooking Process Report", Sheet1.
    id: "cooking",
    title: "Cooking Process",
    file: "6. Cooking Process Report.xlsx",
    aliases: ["6. Cooking Process Report", "Cooking", "Cooking Process Report"],
    key: "id",
    dateKey: "date",
    dateLabel: "Date",
    fields: [
      { key: "date", label: "Date" },
      WEEK,
      MONTH,
      { ...LOT_LINK, note: "A new number makes the Lot, e.g. ANG26G16." },
      ...RUN_SIZES,
      { key: "totalKg", label: "Total Qty", derived: true },
      { key: "bags", label: "No of Bags", derived: true },
      { key: "damagedKg", label: "Damaged / Spoiled (kg)", isNew: true, note: "Lost in the cooker (a power cut, a breakdown). Part of Total Qty; it is never shelled." },
      { key: "id", label: "Cooking ID", isNew: true },
      { key: "batchCode", label: "Batch Name", isNew: true, note: "The production run the Lot is cooked for." },
    ],
  },
  entryTab("cooker_log", "Cooking Cycles Monitoring", { file: "17. Cooking Cycles Monitoring report.xlsx", fields: [
    SL_NO,
    { key: "date", label: "DATE" },
    WEEK,
    MONTH,
    v("cooker_log", "cookerNo", "Cooker No"),
    v("cooker_log", "size", "Size Description"),
    { key: "sizeMm", label: "Size (mm)", derived: true },
    v("cooker_log", "start", "Start Time"),
    v("cooker_log", "stop", "End Time"),
    { key: "totalTime", label: "Total Time", derived: true },
    v("cooker_log", "tempC", "Set temperature (deg C)"),
    v("cooker_log", "pressureBar", "Set Pressure (bar)"),
    LOT_LINK,
    v("cooker_log", "binNo", "Bin No"),
    v("cooker_log", "siloName", "Silo Name"),
    v("cooker_log", "gateNo", "Gate No"),
    v("cooker_log", "kg", "Quantity (kg's)"),
  ] }, ["Cooker Log", "Cooking Cycles Monitoring"]),
  {
    // The client's "7. Shelling process Report", Sheet1.
    id: "shellingDays",
    title: "Shelling Process",
    file: "7. Shelling process Report.xlsx",
    aliases: ["7. Shelling process Report", "Shelling Days", "Shelling process Report"],
    key: "id",
    dateKey: "date",
    dateLabel: "Date",
    fields: [
      { key: "date", label: "Date" },
      WEEK,
      MONTH,
      LOT_LINK,
      { key: "inputKg", label: "Input Quantity (Kg's)" },
      { key: "wholesKg", label: "Wholes (kg's)" },
      { key: "piecesKg", label: "Pieces (kg's)" },
      { key: "rejectionKg", label: "Rejection (kg's)" },
      { key: "oilKg", label: "Oil (kg's)" },
      { key: "blackRejectionKg", label: "Black Rejection (Kg's)" },
      { key: "firstPassUncutKg", label: "First Pass Uncut (kg's)" },
      { key: "finalUncutKg", label: "Final Uncut (kg's)" },
      { key: "shellDustKg", label: "Shell Dust", derived: true },
      { key: "shellKg", label: "Shell", derived: true },
      { key: "goodKg", label: "Good Kernels (kg's)", derived: true },
      { key: "finalKg", label: "Final Kernels (kg's)", derived: true },
      { key: "shotLbs", label: "SHOT (lbs)", derived: true },
      { key: "yieldPct", label: "Good Kernels Yield %", derived: true },
      { key: "realisationPct", label: "Final Realisation (%)", derived: true },
      { key: "wholesPct", label: "Wholes%", derived: true },
      { key: "uncutPct", label: "Uncut %", derived: true },
      { key: "id", label: "Day ID", isNew: true },
    ],
  },
  entryTab("line_run", "Shelling Line wise Data", { file: "23. Shelling Line wise Processing Data.xlsx", fields: [
    { key: "slNo", label: "Sr no", derived: true },
    { key: "date", label: "Date" },
    { ...LOT_LINK, label: "Lot number", aliases: ["Lot No"] },
    v("line_run", "line", "Line"),
    v("line_run", "size", "Size"),
    v("line_run", "inputKg", "Input Qty"),
    v("line_run", "start", "Start Time"),
    v("line_run", "end", "End Time"),
    { key: "duration", label: "Duration", derived: true },
    v("line_run", "uncutKg", "Uncut Qty"),
    v("line_run", "uncutStart", "Uncut Start Time"),
    v("line_run", "uncutEnd", "Uncut End Time"),
    { key: "uncutDuration", label: "Uncut Duration", derived: true },
    { key: "uncutPct", label: "Uncut %", derived: true },
    v("line_run", "breakdown", "Breakdown Time (mins)", "As the sheet has it, hh:mm (00:15 is 15 minutes)."),
    { key: "cuttingHrs", label: "Cutting Hrs", derived: true },
  ] }, ["Line Runs", "Shelling Line wise Processing Data"]),
  entryTab("qc5_frequency", "Shelling Machine Frequency", { file: "21.Shelling Frequency Machine Report.xlsx", fields: [
    { key: "date", label: "Date" },
    WEEK,
    v("qc5_frequency", "line", "Line"),
    v("qc5_frequency", "material", "Material", "The size the line is cutting: A++, A+, A, AB, B, BC, C, D or DE."),
    { ...LOT_LINK, label: "Lot Number", aliases: ["Lot No"] },
    v("qc5_frequency", "machine", "Machine No"),
    v("qc5_frequency", "gramsPerMin", "Per minutes"),
    { key: "perHour", label: "Per hour", derived: true },
  ] }, ["Machine Frequency", "Shelling Frequency Machine Report"]),
  entryTab("qc5_capacity", "Shelling Machine Quality", { file: "13. Shelling Machine Quality Reports.xlsx", fields: [
    { key: "date", label: "Date" },
    WEEK,
    LOT_LINK,
    v("qc5_capacity", "shift", "Shift"),
    v("qc5_capacity", "line", "Line"),
    v("qc5_capacity", "machine", "Machine No"),
    v("qc5_capacity", "sampleG", "Sample Qty (g)"),
    v("qc5_capacity", "wholesG", "Wholes (g)"),
    v("qc5_capacity", "piecesG", "Pieces (g)"),
    v("qc5_capacity", "edgeCutG", "Edge Cut (g)"),
    v("qc5_capacity", "buttsG", "Butts (g)"),
    v("qc5_capacity", "knifeMarkG", "Knife Mark (g)"),
    v("qc5_capacity", "uncutG", "Uncut (g)"),
    v("qc5_capacity", "unscoopWholesG", "Unscoop Wholes (g)"),
    v("qc5_capacity", "unscoopPiecesG", "Unscoop Pieces (g)"),
    v("qc5_capacity", "shellG", "Shell"),
    { key: "errorG", label: "Error", derived: true },
    { key: "uncutPct", label: "Uncut %", derived: true },
    { key: "unscoopPct", label: "Unscoop %", derived: true },
    { key: "totalKernels", label: "Total Kernels (g)", derived: true },
    { key: "knifeMarkPct", label: "Knife Mark %", derived: true },
    { key: "edgeCutPct", label: "Edgecut %", derived: true },
    { key: "wholesPct", label: "Wholes %", derived: true },
    { key: "piecesPct", label: "Pieces %", derived: true },
  ] }, ["Machine Samples", "Shelling Machine Quality Reports"]),
  entryTab("qc6", "Shell Waste Sample", { file: "11. Shell Waste Sample Report.xlsx", fields: [
    { key: "date", label: "Date" },
    WEEK,
    LOT_LINK,
    v("qc6", "point", "Sampling Point"),
    v("qc6", "sampleG", "Sample Qty (g)"),
    v("qc6", "wholeG", "Whole (g)"),
    v("qc6", "brokensG", "Brokens (g)"),
    v("qc6", "rejectionG", "Rejection (g)"),
    v("qc6", "unscoopG", "Unscoop (g)"),
    v("qc6", "uncutG", "Uncut (g)"),
    v("qc6", "shellG", "Shell (g)"),
    { key: "errorG", label: "Error", derived: true },
    { key: "kernelPct", label: "Kernel %", derived: true },
    { key: "kernelLbs", label: "Kernel lbs", derived: true },
  ] }, ["Shell Samples", "Shell Waste Sample Report"]),
  {
    // The client's "12. Shelled Kernels Quality Report" (Meyer Quality Report): QC-7 on both sides of the colour sorter,
    // one sheet, told apart by its Sampling Point. Its Before/After Borma rows belong to Borma, not built yet.
    id: "sorter",
    title: "Shelled Kernels Quality",
    file: "12. Shelled Kernels Quality Report.xlsx",
    aliases: [ENTRY_DEFS.qc7_before.sheet, "Shelled Kernels Quality Report", "Meyer Quality Report"],
    key: "id",
    dateKey: "date",
    dateLabel: "Date",
    fields: [
      { key: "date", label: "Date" },
      WEEK,
      LOT_LINK,
      v("qc7_before", "shift", "Shift"),
      { key: "point", label: "Sampling Point", note: `${SORTER_POINTS.map((p) => p.word).join(" or ")}: before or after the colour sorter.` },
      v("qc7_before", "sizes", "Sizes"),
      v("qc7_before", "sampleG", "Sample Qty (g)"),
      v("qc7_before", "nutCount", "Nut Count"),
      v("qc7_before", "moisture", "Moisture"),
      v("qc7_before", "wholesG", "Wholes (g)"),
      v("qc7_before", "brokensG", "Brokens (g)"),
      v("qc7_before", "buttsG", "Butts (g)"),
      v("qc7_before", "knifeMarkG", "Backcut (g)"),
      v("qc7_before", "rejectionG", "Rejection (g)"),
      v("qc7_before", "oilDirtG", "Adhering Matter/Oil (g)"),
      v("qc7_before", "edgeCutG", "Edge Cut (g)"),
      v("qc7_before", "uncutG", "Uncut"),
      v("qc7_before", "unscoopG", "Unscoop"),
      v("qc7_before", "shellG", "Shell (g)"),
      { ...v("qc7_before", "stream", "Stream"), isNew: true },
      { key: "id", label: "Entry ID", isNew: true },
      { key: "decision", label: "Result", isNew: true, note: "After CS rows only: OK, or No to sort again." },
      { key: "status", label: "Approval", derived: true, isNew: true },
    ],
  },
  {
    // The client's "21. Boiler Consumption": a day's shell burned. Running hours are the app's.
    id: "boiler",
    title: "Boiler Consumption",
    file: "21. Boiler Consumption.xlsx",
    aliases: ["21. Boiler Consumption", "Boiler"],
    key: "id",
    dateKey: "date",
    dateLabel: "Date",
    fields: [
      SL_NO,
      { key: "date", label: "DATE" },
      WEEK,
      MONTH,
      { key: "material", label: "Material", derived: true },
      { key: "shellKg", label: "QTY Consumed (Kg's)" },
      { key: "id", label: "Reading ID", isNew: true },
      { key: "runningHours", label: "Running Hours", isNew: true },
    ],
  },
  {
    // The client's "15. Waste Management Dispatch Tracker": a truck of waste, its Category saying which.
    id: "wasteTrucks",
    title: "Waste Management Dispatch",
    file: "15. Waste Management Dispatch Tracker.xlsx",
    aliases: ["15. Waste Management Dispatch", "Waste Management Dispatch Tracker", "Waste management Tracker"],
    key: "id",
    dateKey: "date",
    dateLabel: "Date",
    fields: [
      ...TRUCK_LEAD,
      { key: "category", label: "Category", note: `${WASTE_CATEGORIES.map((c) => c.word).join(", ")}.` },
      { key: "price", label: "Price (HT)" },
      ...TRUCK_GATE,
    ],
  },
  {
    // The client's "16. Shell Dispatch Tracker" (Shell Sales): a truck of shell sold.
    id: "shellTrucks",
    title: "Shell Dispatch Tracker",
    file: "16. Shell Dispatch Tracker.xlsx",
    aliases: ["16. Shell Dispatch Tracker", "Shell Sales"],
    key: "id",
    dateKey: "date",
    dateLabel: "Date",
    fields: [
      ...TRUCK_LEAD,
      { key: "price", label: "Price (HT)", isNew: true },
      ...TRUCK_GATE,
    ],
  },
  {
    id: "siloMoves",
    title: "Silo Moves",
    aliases: ["New · Silo Moves"],
    isNew: true,
    key: "id",
    dateKey: "date",
    dateLabel: "Date",
    fields: [
      { key: "date", label: "Date" },
      { key: "fromSize", label: "From Silo", note: "The silo that failed its check." },
      { key: "toSize", label: "To Silo" },
      { key: "kg", label: "Kg Moved" },
      { key: "id", label: "Move ID" },
    ],
  },
  entryTab("waste_water", "Cooking Waste Water", undefined, ["Waste Water"]),
  {
    id: "cooling",
    title: "Cooling",
    aliases: ["New · Cooling"],
    isNew: true,
    key: "lotCode",
    dateKey: "date",
    dateLabel: "Date in",
    fields: [
      { key: "date", label: "Date In" },
      { key: "time", label: "Time In", time: true },
      LOT_LINK,
      { key: "silo", label: "Cooling Silo" },
    ],
  },
  entryTab("qc4", "Cooling Checks", undefined, ["Cooling Checks"]),
  entryTab("qty1", "Uncut Checks", undefined, ["Uncut Checks"]),
];

/**
 * The file follows the floor, step by step (team decision, Nov 2026: tabs in the client's file-number order read as
 * random). Each stage is one colour on the tab strip; a tab's number is its step. The same order is the one an upload
 * runs in, so a row may rely on an earlier step's rows — a load made from the tally sheet before its check, a Lot
 * cooked, cooled and checked (QC-4) before it is shelled.
 */
export const STAGES: { name: string; color: string; tabs: TabId[] }[] = [
  { name: "Intake", color: "FF8D6E63", tabs: ["tally", "receipts", "checks"] },
  { name: "Calibration", color: "FFA1887F", tabs: ["siloChecks", "siloMoves"] },
  { name: "Cooking", color: "FFE57373", tabs: ["cooking", "entry:cooker_log", "entry:waste_water", "cooling", "entry:qc4"] },
  { name: "Shelling", color: "FFFFB74D", tabs: ["shellingDays", "entry:line_run", "entry:qc5_frequency", "entry:qc5_capacity", "entry:qty1", "entry:qc6"] },
  { name: "Colour sorting", color: "FF81C784", tabs: ["sorter"] },
  { name: "By-products", color: "FF90A4AE", tabs: ["boiler", "wasteTrucks", "shellTrucks"] },
];

export const TABS: Tab[] = STAGES.flatMap((st) => st.tabs.map((id) => ({ id, st }))).map(({ id, st }, i) => {
  const t = DEFINED.find((d) => d.id === id);
  if (!t) throw new Error(`No workbook tab ${id}`);
  // Its step number in front ("1. RCN Receipts"); the plain name stays readable, so a renumbering never breaks a file.
  return { ...t, title: `${i + 1}. ${t.title}`, aliases: [t.title, ...(t.aliases ?? [])], stage: st.name, color: st.color };
});

export const RUN_ORDER: TabId[] = TABS.map((t) => t.id);

/**
 * The warehouse's tabs: the load, its quality and its weighing, entered before production accepts it (Lokesh, 16 Nov 2026,
 * "Option 1"). Every other tab is the factory's, after the acceptance. The warehouse team sees only these in a download.
 */
export const INTAKE_TABS: readonly TabId[] = ["tally", "receipts", "checks"];

/**
 * Who may upload a tab: Admin and the Production Incharge, every tab, the RCN ones included (team, 18 Nov 2026). The
 * Warehouse Incharge records a load on screen. An upload needs no approval: what the file brings is the uploader's own.
 */
export function mayUploadTab(role: Role, _tab: TabId): boolean {
  return canRunProduction(role);
}

// Guards: every Lot record kind has a tab (the sorter's two share one), every tab runs, and Excel takes every title.
for (const kind of ENTRY_KINDS) {
  if (!TABS.some((t) => t.id === `entry:${kind}` || (t.id === "sorter" && SORTER_POINTS.some((p) => p.kind === kind)))) throw new Error(`No workbook tab for ${kind}`);
}
if (TABS.length !== DEFINED.length || new Set(RUN_ORDER).size !== TABS.length) throw new Error("STAGES must name every tab once");
{
  // One name never reads as two tabs.
  const names = TABS.flatMap((t) => [...new Set([t.title, ...(t.aliases ?? [])].map((n) => n.toLowerCase()))]);
  const twice = names.find((n, i) => names.indexOf(n) !== i);
  if (twice) throw new Error(`Two tabs answer to "${twice}"`);
}
for (const t of TABS) if (t.title.length > 31) throw new Error(`Excel cuts sheet names at 31 characters: "${t.title}"`);

/** A download's first sheet until Nov 2026 (it is no longer written): an older file's copy is read past on upload. */
export const README_TITLE = "Read me";

/**
 * A header as this workbook matches it. Keeps + < > % where the shared normalizeHeader drops them: the client's size
 * words differ only by those ("A++", "A+", "A"; "DE", "< DE"), and their sheets put a typed column next to its own
 * percentage ("Fruit Waste" / "Fruit Waste %", "Uncut (g)" / "Uncut %") — dropping them would read one as the other.
 */
export const tabHeader = (s: string): string =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/%/g, " % ").replace(/[^\p{L}\p{N}+<>%]+/gu, " ").trim();

/** "BIN-03B / BIN-03C", "374.3/211.2": the file's way of putting several values in one cell. */
export const splitList = (v: string | null): string[] => (v ?? "").split("/").map((s) => s.trim()).filter(Boolean);
export const joinList = (xs: (string | number)[]): string => xs.join(" / ");
