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
export interface WarehouseMaster { name: string; kind: string | null; type?: string | null; site: string | null }
export interface WarehouseAliasMaster { alias: string; warehouseName: string }
export interface Masters { suppliers: Supplier[]; warehouses: WarehouseMaster[]; aliases?: WarehouseAliasMaster[]; bins: string[]; origins: string[] }

export interface DryingJob {
  id: string; date: string; warehouse: string; bin: string;
  lotNo: string; ficheNo: string; status: string; dryType: string; destination: string;
}
