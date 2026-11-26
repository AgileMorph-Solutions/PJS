import type { PlanStatus, PlanProgress, ReceptionType, PlanFlag, PlanLinkStatus, ExceptionApproval } from "../domain/deliveryPlan.js";
import type { TransferState, TransferVariance } from "../domain/transfers.js";
export type ReceiptStatus =
  | "planned"
  | "arrived"
  | "pending_qa"
  | "rejected"
  | "pending_unload"
  | "unloaded"
  | "grn_completed"
  | "in_stock"
  | "in_drying"
  | "ready_for_production"
  | "transferred_out";

export interface TimelineEntry {
  status: ReceiptStatus;
  at: string;
  /**
   * Nullable, not just optional: seed/receipts.json carries `"note": null` on all 50 rows, and
   * the API echoes that rather than quietly dropping it.
   */
  note?: string | null;
  /** Display name of whoever caused this entry; absent on every row that predates user accounts. */
  actor?: string | null;
}

export interface ReceiptRecord {
  id: string;
  source: "imported" | "entered";
  arrivalDate: string;
  supplierName: string;
  lbaCode: string;
  vehicleNo: string;
  warehouse: string;
  origin?: string;
  /** Served from the joined n-lot stage row; there is no lotNo column on the receipts table. */
  lotNo?: string;
  /** Served from the joined n-bin stage row. One Bin holds many Lots — never the reverse. */
  binNo?: string;
  /** The REC-2026-NNNN id this receipt had before system IDs (Oct 2026), so old links still resolve. */
  legacyId?: string;
  /** The Delivery Plan this truck arrived against; absent for an unplanned truck, which is allowed. */
  deliveryPlanId?: string;
  /** Set once the GRN is complete (contract domain/recordLock.ts): from then on nothing can be changed until an Admin reopens it. */
  lockedAt?: string;
  lockedBy?: string;
  /** When the row was created. For a truck entered in the app that is the day it was typed in (the field rules compare the
   * arrival date with it); for an imported one it is the day of the import, so only use it when `source` is "entered". */
  createdAt?: string;
  stageData: Record<string, Record<string, string>>;
  branches: Record<string, string>;
  timeline: TimelineEntry[];
  /**
   * Set when the truck came from the Unit warehouse on a BKT instead of from a supplier (24 Nov 2026): one reception record
   * per lot on the truck. It has no supplier, LBA code or price; what was sent is read from the BKT, never copied.
   */
  transfer?: TransferOrigin;
}

/** Where a reception from the Unit warehouse came from: its BKT, the lot on it, and what was sent of that lot. */
export interface TransferOrigin {
  transferId: string;
  lineId: number;
  fromWarehouse: string;
  /** The Unit warehouse's lot (or, on an older BKT, its Bin or supplier Lot). */
  sentAs: string;
  truckNo: string | null;
  transporter: string | null;
  driver: string | null;
  driverPhone: string | null;
  dispatchedAt: string | null;
  sent: { bags: number | null; netKg: number | null; moisture: number | null; kor: number | null; nutCount: number | null };
}

/** A jute ledger row, keyed by the exact human column label from juteBags.ts. */
export type LedgerRow = Record<string, string>;
export type LedgerEntries = Record<string, LedgerRow[]>;

/** `active` is false for a supplier that is switched off (it still has history). Absent means active, so an
 * older payload or a freshly typed one reads as active. `formerName` is the name with the old "RCN" prefix. */
export interface Supplier {
  code: string; name: string; active?: boolean; formerName?: string | null;
  /** SUP-0001: permanent, issued by the system. */
  supplierNo?: string;
  status?: import("../domain/supplierProfile.js").SupplierStatus;
}

/** The supplier page: the whole LBA register entry plus the figures worked out from its transactions. */
export interface SupplierDetail extends Required<Pick<Supplier, "code" | "name" | "supplierNo" | "status">> {
  formerName: string | null;
  statusReason: string | null;
  profile: import("../domain/supplierProfile.js").SupplierProfileValues;
  /** "sample" when the register details are demo values, not given by the client. */
  detailsSource: string | null;
  completeness: { filled: number; total: number };
  missing: string[];
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  source: string | null;
  performance: import("../domain/supplierPerformance.js").SupplierPerformance;
  /** Trucks counted, and those recorded under this supplier's name but with no LBA code (so not counted). */
  references: SupplierReferences;
}

