/**
 * What a person sees in the workbook: each sheet's plain-language title and its columns, in order,
 * each with a plain header ("Arrival Date", not `Receipt.arrivalDate` or `arrivalDate`).
 *
 * The engine (read/plan/apply) works on KEYS — the database column, or `Table.column` on the
 * Receipt sheet. This file is the only place keys meet labels; write.ts shows labels, plan.ts maps
 * an uploaded header back to its key. A column that isn't listed here is simply not in the file, and
 * an upload that lacks a column leaves that field alone, so hiding is always safe.
 *
 * Inspired by the client's own sheets (docs/Procurement/new sheets/), not copied: the same words
 * for the same things, but without their pivot-table leftovers, duplicate columns or French. What is
 * left out, deliberately:
 *   - the app's own columns (source, sheetRow, createdAt, seq, activityCategory, …);
 *   - values the app works out (status, running balance, weight/bag differences, loss %), which
 *     nobody provides;
 *   - the warehouse a row belongs to, which the section already decides.
 * Where the database keeps a hand-typed value only as text (a date written "13-01-2026"), it gets its
 * own "… (as written)" column, so that information is still visible and survives a round trip.
 */
import { PROFILE_FIELDS } from "@anagroci/contract/domain/supplierProfile";
import type { WarehouseType } from "@anagroci/contract/data/warehouseTypes";

export interface FieldDef {
  key: string;
  label: string;
  /** Other headers an upload may still use for this column (a label the client had us rename), so an
   * older export keeps working instead of the column silently dropping out. */
  aka?: string[];
}
type Pair = [key: string, label: string];

export interface SheetFields {
  /** The Excel sheet name. */
  title: string;
  /** Label of the first column: what identifies a row (`Receipt ID`, `Row ID`, `Supplier Code`). */
  idLabel: string;
  /** Columns, key first. May differ by section (Unit vs Central). */
  fields(type: WarehouseType): FieldDef[];
  /** On a new row, these columns default to the section's warehouse when left blank. */
  defaultToSection?(type: WarehouseType): string[];
}

const defs = (pairs: Pair[]): FieldDef[] => pairs.map(([key, label]) => ({ key, label }));
const withAka = (fields: FieldDef[], key: string, aka: string[]): FieldDef[] => fields.map((f) => (f.key === key ? { ...f, aka } : f));
const zip = (keys: string[], labels: string[], prefix = ""): Pair[] => {
  if (keys.length !== labels.length) throw new Error(`fields.ts: ${keys.length} keys vs ${labels.length} labels`);
  return keys.map((k, i) => [k, `${prefix}${labels[i]}`]);
};

// ── Lab panels ───────────────────────────────────────────────────────────────────────────────────
const LAB = ["Rejection (g)", "Void (g)", "Oil (g)", "Total Defect (g)", "Good Kernel (g)", "Immature (g)", "Spotted (g)",
  "Total Kernels (g)", "KOR", "Shot", "FOT", "Useful Kernels Yield (%)", "Total Yield (%)", "Moisture (%)", "Nut Count", "Shell (g)"];

const SAMPLING = ["Browns", "Voids", "Oil", "TotDefect", "GoodKernel", "Immature", "Spotted", "TotKernels", "Kor", "Shot", "Fot",
  "UsefulKernelsYield", "TotalYield", "Moisture", "Nc", "Shell"];

/** Bouaké's two panels: the sample, and the final offloading result. */
const unitPanels = (): Pair[] => [
  ...zip(SAMPLING.map((s) => `sampling${s}`), LAB, "Sample – "),
  ...zip(SAMPLING.map((s) => `finalOffload${s}`), LAB, "Final – "),
];

