export type StageKind = "entry" | "decision" | "system" | "gap";

export interface StageField {
  /** Field/column name as it should appear on the form, and as the key inside ReceiptRecord.stageData. */
  n: string;
  /** Sample value if a real workbook already captures this field today; "" if it's a new field */
  v: string;
  /**
   * Storage column name for this field in its per-stage table.
   *
   * Deliberately declared rather than slugged from `n`. Slugging breaks three ways here:
   * `n-ledger`'s activity-type label slugs to 77 chars (Postgres truncates identifiers at 63
   * bytes, silently); five labels are non-ASCII (é, —, →, è); and one label
   * ("Warehouse type (Village/Regional/Factory)") is reused across n-gate and n-stock, so the
   * dictionary key is the (stageId, n) pair, not `n` alone. Declaring `col` also means a label
   * rename is a UI-only edit with no migration.
   */
  col: string;
}

export interface Stage {
  id: string;
  /** 1-based order within the wizard; decisions/branches share a slot with the step before them */
  num?: number;
  title: string;
  phase: string;
  kind: StageKind;
  /** Present only when a real workbook backs this stage today */
  file?: string;
  sheet?: string;
  note: string;
  fields: StageField[];
}

export interface BranchOutcome { id: string; label: string; note: string }

export interface JuteLedgerColumn {
  label: string;
  /** true if this column exists in a real workbook today */
  real: boolean;
  /** Storage column name in the ledger's table — see StageField.col for why this is declared. */
  col: string;
}

export interface JuteLedger {
  id: string;
  title: string;
  columns: JuteLedgerColumn[];
  sampleRows?: Record<string, string>[];
  description?: string;
  file?: string;
  sheet?: string;
  flag?: string;
}