/** One supplier's line in the dashboard's supplier analytics: the same figures as its own page, for the period asked. */
export interface SupplierAnalyticsRow {
  /** "" for the line of trucks that carry no LBA code. */
  code: string;
  name: string;
  /** Null for a code that is not in the supplier register (a truck can carry one that was never registered). */
  status: import("../domain/supplierProfile.js").SupplierStatus | null;
  performance: import("../domain/supplierPerformance.js").SupplierPerformance;
}
export interface SupplierAnalytics {
  rows: SupplierAnalyticsRow[];
  /** Trucks with no LBA code, so that rows + this line + nothing else add up to every truck in the period. */
  noCode: SupplierAnalyticsRow | null;
  /** The same calculation over every truck, plan and jute movement in the period. */
  totals: import("../domain/supplierPerformance.js").SupplierPerformance;
  period: { from: string | null; to: string | null };
}

/** What a supplier is still used by, which decides whether it can be deleted or only switched off. */
export interface SupplierReferences { receipts: number; plans: number; jute: number; assignments: number; total: number }
/** `kind` (Village/Regional/Factory) is set only on SITE rows; `site` is null for a site row and
 * the parent site's name for a store row (e.g. "BKE-002" -> site "BOUAKE") — see
 * data/warehouseKinds.ts and Warehouse's self-relation in backend/prisma/schema.prisma. */
export interface WarehouseMaster {
  name: string; kind: string | null; type?: string | null; site: string | null;
  /** Site rows only: the code printed into every system ID issued there (REC-<code>-2027-001). */
  code?: string | null;
}
export interface WarehouseAliasMaster { alias: string; warehouseName: string }
export interface Masters {
  suppliers: Supplier[]; warehouses: WarehouseMaster[]; aliases?: WarehouseAliasMaster[]; bins: string[]; origins: string[];
  /** Which store each Bin is in (null = imported without one). */
  binInfo?: { code: string; store: string | null }[];
  /** Where each Origin came from ("seed/origins.json", a workbook, "upload: <file>", "entered") and when it was added in the app (null = observed in a workbook). */
  originInfo?: { name: string; source: string | null; createdAt: string | null }[];
}

export interface DryingJob {
  id: string; date: string; warehouse: string; bin: string;
  lotNo: string; ficheNo: string; status: string; dryType: string; destination: string;
}

/** Expected arrivals, recorded before the truck comes — the client's own "Delivery Plan" sheet. */
export interface DeliveryPlan {
  /** DP-<warehouse code>-<expected arrival year>-NNN */
  id: string;
  /** The sheet's "Planning Date". */
  plannedDeliveryDate: string | null;
  supplierName: string;
  supplierCode: string | null;
  expectedQuantityKg: number | null;
  expectedTruckType: string | null;
  expectedTrucks: number | null;
  expectedOrigin: string | null;
  /** The sheet's "Expected Delivery Start"; the end of the window follows. */
  expectedArrivalDate: string;
  expectedDeliveryEnd: string | null;
  /** The site the goods come to, and — when the plan names one — the store inside it. */
  destinationWarehouse: string;
  destinationStore: string | null;
  /** Null when the client has none; the 2026 source has no funding reference at all. */
  fundingReference: string | null;
  remarks: string | null;
  /** Where a reconstructed plan came from, verbatim; null for a real pre-alert. */
  planningBasis: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;

  // Everything below is derived from the linked receipts (domain/deliveryPlan.ts), never stored.
  status: PlanStatus;
  /** Past its window and not delivered or cancelled — reported beside `status`, not instead of it. */
  overdue: boolean;
  progress: PlanProgress;
  /** First truck's arrival date. */
  actualArrivalDate: string | null;
  truckNos: string[];
  receiptIds: string[];
}

/** One receipt's place against its plan — what Reception Type, flags and approval the list and detail show. */
export interface ReceiptPlanInfo {
  receiptId: string;
  deliveryPlanId: string | null;
  type: ReceptionType;
  flags: PlanFlag[];
  planLinkStatus: PlanLinkStatus;
  approval: ExceptionApproval;
  approvedAt: string | null;
  /** Display name of whoever approved. */
  approvedBy: string | null;
  approvalNote: string | null;
}

