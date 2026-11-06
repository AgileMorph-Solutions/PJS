/**
 * Jute ledger rows <-> the wire shape.
 *
 * The frontend renders `row[column.label]`, with labels taken verbatim from the client's
 * workbooks — misspellings included ("Diffrence in Bag at Receiving"). Those labels are the API
 * contract; LEDGER_COLUMN_MAP (generated from juteBags.ts) is what maps them onto real columns, so
 * the schema never has to carry a typo and the UI never has to stop showing one.
 */
import { SUPPLIER_CURRENT_COLUMN, SUPPLIER_PENDING_COLUMN, supplierPendingBalances } from "@anagroci/contract/domain/jute";
import { JUTE_OPENING_ACTIVITY } from "@anagroci/contract/domain/juteOpeningBalance";
import { LEDGER_COLUMN_MAP } from "@anagroci/contract/generated/stageFieldMap";
import type { LedgerRow } from "@anagroci/contract/types/receipt";
import { prisma } from "../db.js";
import { warehouseBalanceRows } from "../domain/juteBalance.js";
import { ValidationError } from "../domain/validation.js";

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

/** Columns whose value may live in a *Raw twin because the source cell wasn't a real date/number —
 * kor/moisture are mixed-type in ledger 4's source (see JuteWarehouseTransferReceipt's own schema
 * comment: 365 floats, 1 comma-decimal string, 1 int), so a blank parsed value can still have real
 * text worth showing rather than an empty cell. */
const RAW_FALLBACK: Record<string, string> = {
  movementDate: "rawDate", receivedDate: "rawDate",
  korReceived: "korReceivedRaw", korDispatched: "korDispatchedRaw",
  moistureReceived: "moistureReceivedRaw", moistureDispatched: "moistureDispatchedRaw",
};

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

/** Every supplier movement with its calculated balance, oldest first. Worked out over all warehouses and only then narrowed
 * by the caller: the bags a supplier holds don't depend on which warehouse is looking. */
async function supplierMovementRows() {
  const rows = await prisma.juteSupplierMovement.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const pending = supplierPendingBalances(rows.map((r) => ({ supplierCode: r.supplierCode, issued: r.bagsIssuedToSupplier, returned: r.returnedViaDeliveries, corrected: r.pendingWithSupplier })));
  // Later rows overwrite earlier ones, leaving each supplier's newest balance.
  const current = new Map(rows.map((r, i) => [r.supplierCode.trim(), pending[i]]));
  return rows.map((r, i) => ({
    id: r.id,
    whLocation: r.whLocation,
    wire: {
      ...toLedgerRow("supplier-movement", r),
      [SUPPLIER_PENDING_COLUMN]: fmt(pending[i]),
      [SUPPLIER_CURRENT_COLUMN]: fmt(current.get(r.supplierCode.trim())),
    },
  }));
}

/** `site` is a resolved list of names (domain/site.ts's resolveSite). Ledger 4 rows span two
 * warehouses (source and destination), so a transfer matches if EITHER side is in scope — it's
 * genuinely relevant to both sections, unlike the single-warehouse ledgers. */
export async function listLedgerRows(ledgerId: string, site?: string[]): Promise<LedgerRow[]> {
  const spec = LEDGER_COLUMN_MAP[ledgerId];
  if (!spec) throw new Error(`Unknown ledger "${ledgerId}"`);

  if (ledgerId === "warehouse-stock") {
    // Serve the computed running balance, not any stored one. `reportedBalance` (the workbook's
    // own figure) stays available via /api/data-quality, where a divergence is a finding.
    const rows = await warehouseBalanceRows(site);
    return rows.map((r) => {
      const wire = toLedgerRow(ledgerId, r as unknown as Record<string, unknown>);
      wire["Balance"] = fmt((r as any).computed_balance);
      return wire;
    });
  }

  if (ledgerId === "supplier-movement") {
    const rows = await supplierMovementRows();
    return rows.filter((r) => !site || (r.whLocation !== null && site.includes(r.whLocation))).map((r) => r.wire);
  }

  const model = (prisma as any)[DELEGATE[ledgerId]];
  const orderBy = ledgerId === "warehouse-to-warehouse-movement" ? { sn: "asc" } : { createdAt: "asc" };
  const rows = await model.findMany({ where: ledgerSiteWhere(ledgerId, site), orderBy });
  return rows.map((r: Record<string, unknown>) => toLedgerRow(ledgerId, r));
}

