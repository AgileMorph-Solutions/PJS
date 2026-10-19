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
import { listDeliveryPlans } from "../../services/deliveryPlans.js";
import { listTransfers } from "../../services/transfers.js";
import { PLAN_STATUS_LABELS } from "@anagroci/contract/domain/deliveryPlan";
import { TRANSFER_STATE_LABELS } from "@anagroci/contract/domain/transfers";
import { SHEET_FIELDS, normalizeHeader, type FieldDef } from "./fields.js";
import { supplierNameFields } from "../../services/masters.js";

/**
 * A supplier row from Excel follows the same rules as one typed in the app: the name loses its "RCN" prefix (the
 * original kept), and register details filled in by the client replace any demo "sample" marking.
 */
function supplierRowFromFile(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  if (typeof out.name === "string" && out.name.trim()) Object.assign(out, supplierNameFields(out.name, { lenient: true }));
  if (Object.keys(out).some((k) => !["code", "name", "formerName", "source"].includes(k))) out.detailsSource = null;
  return out;
}

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
  /** Last word on a row before it is written: rules that belong to this table whatever writes it. */
  prepare?: (data: Record<string, unknown>) => Record<string, unknown>;
  /**
   * The sheet is for READING: everything on it is worked out from other records (a plan's progress, a BKT's
   * variance), and those records are changed in the app, where the rules live — an ID is issued, a store is
   * checked, a truck is held to one voyage. An upload that carries it back is compared with what the app
   * holds and any difference is reported, never written.
   */
  exportOnly?: boolean;
  rows(site?: string[]): Promise<Row[]>;
}

/** Provenance / derived columns, wherever a table has them. */
const SERVER_OWNED = ["createdAt", "updatedAt", "source", "sheetRow", "activityCategory", "destinationProvenance"];

function tableSheet(
  model: string,
  opts: Pick<SheetSpec, "sections"> & Partial<Pick<SheetSpec, "key" | "master" | "siteColumns" | "assignsSeq" | "dateField" | "prepare">> & { extraReadOnly?: string[] }
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
    readOnly: ["Receipt.source", "status (derived)", "plan.deliveryPlanId", "plan.receptionType", "plan.flags", "plan.linkStatus", "plan.approval"],
    dateField: { column: "Receipt.arrivalDate", label: "Arrival date" },
    siteColumns: ["Receipt.warehouse"],
    rows: receiptRows,
  },
  // Planned before the truck comes. Planning is done in the app, so the sheet is for reading (see exportOnly).
  {
    name: "DeliveryPlan",
    title: SHEET_FIELDS.DeliveryPlan.title,
    idLabel: SHEET_FIELDS.DeliveryPlan.idLabel,
    fields: SHEET_FIELDS.DeliveryPlan.fields,
    defaultToSection: () => [],
    kind: "table",
    key: "id",
    sections: BOTH,
    readOnly: [],
    exportOnly: true,
    dateField: { column: "expectedStart", label: "Expected delivery start" },
    siteColumns: ["destinationWarehouse"],
    rows: async (site) =>
      (await listDeliveryPlans(site)).map((p) => ({
        id: p.id, planningDate: p.plannedDeliveryDate, supplierCode: p.supplierCode, supplierName: p.supplierName, expectedOrigin: p.expectedOrigin,
        destinationStore: p.destinationStore, expectedStart: p.expectedArrivalDate, expectedEnd: p.expectedDeliveryEnd,
        expectedQuantityKg: p.expectedQuantityKg, expectedTrucks: p.expectedTrucks, fundingReference: p.fundingReference,
        status: PLAN_STATUS_LABELS[p.status], actualKg: p.progress.actualKg, arrivals: p.progress.arrivals, acceptedTrucks: p.progress.acceptedTrucks,
        remainingKg: p.progress.remainingKg, varianceKg: p.progress.varianceKg, overdue: p.overdue ? "Yes" : "", remarks: p.remarks,
        cancelReason: p.cancelReason, planningBasis: p.planningBasis,
      })),
  },
  // One row per BKT — one truck, one voyage — with what left, what arrived and the difference.
  {
    name: "TransferRequest",
    title: SHEET_FIELDS.TransferRequest.title,
    idLabel: SHEET_FIELDS.TransferRequest.idLabel,
    fields: SHEET_FIELDS.TransferRequest.fields,
    defaultToSection: () => [],
    kind: "table",
    key: "id",
    sections: BOTH,
    readOnly: [],
    exportOnly: true,
    dateField: { column: "transferDate", label: "Transfer date" },
    siteColumns: ["fromWarehouse", "toWarehouse"],
    rows: async (site) =>
      (await listTransfers(site)).map((t) => ({
        id: t.id, transferDate: t.transferDate, fromWarehouse: t.fromWarehouse, toWarehouse: t.toWarehouse, state: TRANSFER_STATE_LABELS[t.state],
        truckNo: t.truckNo, transporter: t.transporter, driver: t.driver, driverPhone: t.driverPhone,
        lots: t.lines.map((l) => l.lotNumber ?? l.receiptId).join(" / "), bins: [...new Set(t.lines.map((l) => l.binCode).filter(Boolean))].join(" / "),
        bagsDispatched: t.variance.bagsDispatched, dispatchedGrossKg: t.dispatchedGrossKg, netDispatchedKg: t.variance.netDispatchedKg,
        dispatchedAt: t.dispatchedAt, dispatchWhReceiptNo: t.dispatchWhReceiptNo, receiveWhReceiptNo: t.receiveWhReceiptNo,
        moistureDispatched: perLot(t.lines.map((l) => l.moisture)), korDispatched: perLot(t.lines.map((l) => l.kor)), nutCountDispatched: perLot(t.lines.map((l) => l.nutCount)),
        bagsReceived: t.variance.bagsReceived, damagedBags: t.damagedBags, receivedGrossKg: t.receivedGrossKg,
        netAtArrivalKg: t.variance.netAtArrivalKg, korReceived: t.korReceived, moistureReceived: t.moistureReceived, nutCountReceived: t.nutCountReceived,
        receivedLotNoRaw: t.receivedLotNoRaw, receivedAt: t.receivedAt, bagVariance: t.variance.bagVariance, weightVarianceKg: t.variance.weightVarianceKg,
        receivedComment: t.receivedComment, remarks: t.remarks,
      })),
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
  tableSheet("Supplier", {
    sections: BOTH, key: "code", master: true,
    // The system issues these; the file shows them but never sets them.
    extraReadOnly: ["supplierNo", "status", "statusReason", "createdById", "updatedById", "detailsSource"],
    prepare: supplierRowFromFile,
  }),
];

/** One value per Lot joined like the Lot No column, or nothing when none was recorded (transfers made before quality was required). */
const perLot = (xs: (number | null)[]) => (xs.every((x) => x === null) ? null : xs.map((x) => x ?? "-").join(" / "));

export const sheetsFor = (type: WarehouseType): SheetSpec[] => SHEETS.filter((s) => s.sections.includes(type));
/** Finds a sheet by the title on its tab, ignoring case and spacing ("truck  reception" works). */
export const sheetByTitle = (title: string): SheetSpec | undefined => SHEETS.find((s) => normalizeHeader(s.title) === normalizeHeader(title));
