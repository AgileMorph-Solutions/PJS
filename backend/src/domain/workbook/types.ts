import type { Prisma } from "@prisma/client";
import type { WarehouseType } from "@anagroci/contract/data/warehouseTypes";

/** Either the client or a transaction: a preview plans against the client, a commit re-plans and
 * applies inside one transaction. */
export type Db = Prisma.TransactionClient;

/** Who is uploading, and which section the workbook is for. */
export interface Ctx {
  db: Db;
  userId: string;
  isAdmin: boolean;
  /** The uploader's role: columns hidden from it (price and amount for the Warehouse Incharge) are ignored. */
  role?: import("@anagroci/contract/data/roles").Role;
  /** The section's warehouse (a site name) and its Unit/Central type. */
  warehouse: string;
  type: WarehouseType;
  /** Every name a row of that warehouse may carry (the site, its stores, its aliases). */
  site: string[];
  filename: string;
  today: string;
}

export interface RowError { row: number; column?: string; message: string }
/** A row-level problem that did not stop the upload (contract domain/uploadChecks.ts). */
export interface RowWarning extends RowError { severity: "warning" | "info" }

export interface Change { column: string; from: string; to: string }
export interface Sample { row: number; key: string; changes: Change[] }

/** An uploaded sheet: row 1 is the header, rows are keyed by header. */
export interface ParsedSheet {
  name: string;
  headers: string[];
  rows: { rowNumber: number; cells: Record<string, unknown> }[];
}

export interface ParsedWorkbook {
  sheets: Map<string, ParsedSheet>;
  /** Plain-language things that didn't stop the upload (ignored sheet / column, …). */
  notices: string[];
}

/** One row to write to a plain table. */
export interface TableOp {
  kind: "create" | "update";
  row: number;
  /** Key of the row being updated. */
  key?: string;
  /** Columns to write — only what changed for an update, everything given for a create. */
  data: Record<string, unknown>;
}

/** One receipt to create or change: its own columns, the stage fields per stage, and decisions. */
export interface ReceiptOp {
  kind: "create" | "update";
  row: number;
  id?: string;
  top: Record<string, unknown>;
  stages: Record<string, Record<string, string>>;
  branches: Record<string, string>;
  /** The rejection reason a QFS "fail" decision needs. */
  reason?: string;
  /** Soft problems with this row, saved against the truck once it exists. */
  warnings?: RowWarning[];
}

export interface SheetResult {
  name: string;
  rows: number;
  created: number;
  changed: number;
  unchanged: number;
  errors: RowError[];
  /** Soft problems that did not block the upload; only receipt sheets produce them. */
  warnings?: RowWarning[];
  /** A handful of changed rows, for the preview. */
  samples: Sample[];
  ops: TableOp[] | ReceiptOp[];
}

export interface WorkbookPlan {
  sheets: SheetResult[];
  notices: string[];
}

export const SAMPLE_LIMIT = 5;