/** Yakro's two panels (q1 = sample, q2 = final), which add the Murli figures. */
const centralPanels = (): Pair[] => [
  ...zip(
    ["q1RejectionG", "q1VoidG", "q1OilG", "q1TotalDefectG", "q1GoodKernelG", "q1ImmatureG", "q1SpottedG", "q1TotalKernelsG", "q1Kor", "q1Murli",
      "q1Shot", "q1Fot", "q1UsefulKernelYieldPct", "q1TotalYieldPct", "q1MoisturePct", "q1NutCount", "q1ShellG"],
    [...LAB.slice(0, 9), "Murli", ...LAB.slice(9)], "Sample – "),
  ...zip(
    ["q2RejectionG", "q2MurliTotalPct", "q2VoidG", "q2OilG", "q2TotalDefectG", "q2GoodKernelG", "q2ImmatureG", "q2SpottedG", "q2TotalKernelsG", "q2Kor",
      "q2Murli", "q2AfterDryKor", "q2Shot", "q2Fot", "q2UsefulKernelYieldPct", "q2TotalYieldPct", "q2MoisturePct", "q2NutCount", "q2ShellG"],
    ["Rejection (g)", "Murli Total (%)", "Void (g)", "Oil (g)", "Total Defect (g)", "Good Kernel (g)", "Immature (g)", "Spotted (g)", "Total Kernels (g)",
      "KOR", "Murli", "After-Dry KOR", "Shot", "FOT", "Useful Kernels Yield (%)", "Total Yield (%)", "Moisture (%)", "Nut Count", "Shell (g)"], "Final – "),
];

// ── Sheets ───────────────────────────────────────────────────────────────────────────────────────

/** The cut test of the sample and the final panel — the grams KOR and Final KOR are calculated from. */
const CUT_TEST_GRAMS: Pair[] = (["Sample", "Final"] as const).flatMap((panel) =>
  (["GoodKernel", "Immature", "Spotted", "Rejection", "Void", "Oil", "Shell"] as const).map((g): Pair => [
    `StageQualityQfs.${panel.toLowerCase()}${g}G`,
    `${panel} – ${g.replace("GoodKernel", "Good Kernel")} (g)`,
  ])
);

/** Truck Reception: one row per truck, in the order the client's own sheet reads. The first four
 * (arrival date, supplier name, supplier code, truck no) are the receipt's own columns; the app keeps
 * the matching stage fields in step with them on upload (receiptSheet.ts). */
const RECEIPT: Pair[] = [
  ["Receipt.id", "Receipt ID"],
  ["Receipt.arrivalDate", "Arrival Date"],
  ["StageUnload.dateOfOffloading", "Offloading Date"],
  ["StageGateEntry.creditCash", "Payment Type"],
  ["StageGateEntry.whLocation", "Warehouse Location"],
  ["StageGateEntry.whNo", "Warehouse Code"],
  ["Receipt.supplierName", "Supplier Name"],
  ["Receipt.lbaCode", "Supplier Code"],
  ["Receipt.vehicleNo", "Truck No"],
  ["StageVerifyDocs.ficheCode", "Fiche Code"],
  ["StageVerifyDocs.fiche", "Fiche No"],
  ["Receipt.origin", "Origin"],
  ["StageQualityQfs.moisture", "Moisture (%)"],
  ["StageQualityQfs.nutCount", "Nut Count"],
  ["StageQualityQfs.kor", "KOR"],
  ["StageQualityQfs.finalKor", "Final KOR"],
  // The cut test behind KOR (client, Oct 2026: the system calculates KOR when these are recorded).
  ...CUT_TEST_GRAMS,
  ["ReceiptBranch.n-qfs", "Quality Result"],
  ["StageRejection.reason", "Rejection Reason"],
  ["StageGrossWeight.loadedTruckWtKgs", "Loaded Truck Weight (kg)"],
  ["StageGrossWeight.grossWtKgs", "Gross Weight (kg)"],
  ["StageTareWeight.tareWtKgs", "Tare Weight (kg)"],
  ["StageNetWeight.netWtKgs", "Net Weight (kg)"],
  ["StageNetWeight.paidWt", "Paid Weight (kg)"],
  ["StageUnload.sacs", "Bags Count"],
  ["StageUnload.bonSacs", "Good Bags"],
  ["StageUnload.humidSacs", "Humid Bags"],
  ["StageUnload.sacsDechires", "Torn Bags"],
  ["StageUnload.refraction", "Refraction (kg)"],
  ["StageGrn.price", "Price (CFA/kg)"],
  ["StageGrn.amount", "Amount (CFA)"],
  ["StageGrn.grnWeight", "GRN Quantity (kg)"],
  ["StageLotAssignment.lotNumber", "Lot No"],
  ["StageBinAllocation.binNumber", "Bin No"],
  ["StageGateEntry.remarks", "Remarks"],
  ["StageGateEntry.week", "Week"],
  // Worked out by the app — the file shows them, an upload never writes them.
  ["status (derived)", "Receipt Status"],
  ["plan.deliveryPlanId", "Delivery Plan ID"],
  ["plan.receptionType", "Reception Type"],
  ["plan.flags", "Planning / Exception Flag"],
  ["plan.linkStatus", "Plan Link Status"],
  ["plan.approval", "Exception Approval Status"],
];

