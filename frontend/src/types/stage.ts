// Mirrors the PAYLOAD.D / PAYLOAD.T data model from ../../../flow-xl-map/NewProcurement.html
// This is a transcription of already-validated content, not a redesign — keep the two in sync.

export type StageKind = "entry" | "decision" | "system" | "gap";

export interface StageField {
  /** Field/column name as it should appear on the form */
  n: string;
  /** Sample value if a real workbook already captures this field today; "" if it's a new field */
  v: string;
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

export interface BranchOutcome {
  id: string;
  label: string;
  note: string;
}

export interface JuteLedgerColumn {
  label: string;
  /** true if this column exists in a real workbook today (renders the same green badge as StageField) */
  real: boolean;
}

export interface JuteLedger {
  id: string;
  title: string;
  columns: JuteLedgerColumn[];
  /** Real rows to seed the table with, keyed by column label — only ledgers with a real workbook have these */
  sampleRows?: Record<string, string>[];
  /** Optional prose note shown above the table, for ledgers whose source text was descriptive rather than a bullet list */
  description?: string;
  /** Present only when a real workbook backs this ledger today */
  file?: string;
  sheet?: string;
  /** Extra findings worth flagging (data-quality issues, overloaded columns, etc.) */
  flag?: string;
}
