/**
 * Jute ledger rows <-> the wire shape.
 *
 * The frontend renders `row[column.label]`, with labels taken verbatim from the client's
 * workbooks — misspellings included ("Diffrence in Bag at Receiving"). Those labels are the API
 * contract; LEDGER_COLUMN_MAP (generated from juteBags.ts) is what maps them onto real columns, so
 * the schema never has to carry a typo and the UI never has to stop showing one.
 */
import { LEDGER_COLUMN_MAP } from "@anagroci/contract/generated/stageFieldMap";
import type { LedgerRow } from "@anagroci/contract/types/receipt";
import { prisma } from "../db.js";
import { warehouseBalanceRows } from "../domain/juteBalance.js";

const DELEGATE: Record<string, string> = {
  "warehouse-stock": "juteWarehouseMovement",
  "supplier-movement": "juteSupplierMovement",
  "factory-production-tracking": "juteProductionMovement",
  "warehouse-to-warehouse-movement": "juteWarehouseTransferReceipt",
};

/** Columns the server owns. A client cannot set these; they are computed or assigned on write. */
const SERVER_OWNED: Record<string, string[]> = {
  "warehouse-stock": ["S N", "Balance"],
  "warehouse-to-warehouse-movement": ["SN"],
};

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

/** Columns whose value may live in a *Raw twin because the source cell wasn't a real date. */
const RAW_FALLBACK: Record<string, string> = { movementDate: "rawDate", receivedDate: "rawDate" };

function toLedgerRow(ledgerId: string, row: Record<string, unknown>): LedgerRow {
  const spec = LEDGER_COLUMN_MAP[ledgerId];
  const out: LedgerRow = {};
  for (const c of spec.columns) {
    let v = fmt(row[c.col]);
    // 11 of ledger 1's dates are hand-typed strings ('13-01-2026'), so they were imported into
    // rawDate rather than coerced into a timestamp. Show that original text verbatim — dropping
    // back to blank would hide real data that we deliberately chose not to reinterpret.
    if (v === "" && RAW_FALLBACK[c.col]) v = fmt(row[RAW_FALLBACK[c.col]]);
    out[c.label] = v;
  }
  return out;
}

export async function listLedgerRows(ledgerId: string): Promise<LedgerRow[]> {
  const spec = LEDGER_COLUMN_MAP[ledgerId];
  if (!spec) throw new Error(`Unknown ledger "${ledgerId}"`);

  if (ledgerId === "warehouse-stock") {
    // Serve the computed running balance, not any stored one. `reportedBalance` (the workbook's
    // own figure) stays available via /api/data-quality, where a divergence is a finding.
    const rows = await warehouseBalanceRows();
    return rows.map((r) => {
      const wire = toLedgerRow(ledgerId, r as unknown as Record<string, unknown>);
      wire["Balance"] = fmt((r as any).computed_balance);
      return wire;
    });
  }

  const model = (prisma as any)[DELEGATE[ledgerId]];
  const orderBy = ledgerId === "warehouse-to-warehouse-movement" ? { sn: "asc" } : { createdAt: "asc" };
  const rows = await model.findMany({ orderBy });
  return rows.map((r: Record<string, unknown>) => toLedgerRow(ledgerId, r));
}

const INT_COLS = new Set([
  "bagsIssued", "bagsReceived", "reportedBalance", "goodBagsAvailable", "completelyDamaged",
  "damagedRepairable", "bagsIssuedToSupplier", "returnedViaDeliveries", "pendingWithSupplier",
  "damaged", "reusable", "issuedToProduction", "goodBagsRecovered", "partiallyDamaged",
  "returnedToWarehouse", "closingBalance", "bagsDispatched", "damagedBags", "newBagsUsed",
  "recondition", "reportedDifference",
]);

function toInt(v: string): number | null {
  const s = (v ?? "").trim();
  if (s === "") return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Append a row. The serial number and running balance are assigned server-side — the frontend
 * computed both client-side, which races whenever two people add a row at once.
 */
export async function addLedgerRow(ledgerId: string, row: LedgerRow): Promise<LedgerRow> {
  const spec = LEDGER_COLUMN_MAP[ledgerId];
  if (!spec) throw new Error(`Unknown ledger "${ledgerId}"`);
  const owned = new Set(SERVER_OWNED[ledgerId] ?? []);

  const data: Record<string, unknown> = {};
  for (const c of spec.columns) {
    if (owned.has(c.label)) continue;
    if (!(c.label in row)) continue;
    const raw = row[c.label];
    data[c.col] = INT_COLS.has(c.col) ? toInt(raw) : raw === "" ? null : raw;
  }

  if (ledgerId === "warehouse-stock") {
    const last = await prisma.juteWarehouseMovement.findFirst({ orderBy: { seq: "desc" }, select: { seq: true, sn: true } });
    const seq = (last?.seq ?? 0) + 1;
    data.seq = seq;
    data.sn = (last?.sn ?? 0) + 1;
    data.activitiesType = (row["Activities type"] ?? "").trim();
    data.whLocation = (row["WH location"] ?? "").trim();
    const d = (row["Date"] ?? "").trim();
    const parsed = d ? new Date(d) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) data.movementDate = parsed;
    else if (d) data.rawDate = d;
    delete (data as any).reportedBalance; // the workbook's column; the app never writes it
  }

  if (ledgerId === "warehouse-to-warehouse-movement") {
    const last = await prisma.juteWarehouseTransferReceipt.findFirst({ orderBy: { sn: "desc" }, select: { sn: true } });
    data.sn = (last?.sn ?? 0) + 1;
    data.sourceWarehouse = (row["Transfer -Bouake "] ?? row["WH location"] ?? "BOUAKE").trim();
    const d = (row["Date"] ?? "").trim();
    const parsed = d ? new Date(d) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) data.receivedDate = parsed;
    else if (d) data.rawDate = d;
  }

  const model = (prisma as any)[DELEGATE[ledgerId]];
  const created = await model.create({ data });

  const rows = await listLedgerRows(ledgerId);
  return rows.find((r) => r["S N"] === String(created.sn) || r["SN"] === String(created.sn)) ?? toLedgerRow(ledgerId, created);
}