const DISCHARGE_COMMON: Pair[] = [
  ["id", "Row ID"], ["sn", "No"], ["warehouse", "Warehouse"], ["unloadingBin", "Unloading Bin"], ["afterDryingBin", "After Drying Bin"],
  ["lotNo", "Lot No"], ["scaleLocation", "Scale Location"], ["whReceiptNo", "Warehouse Receipt No"], ["ficheCca", "Fiche CCA No"],
  ["truckNo", "Truck No"], ["arrivalDate", "Arrival Date"], ["arrivalDateRaw", "Arrival Date (as written)"],
  ["dischargeDate", "Discharge Date"], ["dischargeDateRaw", "Discharge Date (as written)"], ["origin", "Origin"],
  ["supplierName", "Supplier Name"], ["supplierCode", "Supplier Code"],
  ["bonSacs", "Good Bags"], ["humidSacs", "Humid Bags"], ["tornSacs", "Torn Bags"], ["reconSacs", "Recondition Bags"],
  ["totalSacsLot", "Total Bags in Lot"], ["sacsExports", "Export Bags"], ["sacsBio", "Bio Bags"], ["sacsBrousses", "Brousse Bags"],
  ["totalRecd", "Total Bags Received"], ["grossWtRecd", "Gross Weight Received (kg)"], ["totalRefraction", "Total Refraction (kg)"],
  ["grnQty", "GRN Quantity (kg)"], ["weightPaid", "Paid Weight (kg)"], ["netWeight", "Net Weight (kg)"],
  ["grnFreshQty", "GRN Fresh Quantity (kg)"], ["grnDriedQty", "GRN Dried Quantity (kg)"],
];

/** Only the Yakro "Warehouse Receiving" source carries these. */
const DISCHARGE_CENTRAL_EXTRA: Pair[] = [
  ["lotDry", "Lot Dry"], ["deliveryNoteNo", "Delivery Note No"], ["ficheDateRaw", "Fiche Date"], ["activity", "Activity"],
  ["ccakValidated", "CCAK Validated"], ["storageArea", "Storage Area"], ["ccaNo", "CCA No"],
  ["goodBagsOffloaded", "Good Bags Offloaded"], ["damagedBagsOffloaded", "Damaged Bags Offloaded"],
  ["totalBagsDischarged", "Total Bags Discharged"], ["reconditionBags", "Recondition Bags Counted"], ["totalBagsStock", "Total Bags in Stock"],
  ["newBagsUsedRecondition", "New Bags Used to Recondition"], ["netWeightBookKg", "Net Weight, Book (kg)"],
];

