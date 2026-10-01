/**
 * The ANAGROCI workbook: one sheet per database table, named after the table, header = the table's
 * own column names in schema order. The same file is what Export downloads and Upload takes back.
 * It differs by section only in WHICH sheets it carries (Unit vs Central warehouse) and which rows
 * they hold (that warehouse's).
 *
 * This registry is the single place a sheet is declared: its key, the section(s) it belongs to, its
 * date column, which columns the server owns, and how its rows are scoped to a warehouse.
 */
import type { WarehouseType } from "@anagroci/contract/data/warehouseTypes";
import { prisma } from "../../db.js";
import { warehouseBalanceRows } from "../juteBalance.js";
import { columnInfo, delegateOf, tableColumns } from "./schemaInfo.js";
import { RECEIPT_KEY, receiptRows } from "./receiptSheet.js";
import { SHEET_FIELDS, normalizeHeader, type FieldDef } from "./fields.js";

export type Row = Record<string, unknown>;

export interface SheetSpec {
  /** Internal id: the table's name (or "Receipt"). What the person sees is `title`. */
  name: string;
  /** The Excel sheet name, in plain words. */
  title: string;
  /** Label of the first column. */
  idLabel: string;
  /** The columns this section's workbook shows, key first (see fields.ts). */
  fields(type: WarehouseType): FieldDef[];
  /** Columns filled with the section's warehouse on a new row when left blank. */
  defaultToSection(type: WarehouseType): string[];
  /** "receipt" is the one multi-table sheet (Receipt + its stage tables); the rest are one table. */
  kind: "receipt" | "table";
  /** Prisma model for a table sheet. */
  model?: string;
  /** The column that identifies a row. */
  key: string;
  /** Master data: written first, never date-filtered, key is a natural key (code / name). */
  master?: boolean;
  sections: WarehouseType[];
  /** Columns the server owns: never read from an upload, even if one is present. */
  readOnly: string[];
  /** The date the export's from/to filter applies to. Omitted = not date-filterable. */
  dateField?: { column: string; label: string };
  /** Columns that say which warehouse a row belongs to; in scope when ANY holds a name in the
   * caller's site. Empty = the table has no warehouse dimension. */
  siteColumns: string[];
  /** `seq` on this table is assigned by the server on create (max + 1). */
  assignsSeq?: boolean;
  rows(site?: string[]): Promise<Row[]>;
}

/** Provenance / derived columns, wherever a table has them. */
const SERVER_OWNED = ["createdAt", "updatedAt", "source", "sheetRow", "activityCategory", "destinationProvenance"];

function tableSheet(
  model: string,
  opts: Pick<SheetSpec, "sections"> & Partial<Pick<SheetSpec, "key" | "master" | "siteColumns" | "assignsSeq" | "dateField">> & { extraReadOnly?: string[] }
): SheetSpec {
  const key = opts.key ?? "id";
  const info = columnInfo(model);
  const own = tableColumns(model);
  const siteColumns = opts.siteColumns ?? [];
  const orderCol = ["sn", "createdAt"].find((c) => info.has(c));
  const shown = SHEET_FIELDS[model];

  const where = (site?: string[]) =>
    !site ? {} : siteColumns.length ? { OR: siteColumns.map((c) => ({ [c]: { in: site } })) } : {};

  return {
    ...opts,
    name: model,
    title: shown.title,
    idLabel: shown.idLabel,
    fields: shown.fields,
    defaultToSection: shown.defaultToSection ?? (() => siteColumns.slice(0, 1)),
    kind: "table",
    model,
    key,
    siteColumns,
    readOnly: [...own.filter((c) => SERVER_OWNED.includes(c)), ...(opts.assignsSeq ? ["seq"] : []), ...(opts.extraReadOnly ?? [])],
    rows: (site) =>
      (prisma as any)[delegateOf(model)].findMany({
        where: where(site),
        orderBy: [...(orderCol && !opts.master ? [{ [orderCol]: "asc" }] : []), { [key]: "asc" }],
      }),
  };
}

const BOTH: WarehouseType[] = ["UNIT", "CENTRAL"];

export const SHEETS: SheetSpec[] = [
  {
    name: "Receipt",
    title: SHEET_FIELDS.Receipt.title,
    idLabel: SHEET_FIELDS.Receipt.idLabel,
    fields: SHEET_FIELDS.Receipt.fields,
    defaultToSection: () => [],
    kind: "receipt",
    key: RECEIPT_KEY,
    sections: BOTH,
    readOnly: ["Receipt.source", "status (derived)"],
    dateField: { column: "Receipt.arrivalDate", label: "Arrival date" },
    siteColumns: ["Receipt.warehouse"],
    rows: receiptRows,
  },
  tableSheet("WarehouseDischarge", { sections: BOTH, siteColumns: ["warehouseSite"], dateField: { column: "arrivalDate", label: "Arrival date" } }),
  tableSheet("DryingBatch", { sections: BOTH, siteColumns: ["warehouseSite"], dateField: { column: "dryingDate", label: "Drying date" } }),
  tableSheet("DryingSortingReport", { sections: ["UNIT"], siteColumns: ["warehouseSite"], dateField: { column: "dryingDate", label: "Drying date" } }),
  tableSheet("WarehouseDispatchLine", { sections: ["UNIT"], siteColumns: ["warehouseSite"], dateField: { column: "chargeDate", label: "Loading date" } }),
  tableSheet("JuteWarehouseTransferReceipt", {
    sections: BOTH,
    siteColumns: ["sourceWarehouse", "destinationWarehouse"],
    dateField: { column: "receivedDate", label: "Date" },
  }),
  {
    ...tableSheet("JuteWarehouseMovement", {
      sections: ["UNIT"],
      siteColumns: ["whLocation"],
      assignsSeq: true,
      // A few rows carry only hand-typed text in rawDate (kept verbatim, not reinterpreted); a date
      // filter can't place those, so it reports them instead of dropping them silently.
      dateField: { column: "movementDate", label: "Date" },
      // The running balance is worked out, not provided.
      extraReadOnly: ["computed_balance", "balance_delta"],
    }),
    // The balance view, not the bare table: it is the same rows, and the file simply doesn't show the balance.
    rows: async (site) => (await warehouseBalanceRows(site)) as unknown as Row[],
  },
  // No warehouse column on these two, so they aren't narrowed to a warehouse.
  tableSheet("WarehouseActivityLedgerEntry", { sections: BOTH, dateField: { column: "activityDate", label: "Date" } }),
  tableSheet("IssuedToProduction", { sections: ["CENTRAL"], dateField: { column: "date", label: "Date" } }),
  tableSheet("Supplier", { sections: BOTH, key: "code", master: true }),
];

export const sheetsFor = (type: WarehouseType): SheetSpec[] => SHEETS.filter((s) => s.sections.includes(type));
/** Finds a sheet by the title on its tab, ignoring case and spacing ("truck  reception" works). */
export const sheetByTitle = (title: string): SheetSpec | undefined => SHEETS.find((s) => normalizeHeader(s.title) === normalizeHeader(title));