/** One truck on a plan's detail page: how it arrived, how it was judged, what it added to stock. */
export interface DeliveryPlanTruck {
  receiptId: string;
  arrivalDate: string;
  vehicleNo: string;
  supplierName: string;
  status: ReceiptStatus;
  rejected: boolean;
  /** The "Reason for rejection" typed at the reject stage; null when none was recorded (6 real receipts have none). */
  rejectionReason: string | null;
  /** GRN quantity; null until the GRN is recorded, when the truck has arrived but added no kg. */
  grnKg: number | null;
  lotNo: string | null;
  type: ReceptionType;
  flags: PlanFlag[];
  approval: ExceptionApproval;
}

/** A plan plus every truck recorded against it, in arrival order. */
export interface DeliveryPlanDetail extends DeliveryPlan {
  trucks: DeliveryPlanTruck[];
}

/** A soft problem found when this truck's row was uploaded; the upload went through regardless. */
export interface UploadIssueRecord {
  id: string;
  filename: string;
  sheet: string;
  row: number;
  column: string | null;
  severity: "warning" | "info";
  message: string;
  uploadedAt: string;
  uploadedBy: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

/**
 * One saved change to one stage field (backend StageFieldChange). `oldValue` null = the field was empty before.
 * Changes to fields a role may not see (price and amount for the Warehouse Incharge) never reach that role:
 * the server's response redaction drops any entry whose stageId + label is hidden.
 */
export interface FieldChangeRecord {
  id: number;
  stageId: string;
  label: string;
  oldValue: string | null;
  newValue: string | null;
  at: string;
  /** Who entered the value: the editor, the uploader, or — for an approved form — the person who submitted it. */
  by: string;
  /** For an approved form, who approved it. Null otherwise, and on approval rows logged before the submitter was linked
   * (those name the approver in `by`, the only person on record). */
  approvedBy: string | null;
  /** direct edit, applied from an approved submission, or written by a workbook upload */
  via: "direct" | "approval" | "import";
}

/** One line of a warehouse's Logs page: a field change, with the truck it was made on. */
export interface SiteFieldChangeRecord extends FieldChangeRecord {
  receiptId: string;
  vehicleNo: string;
  warehouse: string;
}

export type TransferStatus = "requested" | "dispatched" | "received";

export interface TransferLine {
  /** The line's own id: what the receiving side names it by (a Bin line has no receipt). */
  id: number;
  /**
   * The transfer lot this line carries a piece of (24 Nov 2026: a Unit warehouse makes lots out of its Bins and loads trucks
   * with them). Null on lines made per Lot or per Bin before that. Its bags are the piece on this truck; its net weight is the
   * lot's net shared by those bags, worked out, never typed.
   */
  transferLotId: number | null;
  transferLotNo: string | null;
  /**
   * The Bins that lot was made from (25 Nov 2026: every BKT comes from a Bin, but the From Bin column read only `binCode`, which
   * a lot line never has). For showing only: `binCode` stays null on a lot line, since binTransferMovements reads a set
   * `binCode` as a whole-Bin load and would take the lot out of its Bin a second time. Empty on lines that carry no lot.
   */
  transferLotBins: string[];
  /**
   * The Lot's receipt, on BKTs made per Lot. Null on a line made per Bin (22 Nov 2026: once RCN is in a Bin the Lots in
   * it can't be told apart, so a truck is loaded from Bins) — `binCode` is then what was sent.
   */
  receiptId: string | null;
  lotNumber: string | null;
  supplierName: string;
  vehicleNo: string;
  fiche: string | null;
  bags: number | null;
  netWeightKg: number | null;
  /** Quality as dispatched; null on transfers made before it was required. */
  moisture: number | null;
  kor: number | null;
  nutCount: number | null;
  /** Where it was loaded from: the Bin of a Bin line (always set), or the Lot's Bin(s) on a Lot line. */
  binCode: string | null;
  /**
   * The receiving warehouse's bin the Lot was unloaded into ("BIN NO." on the client's Bouake RCN
   * Receiving at Factory sheet). It is what puts the Lot into that site's bin stock, and so within
   * reach of a production batch. Null until received, and on BKTs received before it was asked.
   */
  receivedBinCode: string | null;
  /**
   * Bags of this Lot counted off the truck at the receiving site. The truck is weighed once, so these
   * counts are what its net at arrival is shared by. Null until received, and on BKTs received before it was asked.
   */
  bagsReceived: number | null;
  /**
   * The reception record at the receiving warehouse for this lot (24 Nov 2026): a truck from the Unit warehouse goes through
   * the same reception as a supplier truck, one record per lot on it. Null until the truck's reception is started.
   */
  receptionId: string | null;
  /** That reception's own Lot number there, once quality passed. */
  receivedLotNo: string | null;
}

/** Where a transfer lot stands, worked out from its weighing and the BKTs it is on (domain/transferLot.ts), never stored. */
/** `put_back`: none of it went on a truck, every bag was put back in a Bin. `closed`: some went, the rest was put back. */
export type TransferLotStatus = "waiting_weight" | "waiting_quality" | "ready" | "part_loaded" | "loaded" | "put_back" | "closed";

/**
 * A lot a Unit warehouse makes out of its Bins to send to the Central one (24 Nov 2026): a Bin holds hundreds of tonnes, so
 * bags are taken out of one or more Bins, weighed together, and the lot goes on one or more trucks (BKTs).
 */
export interface TransferLot {
  id: number;
  /** LOT-<code>-<year>-NNNN, issued from the warehouse's own Lot numbers; the person may change it. */
  lotNo: string;
  warehouse: string;
  lotDate: string;
  remarks: string | null;
  /** The bags taken from each Bin, with each Bin's share of the weight (by bags) once the lot is weighed. */
  bins: { binCode: string; bags: number; netKg: number | null }[];
  bags: number;
  /** What the scale read: RCN plus bags. Null until weighed. */
  grossWeightKg: number | null;
  /** grossWeightKg − 1 kg per bag (receiptMath's BAG_WEIGHT_KG). */
  netKg: number | null;
  moisture: number | null;
  kor: number | null;
  nutCount: number | null;
  /** The pieces of it on BKTs, oldest first. */
  pieces: { transferId: string; bags: number; netKg: number | null; status: TransferStatus }[];
  /** Bags of it put back in a Bin instead of going on a truck (26 Nov 2026), oldest first, each with its share of the net. */
  returns: { id: number; binCode: string; bags: number; netKg: number | null; date: string; by: string | null }[];
  /** Bags still to go on a truck or be put back: the lot's bags less what is on trucks and what was put back. */
  leftBags: number;
  leftKg: number | null;
  status: TransferLotStatus;
  createdAt: string;
  createdBy: string | null;
}

/**
 * A request to move Lots between warehouses. One BKT is one truck / voyage: the truck is on the
 * header, and what leaves (dispatch) and what arrives (receive) are separate sets of fields written
 * by the two warehouses, with the receiving side blank until the truck actually arrives.
 */
export interface TransferRequest {
  /** BKT-<transfer year>-NNN */
  id: string;
  transferDate: string;
  fromWarehouse: string;
  /** The destination SITE: it decides who sees this BKT and who records its arrival. */
  toWarehouse: string;
  /** The store chosen at that site, from Masters. Null when the BKT named only the site. */
  toStore: string | null;
  /** The step: requested → dispatched → received. `state` is what a person reads. */
  status: TransferStatus;
  remarks: string | null;
  lines: TransferLine[];

  /** The warehouse receipt number of the dispatch and of the receiving; null before they were required. */
  dispatchWhReceiptNo: string | null;
  receiveWhReceiptNo: string | null;
  truckNo: string | null;
  transporter: string | null;
  driver: string | null;
  driverPhone: string | null;
  dispatchedGrossKg: number | null;
  dispatchedAt: string | null;
  dispatchedBy: string | null;

  bagsReceived: number | null;
  damagedBags: number | null;
  receivedGrossKg: number | null;
  korReceived: number | null;
  moistureReceived: number | null;
  nutCountReceived: number | null;
  receivedComment: string | null;
  receivedLotNoRaw: string | null;
  receivedAt: string | null;
  receivedBy: string | null;

  // Derived (domain/transfers.ts), never stored.
  state: TransferState;
  variance: TransferVariance;
}