const DRYING: Pair[] = [
  ["id", "Row ID"], ["sn", "No"], ["dryingDate", "Drying Date"], ["warehouse", "Warehouse"], ["sourceBinNo", "Source Bin"],
  ["destinationBinNo", "Destination Bin"], ["lotNo", "Lot No"], ["lotNoRaw", "Lot No (as written)"], ["whReceiptNoRaw", "Warehouse Receipt No"],
  ["ficheNoRaw", "Fiche No"], ["originRaw", "Origin"], ["supplierNameRaw", "Supplier Name"], ["supplierCodeRaw", "Supplier Code"],
  ["ccakSupplierCodeRaw", "CCAK Supplier Code"], ["status", "Status"], ["dryType", "Dry Type"], ["destinationRaw", "Destination"],
  ["issuedGrossWithBagsPalletsKg", "Issued Gross Weight with Bags & Pallets (kg)"], ["issuedPalletWeightKg", "Issued Pallet Weight (kg)"],
  ["issuedGrossWithBagsKg", "Issued Gross Weight with Bags (kg)"], ["issuedBags", "Issued Bags"], ["issuedNetWeightKg", "Issued Net Weight (kg)"],
  ["receivedGrossWithBagsPalletsKg", "Received Gross Weight with Bags & Pallets (kg)"], ["receivedPalletWeightKg", "Received Pallet Weight (kg)"],
  ["receivedGrossWithBagsKg", "Received Gross Weight with Bags (kg)"], ["receivedBags", "Received Bags"], ["receivedNetWeightKg", "Received Net Weight (kg)"],
  ["inputMoisturePct", "Input Moisture (%)"], ["inputNutCount", "Input Nut Count"], ["inputKor", "Input KOR"],
  ["outputMoisturePct", "Output Moisture (%)"], ["outputNutCount", "Output Nut Count"], ["outputKor", "Output KOR"],
  ["oil", "Oil (g)"], ["rejection", "Rejection (g)"], ["goodKernel", "Good Kernel (g)"], ["immature", "Immature (g)"], ["spotted", "Spotted (g)"],
  ["shell", "Shell (g)"], ["void", "Void (g)"],
  ["dryingLossKg", "Drying Loss (kg)"], ["triageLossKg", "Triage Loss (kg)"], ["damagedNutsKg", "Damaged Nuts (kg)"],
  ["inputBagsForDrying", "Input Bags for Drying"], ["outputBagsAfterDrying", "Output Bags After Drying"], ["dryingOrPicking", "Drying or Picking"],
  ["remarks", "Remarks"], ["issuedToProduction", "Issued to Production"], ["reDryingDate", "Re-drying Date"],
  ["moistureFirstRedryPct", "Moisture After First Re-dry (%)"], ["moistureSecondDryPct", "Moisture After Second Dry (%)"],
];

const DRYING_SORTING: Pair[] = [
  ["id", "Row ID"], ["sn", "No"], ["dryingDate", "Date"], ["warehouse", "Warehouse"], ["unloadingBin", "Unloading Bin"],
  ["afterDryingBin", "After Drying Bin"], ["lotNo", "Lot No"], ["lotNoRaw", "Lot No (as written)"], ["whReceiptNoRaw", "Warehouse Receipt No"],
  ["origin", "Origin"], ["supplierName", "Supplier Name"], ["supplierCodeAnagroci", "Supplier Code (Anagroci)"],
  ["supplierCodeCcak", "Supplier Code (CCAK)"], ["issuedNetWeightGrn", "Issued Net Weight, GRN (kg)"],
  ["receivedNetWeightAfterDrying", "Received Net Weight After Drying (kg)"], ["inputMoisture", "Input Moisture (%)"],
  ["inputNutCount", "Input Nut Count"], ["inputKor", "Input KOR"], ["outputMoisture", "Output Moisture (%)"],
  ["outputNutCount", "Output Nut Count"], ["outputKor", "Output KOR"], ["drainageLossKg", "Drying Loss (kg)"],
  ["damagedNutsKgTriage", "Damaged Nuts, Triage (kg)"], ["inputBagsForDrying", "Input Bags for Drying"],
  ["outputBagsAfterDrying", "Output Bags After Drying"], ["dryingPicking", "Drying or Picking"], ["remarks", "Remarks"],
];