/** The site filter for a ledger's own table — shared with the table export (services/exports.ts)
 * so "which rows belong to this section" is decided in exactly one place. */
export function ledgerSiteWhere(ledgerId: string, site?: string[]) {
  if (!site) return {};
  return ledgerId === "warehouse-to-warehouse-movement"
    ? { OR: [{ sourceWarehouse: { in: site } }, { destinationWarehouse: { in: site } }] }
    : { whLocation: { in: site } };
}

const INT_COLS = new Set([
  "bagsIssued", "bagsReceived", "reportedBalance", "goodBagsAvailable", "completelyDamaged",
  "damagedRepairable", "bagsIssuedToSupplier", "returnedViaDeliveries", "pendingWithSupplier",
  "damaged", "reusable", "issuedToProduction", "goodBagsRecovered", "partiallyDamaged",
  "returnedToWarehouse", "closingBalance", "bagsDispatched", "damagedBags", "newBagsUsed",
  "recondition", "reportedDifference", "finalBagsAfterRebagging", "reportedDiff", "fullyLoadedTruckWeight",
  "emptyTruckTareWeight", "grossWeightReceived", "netWeightAtArrival", "netWeightDispatched", "weightDifference",
]);
/** The ones that are a difference or a balance, so can really be below zero. */
const SIGNED_COLS = new Set(["reportedDifference", "reportedDiff", "weightDifference", "closingBalance", "pendingWithSupplier"]);
/** Ledger 4's readings with a *Raw twin: a value that isn't a number is kept there as written, as its importer does. */
const DECIMAL_WITH_RAW = ["korReceived", "korDispatched", "moistureReceived", "moistureDispatched"];

/** A whole number from a form, or null for a blank. Anything else is refused: storing it as blank would lose it without a word. */
function toInt(label: string, col: string, v: string): number | null {
  const s = (v ?? "").replace(/\s/g, "");
  if (s === "") return null;
  if (!/^-?\d+$/.test(s)) throw new ValidationError(`"${label}" must be a whole number, not "${v}".`);
  const n = Number(s);
  if (n < 0 && !SIGNED_COLS.has(col)) throw new ValidationError(`"${label}" can't be negative.`);
  if (Math.abs(n) > 2_147_483_647) throw new ValidationError(`"${label}" is too large.`);
  return n;
}

async function assertKnownWarehouse(warehouse: string) {
  if (!(await prisma.warehouse.findUnique({ where: { name: warehouse }, select: { name: true } }))) {
    throw new ValidationError(`Warehouse "${warehouse}" isn't in the warehouse master.`);
  }
}

/**
 * Every one of the 298 real rows moves bags one way, so a line with both is a mistake that leaves the balance looking
 * right. A row with neither is allowed only when it records the good/damaged split instead.
 */
function assertOneDirection(data: Record<string, unknown>) {
  const issued = Number(data.bagsIssued ?? 0);
  const received = Number(data.bagsReceived ?? 0);
  if (issued > 0 && received > 0) throw new ValidationError("Please fill in only one: Bags issued (bags going out) or Bags received (bags coming in). If both happened, save them as two separate entries.");
  const hasSplit = [data.goodBagsAvailable, data.completelyDamaged, data.damagedRepairable].some((v) => v !== null && v !== undefined);
  if (issued === 0 && received === 0 && !hasSplit) throw new ValidationError("Please fill in Bags issued (bags going out) or Bags received (bags coming in).");
}

/** Both are foreign keys, so the database would refuse them anyway; this says which one is wrong, in words. */
async function assertWarehouseStockReferences(warehouse: string, supplierCode: string | null | undefined) {
  if (!warehouse) throw new ValidationError("Choose the warehouse this entry is for.");
  await assertKnownWarehouse(warehouse);
  if (supplierCode && !(await prisma.supplier.findUnique({ where: { code: supplierCode }, select: { code: true } }))) {
    throw new ValidationError(`Supplier code "${supplierCode}" isn't in the Suppliers list.`);
  }
}

/** The next row's place in the warehouse stock ledger, for every writer of it. `seq` is unique, so two writers racing get
 * a refused write, never a shared number. */
export async function nextMovementNumbers(db: Pick<typeof prisma, "juteWarehouseMovement"> = prisma) {
  const last = await db.juteWarehouseMovement.findFirst({ orderBy: { seq: "desc" }, select: { seq: true, sn: true } });
  return { seq: (last?.seq ?? 0) + 1, sn: (last?.sn ?? 0) + 1 };
}

