/**
 * One saved change to a record outside a truck's steps (transfers, delivery plans, masters, production…), as the Logs page
 * reads it. A truck's own steps keep their own record (FieldChangeRecord), named by their workbook labels.
 */
export interface ChangeLogRecord {
  id: number;
  at: string;
  /** Who saved it. Only a signed-in person's changes are logged; their name as saved on the row if the account is
   * gone, "Unknown" on older rows that never recorded it. */
  by: string;
  via: "direct" | "approval" | "import" | "system";
  action: "create" | "update" | "delete";
  /** The table, and a person's word for it ("Lot on a transfer"). */
  entity: string;
  entityLabel: string;
  /** The part of the app it belongs to, for the page's filter. */
  area: string;
  /** How a person finds the record: BKT-2026-017, or for a line, the records it belongs to. */
  recordId: string | null;
  /** Null on a whole-record row: an upload's create, a delete, a bulk write's summary. */
  field: string | null;
  fieldLabel: string | null;
  oldValue: string | null;
  newValue: string | null;
}