const DISPATCH: Pair[] = [
  ["id", "Row ID"], ["sn", "No"], ["chargeDate", "Loading Date"], ["vyogeNumber", "Voyage Number"], ["remark", "Remarks"],
  ["scaleLocation", "Scale Location"], ["warehouse", "Warehouse"], ["whOrDirect", "Warehouse or Direct"], ["bin", "Bin"], ["origin", "Origin"],
  ["truckNo", "Truck No"], ["transporter", "Transporter"], ["driver", "Driver"], ["phone", "Phone"], ["whReceiptNo", "Warehouse Receipt No"],
  ["ficheCca", "Fiche CCA No"], ["binwiseLoadedBags", "Bags Loaded (This Bin)"], ["totalBags", "Total Bags"], ["grossWt", "Gross Weight (kg)"],
  ["netWeight", "Net Weight (kg)"], ["status", "Status"], ["unloadingStatus", "Unloading Status"],
  ...zip(["browns", "voids", "oil", "totDefect", "goodKernel", "immature", "spotted", "totKernels", "kor", "shot", "fot", "usefulKernelsYield",
    "totalYield", "moisture", "nc", "shell"], LAB),
  ["bagsYakro", "Bags Received at Yakro"], ["grossYakro", "Gross Weight at Yakro (kg)"],
];

const TRANSFER: Pair[] = [
  ["id", "Row ID"], ["sn", "No"], ["receivedDate", "Date"], ["month", "Month"], ["dryUndry", "Dry or Undry"], ["idTransfer", "Transfer ID"],
  ["truckRegistration", "Truck Registration"], ["lotNo", "Lot No"], ["lotDry", "Lot Dry"], ["noFiche", "Fiche No"],
  ["ccaFicheNumber", "CCA Fiche No"], ["binNo", "Bin No"], ["sourceWarehouse", "From Warehouse"], ["destinationWarehouse", "To Warehouse"],
  ["origin", "Origin"], ["bagsDispatched", "Bags Dispatched"], ["bagsReceived", "Bags Received"], ["damagedBags", "Damaged Bags"],
  ["newBagsUsed", "New Jute Bags Used"], ["recondition", "Reconditioned Bags"], ["laissePasserEntree", "Laissez-Passer (Entry)"],
  ["fullyLoadedTruckWeight", "Loaded Truck Weight (kg)"], ["emptyTruckTareWeight", "Empty Truck Weight (kg)"],
  ["grossWeightReceived", "Gross Weight Received (kg)"], ["netWeightAtArrival", "Net Weight at Arrival (kg)"],
  ["netWeightDispatched", "Net Weight Dispatched (kg)"], ["korReceived", "KOR Received"], ["korDispatched", "KOR Dispatched"],
  ["moistureReceived", "Moisture Received (%)"], ["moistureDispatched", "Moisture Dispatched (%)"], ["ncArrival", "Nut Count at Arrival"],
  ["comment", "Comment"],
];

const JUTE: Pair[] = [
  ["id", "Row ID"], ["sn", "No"], ["movementDate", "Date"], ["rawDate", "Date (as written)"], ["activitiesType", "Activity Type"],
  ["supplierCode", "Supplier Code"], ["whLocation", "Warehouse Location"], ["truckNumber", "Truck No"], ["wrNo", "Warehouse Receipt No"],
  ["bagsIssued", "Bags Issued"], ["bagsReceived", "Bags Received"],
];

