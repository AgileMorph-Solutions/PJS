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
  stageData: Record<string, Record<string, string>>;
  branches: Record<string, string>;
  timeline: TimelineEntry[];
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
export interface Masters { suppliers: Supplier[]; warehouses: WarehouseMaster[]; aliases?: WarehouseAliasMaster[]; bins: string[]; origins: string[] }

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

export type TransferStatus = "requested" | "dispatched" | "received";

export interface TransferLine {
  receiptId: string;
  lotNumber: string | null;
  supplierName: string;
  vehicleNo: string;
  fiche: string | null;
  bags: number | null;
  netWeightKg: number | null;
  /** Where the Lot was loaded from; a truck loading from several Bins shows them all. */
  binCode: string | null;
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
  toWarehouse: string;
  /** The step: requested → dispatched → received. `state` is what a person reads. */
  status: TransferStatus;
  remarks: string | null;
  lines: TransferLine[];

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