/**
 * Append a row. The serial number and running balance are assigned server-side — the frontend
 * computed both client-side, which races whenever two people add a row at once.
 */
export async function addLedgerRow(ledgerId: string, row: LedgerRow): Promise<LedgerRow> {
  const spec = LEDGER_COLUMN_MAP[ledgerId];
  if (!spec) throw new Error(`Unknown ledger "${ledgerId}"`);
  const owned = new Set(SERVER_OWNED[ledgerId] ?? []);
  // A row typed here would sort last, and the balance before it would no longer start from the opening.
  if (ledgerId === "warehouse-stock" && (row["Activities type"] ?? "").trim().toUpperCase() === JUTE_OPENING_ACTIVITY) {
    throw new ValidationError("Enter the opening stock in the Opening stock field at the top of Warehouse Stock.");
  }

  const data: Record<string, unknown> = {};
  for (const c of spec.columns) {
    if (owned.has(c.label)) continue;
    if (!(c.label in row)) continue;
    const raw = row[c.label];
    data[c.col] = INT_COLS.has(c.col) ? toInt(c.label, c.col, raw) : raw === "" ? null : raw;
  }

  if (ledgerId === "warehouse-stock") {
    Object.assign(data, await nextMovementNumbers());
    data.activitiesType = (row["Activities type"] ?? "").trim();
    data.whLocation = (row["WH location"] ?? "").trim();
    await assertWarehouseStockReferences(data.whLocation as string, data.supplierCode as string | null | undefined);
    assertOneDirection(data);
    const d = (row["Date"] ?? "").trim();
    const parsed = d ? new Date(d) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) data.movementDate = parsed;
    else if (d) data.rawDate = d;
    delete (data as any).reportedBalance; // the workbook's column; the app never writes it
  }

  if (ledgerId === "warehouse-to-warehouse-movement") {
    const last = await prisma.juteWarehouseTransferReceipt.findFirst({ orderBy: { sn: "desc" }, select: { sn: true } });
    data.sn = (last?.sn ?? 0) + 1;
    // No fallback to "BOUAKE": that was only ever correct while every import truly was
    // Bouaké -> Yakro. Now that a second site exists, guessing the source here is exactly the
    // wrong kind of silent default (ground rule §4) — require the caller to say which warehouse.
    const sourceWarehouse = (row["Transfer -Bouake"] ?? "").trim();
    if (!sourceWarehouse) throw new ValidationError("Source warehouse is required for a warehouse-to-warehouse transfer row.");
    await assertKnownWarehouse(sourceWarehouse);
    data.sourceWarehouse = sourceWarehouse;
    for (const col of DECIMAL_WITH_RAW) {
      const raw = data[col];
      if (raw === null || raw === undefined) continue;
      const n = Number(String(raw).trim().replace(",", "."));
      data[col] = Number.isFinite(n) ? n : null;
      if (!Number.isFinite(n)) data[`${col}Raw`] = raw;
    }
    const d = (row["Date"] ?? "").trim();
    const parsed = d ? new Date(d) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) data.receivedDate = parsed;
    else if (d) data.rawDate = d;
  }

  // Ledgers 2 and 3 are manual-entry-only (no import, no historical rows to preserve), so an
  // unparseable date is simply dropped rather than kept in a *Raw twin the way ledgers 1/4 do.
  if (ledgerId === "supplier-movement" || ledgerId === "factory-production-tracking") {
    const d = (row["Date"] ?? "").trim();
    const parsed = d ? new Date(d) : null;
    data.movementDate = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }

  if (ledgerId === "supplier-movement") {
    // supplierCode is NOT NULL on JuteSupplierMovement; the generic loop above would otherwise
    // send `null` for a blank input and fail the write outright.
    data.supplierCode = (row["Supplier code"] ?? "").trim();
    // A row with no supplier has no balance, so the typed figure would be saved and then never shown.
    if (!data.supplierCode && data.pendingWithSupplier != null) {
      throw new ValidationError(`Enter the Supplier code the "${SUPPLIER_PENDING_COLUMN}" figure belongs to.`);
    }
  }

  const model = (prisma as any)[DELEGATE[ledgerId]];
  const created = await model.create({ data });

  if (ledgerId === "supplier-movement") {
    return (await supplierMovementRows()).find((r) => r.id === created.id)!.wire;
  }

  const rows = await listLedgerRows(ledgerId);
  return rows.find((r) => r["S N"] === String(created.sn) || r["SN"] === String(created.sn)) ?? toLedgerRow(ledgerId, created);
}