const LEDGER: Pair[] = [
  ["id", "Row ID"], ["activityDate", "Date"], ["activityDateRaw", "Date (as written)"], ["activityType", "Activity Type"],
  ["particulars", "Particulars"], ["offloaded", "Offloaded"], ["bags", "Bags"], ["quantityMt", "Quantity (MT)"], ["ficheNo", "Fiche No"],
  ["lotNo", "Lot No"], ["vendor", "Vendor"], ["rate", "Rate"], ["total", "Total"], ["referenceNo", "Reference No"], ["remarks", "Remarks"],
  ["grossWeightWithPalletKg", "Gross Weight with Pallet (kg)"], ["palletCount", "Pallet Count"], ["grossWeightKg", "Gross Weight (kg)"],
  ["grossWeightWithoutPalletKg", "Gross Weight without Pallet (kg)"], ["netWeightKg", "Net Weight (kg)"],
];

const ISSUED: Pair[] = [
  ["id", "Row ID"], ["btmNo", "BTM No"], ["sNo", "No"], ["date", "Date"], ["rcn", "RCN"], ["sourceBin", "Source Bin"], ["dryBin", "Dry Bin"],
  ["binStatus", "Bin Status"], ["korIssued", "KOR Issued"], ["nutCount", "Nut Count"], ["gk", "Good Kernel"], ["moisture", "Moisture"],
  ["immature", "Immature"], ["spotted", "Spotted"], ["rejection", "Rejection"], ["oilGram", "Oil (g)"], ["voidGram", "Void (g)"],
  ["shellGram", "Shell (g)"], ["ficheNo", "Fiche No"], ["bagInStockAfterDry", "Bags in Stock After Drying"],
  ["noOfBagIssuedToProduction", "Bags Issued to Production"], ["avgBagWtEmptyBag", "Average Empty Bag Weight"], ["bagWtEmptyBag", "Empty Bag Weight"],
  ["noOfPallet", "Number of Pallets"], ["avgPalletWt", "Average Pallet Weight"], ["palletWeightKg", "Pallet Weight (kg)"],
  ["grossWtBeforeDry", "Gross Weight Before Drying"], ["grossWtAfterDryingWithJuteBag", "Gross Weight After Drying, with Jute Bag"],
  ["netWtWithoutJuteBag", "Net Weight, without Jute Bag"], ["dateOfIssueToCalibration", "Date of Issue to Calibration"],
  ["receivedByProductionNetWt", "Received by Production, Net Weight"], ["issuedFrom", "Issued From"], ["remarks", "Remarks"],
];

/** The client's own Delivery Plan sheet (their column names), then what the app works out from the trucks. For reading. */
const DELIVERY_PLAN: Pair[] = [
  ["id", "Delivery Plan ID"], ["planningDate", "Planning Date"], ["supplierCode", "LBA Code"], ["supplierName", "Supplier Name"],
  ["expectedOrigin", "Expected Origin"], ["destinationStore", "Destination Warehouse"], ["expectedStart", "Expected Delivery Start"],
  ["expectedEnd", "Expected Delivery End"], ["expectedQuantityKg", "Expected Quantity (kg)"], ["expectedTrucks", "Expected Trucks"],
  ["fundingReference", "Purchase / Funding Reference"], ["status", "Plan Status"], ["actualKg", "Actual Received Quantity (kg)"],
  ["arrivals", "Actual Arrivals"], ["acceptedTrucks", "Accepted Trucks"], ["remainingKg", "Remaining Quantity (kg)"],
  ["varianceKg", "Quantity Variance (kg)"], ["overdue", "Overdue"], ["remarks", "Remarks"], ["cancelReason", "Cancel Reason"],
  ["planningBasis", "Planning Basis"],
];

