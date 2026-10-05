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

export interface Supplier { code: string; name: string }
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

/** Read from the receipt(s) that arrived against a plan, never stored on the plan itself. */
export type DeliveryStatus = "planned" | "overdue" | "arrived";

/** Expected arrivals, recorded before the truck comes — the client's own "Delivery Plan" sheet. */
export interface DeliveryPlan {
  /** DP-<warehouse code>-<expected arrival year>-NNN */
  id: string;
  plannedDeliveryDate: string | null;
  supplierName: string;
  supplierCode: string | null;
  expectedQuantityKg: number | null;
  expectedTruckType: string | null;
  expectedArrivalDate: string;
  destinationWarehouse: string;
  remarks: string | null;
  deliveryStatus: DeliveryStatus;
  actualArrivalDate: string | null;
  truckNo: string | null;
  receiptIds: string[];
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
}

/** A request to move Lots between warehouses. */
export interface TransferRequest {
  /** BKT-<transfer year>-NNN */
  id: string;
  transferDate: string;
  fromWarehouse: string;
  toWarehouse: string;
  status: TransferStatus;
  remarks: string | null;
  lines: TransferLine[];
}