/** One row per BKT = one truck / voyage: what left, what arrived, and the difference. For reading. */
const BKT: Pair[] = [
  ["id", "BKT"], ["transferDate", "Date"], ["fromWarehouse", "From Warehouse"], ["toWarehouse", "To Warehouse"], ["state", "Transfer Status"],
  ["truckNo", "Truck Registration"], ["transporter", "Transporter"], ["driver", "Driver"], ["driverPhone", "Phone"],
  ["lots", "Lot No"], ["bins", "Bin No"], ["bagsDispatched", "Bags Dispatched"], ["dispatchedGrossKg", "Loaded Truck Weight (kg)"],
  ["netDispatchedKg", "Net Weight Dispatched (kg)"], ["dispatchedAt", "Dispatched At"],
  ["bagsReceived", "Bags Received"], ["damagedBags", "Damaged Bags"], ["receivedGrossKg", "Gross Weight Received (kg)"],
  ["netAtArrivalKg", "Net Weight at Arrival (kg)"], ["korReceived", "KOR Received"], ["moistureReceived", "Moisture Received (%)"],
  ["nutCountReceived", "Nut Count at Arrival"], ["receivedLotNoRaw", "Receiving Lot No (as written)"], ["receivedAt", "Received At"],
  ["bagVariance", "Bag Variance"], ["weightVarianceKg", "Weight Variance (kg)"], ["receivedComment", "Comment"], ["remarks", "Remarks"],
];

const same = (pairs: Pair[]) => () => defs(pairs);

/** Keyed by the internal sheet id (the table name, or "Receipt"). Order = the order sheets appear in the file. */
export const SHEET_FIELDS: Record<string, SheetFields> = {
  // "GRN Weight (kg)" is what this column was called before the client's wording ("GRN Quantity") replaced it.
  Receipt: { title: "Truck Reception", idLabel: "Receipt ID", fields: () => withAka(defs(RECEIPT), "StageGrn.grnWeight", ["GRN Weight (kg)"]) },
  DeliveryPlan: { title: "Delivery Plan", idLabel: "Delivery Plan ID", fields: same(DELIVERY_PLAN) },
  TransferRequest: { title: "BKT Transfers", idLabel: "BKT", fields: same(BKT) },
  WarehouseDischarge: {
    title: "Warehouse Receiving", idLabel: "Row ID",
    fields: (type) => defs(type === "UNIT"
      ? [...DISCHARGE_COMMON, ...unitPanels()]
      : [...DISCHARGE_COMMON, ...DISCHARGE_CENTRAL_EXTRA, ...centralPanels()]),
  },
  DryingBatch: { title: "Drying", idLabel: "Row ID", fields: same(DRYING) },
  DryingSortingReport: { title: "Drying & Sorting", idLabel: "Row ID", fields: same(DRYING_SORTING) },
  WarehouseDispatchLine: { title: "Dispatch", idLabel: "Row ID", fields: same(DISPATCH) },
  JuteWarehouseTransferReceipt: {
    title: "Stock Transfers", idLabel: "Row ID", fields: same(TRANSFER),
    // A transfer goes from Bouaké to Yakro: the Unit side fills in the From, the Central side the To.
    defaultToSection: (type) => (type === "UNIT" ? ["sourceWarehouse"] : ["destinationWarehouse"]),
  },
  JuteWarehouseMovement: { title: "Jute Bags", idLabel: "Row ID", fields: same(JUTE), defaultToSection: () => ["whLocation"] },
  WarehouseActivityLedgerEntry: { title: "Activity Ledger", idLabel: "Row ID", fields: same(LEDGER) },
  IssuedToProduction: { title: "Issued to Production", idLabel: "Row ID", fields: same(ISSUED) },
  // The LBA register: the client fills these in bulk here as well as on each supplier's page (labels from contract supplierProfile.ts).
  Supplier: {
    title: "Suppliers", idLabel: "Supplier Code",
    fields: same([
      ["code", "Supplier Code"], ["supplierNo", "Supplier ID"], ["name", "Supplier Name"],
      ...PROFILE_FIELDS.filter((f) => f.key !== "name").map((f) => [f.key, f.label] as Pair),
      ["status", "Status"],
    ]),
  },
};

/** How a header is compared: case, spacing and punctuation don't matter ("price (cfa/kg)" = "Price CFA kg"). */
export const normalizeHeader = (s: string): string =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
