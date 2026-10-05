/**
 * One-off move of existing records onto the system IDs (Oct 2026): receipts REC-2026-0001 →
 * REC-BKE01-2026-001, lots 17 → LOT-BKE01-2026-017, voyages BKT001 / BKT-414 → BKT-2026-001 /
 * BKT-2026-414. The user asked for existing data to be updated, not just new records.
 *
 * Plan first, apply second: planRenumber() writes nothing and returns every old → new value (the
 * CLI writes it to a CSV for review); applyRenumber() writes exactly that plan in one transaction.
 *
 * What is never lost:
 *   - the old receipt id goes into Receipt.legacyId (old links resolve; every child row follows the
 *     id through ON UPDATE CASCADE — all 21 foreign keys into Receipt are declared that way);
 *   - the lot/voyage number stays the same number, and imported rows keep the workbook's own text
 *     in their *Raw twin.
 * What is skipped, and reported rather than guessed: anything at a warehouse with no code yet (the
 * admin sets it in Masters › Warehouses, then this runs again), rows with no readable date, values
 * that aren't one lot ("12,5"), and the activity ledger, whose sheet names no warehouse at all.
 *
 * Re-running is a no-op: values already in the system format are left alone. Lots are formatted
 * with the same rule the importers use (services/ids.ts lotNormalizer + imports.ts
 * dischargeLotDate), so re-uploading a 2026 workbook afterwards reproduces these exact values.
 */
import { Prisma } from "@prisma/client";
import { formatReceiptId, legacyLotSeq, parseSiteId, siteIdPrefix, yearOf } from "@anagroci/contract/domain/ids";
import { prisma } from "../db.js";
import { lotNormalizer, normalizeVoyage, siteOf } from "./ids.js";
import { dischargeLotDate } from "./imports.js";

type Tx = Prisma.TransactionClient;

export interface RenumberChange {
  table: string;
  /** The row's primary key, as stored BEFORE the renumber. */
  key: string;
  column: string;
  from: string | null;
  to: string;
  /** Also set when the row has an empty *Raw twin to carry the original text. */
  rawColumn?: string;
}

export interface RenumberSkip {
  table: string;
  reason: string;
  count: number;
  sample: string[];
}

export interface RenumberPlan {
  changes: RenumberChange[];
  skipped: RenumberSkip[];
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

class SkipLog {
  private by = new Map<string, RenumberSkip>();
  add(table: string, reason: string, key: string) {
    const k = `${table}\u0000${reason}`;
    const s = this.by.get(k) ?? { table, reason, count: 0, sample: [] };
    s.count += 1;
    if (s.sample.length < 5) s.sample.push(key);
    this.by.set(k, s);
  }
  list() {
    return [...this.by.values()];
  }
}

/** "REC-2026-0042" → 42, so receipts are renumbered in the order they were originally numbered. */
function legacyOrder(id: string): number {
  const m = /-(\d+)$/.exec(id);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

async function planReceipts(tx: Tx, skips: SkipLog): Promise<RenumberChange[]> {
  const receipts = await tx.receipt.findMany({ select: { id: true, warehouse: true, arrivalDate: true } });
  const pending = receipts.filter((r) => parseSiteId(r.id)?.kind !== "REC");
  pending.sort((a, b) => legacyOrder(a.id) - legacyOrder(b.id) || a.id.localeCompare(b.id));

  const codeOf = new Map<string, string | null>();
  const nextSeq = new Map<string, number>();
  const out: RenumberChange[] = [];
  for (const r of pending) {
    const site = (await siteOf(tx, r.warehouse)) ?? r.warehouse;
    if (!codeOf.has(site)) codeOf.set(site, (await tx.warehouse.findUnique({ where: { name: site }, select: { code: true } }))?.code ?? null);
    const code = codeOf.get(site);
    const year = yearOf(r.arrivalDate);
    if (!code) { skips.add("Receipt", `warehouse ${site} has no code yet`, r.id); continue; }
    if (year === undefined) { skips.add("Receipt", "arrival date isn't a YYYY-MM-DD date", r.id); continue; }

    const prefix = siteIdPrefix("REC", code, year);
    if (!nextSeq.has(prefix)) {
      // Continue after any receipt already issued in the new format for this warehouse and year.
      const issued = receipts.map((x) => (x.id.startsWith(prefix) ? parseSiteId(x.id)?.seq ?? 0 : 0));
      nextSeq.set(prefix, Math.max(0, ...issued));
    }
    const seq = nextSeq.get(prefix)! + 1;
    nextSeq.set(prefix, seq);
    out.push({ table: "Receipt", key: r.id, column: "id", from: r.id, to: formatReceiptId(code, year, seq) });
  }
  return out;
}

type LotRow = { key: string; lot: string | null; raw?: string | null; site: string | null | undefined; date: string | null | undefined };

/** One table's lots through the importers' own normalizer. */
async function planLots(
  normalize: Awaited<ReturnType<typeof lotNormalizer>>,
  skips: SkipLog,
  table: string,
  column: string,
  rows: LotRow[],
  rawColumn?: string
): Promise<RenumberChange[]> {
  const out: RenumberChange[] = [];
  for (const r of rows) {
    if (r.lot === null || !r.lot.trim() || parseSiteId(r.lot)?.kind === "LOT") continue;
    const n = await normalize(r.lot, r.site, r.date);
    if (n.normalized && n.value) {
      out.push({ table, key: r.key, column, from: r.lot, to: n.value, rawColumn: rawColumn && !r.raw ? rawColumn : undefined });
    } else {
      const reason = legacyLotSeq(r.lot) === undefined ? "not a single lot number" : !r.site ? "row names no warehouse" : !yearOf(r.date) ? "row has no readable date" : "its warehouse has no code yet";
      skips.add(table, reason, r.key);
    }
  }
  return out;
}

/**
 * Two rows that would end up with the same value under a unique key are both left alone and
 * reported — a renumber must never be the thing that breaks a constraint mid-transaction.
 */
function dropCollisions(
  changes: RenumberChange[],
  current: Map<string, string>,
  keyOf: (c: RenumberChange) => string,
  skips: SkipLog
) {
  const changing = new Set(changes.map((c) => c.key));
  // Unique-key values held by rows this plan leaves untouched.
  const kept = new Set([...current].filter(([rowKey]) => !changing.has(rowKey)).map(([, k]) => k));
  const count = new Map<string, number>();
  for (const c of changes) count.set(keyOf(c), (count.get(keyOf(c)) ?? 0) + 1);
  return changes.filter((c) => {
    const k = keyOf(c);
    if (count.get(k)! > 1 || kept.has(k)) { skips.add(c.table, `would duplicate ${c.to}`, c.key); return false; }
    return true;
  });
}

export async function planRenumber(db: Tx = prisma): Promise<RenumberPlan> {
  const skips = new SkipLog();
  const normalize = await lotNormalizer(db);
  const changes: RenumberChange[] = [];

  changes.push(...(await planReceipts(db, skips)));

  // ── Lots the system holds (one per receipt) ──
  const assigned = await db.stageLotAssignment.findMany({
    where: { lotNumber: { not: null } },
    select: { receiptId: true, lotNumber: true, warehouseName: true, receipt: { select: { warehouse: true, arrivalDate: true } } },
  });
  const sla = await planLots(normalize, skips, "StageLotAssignment", "lotNumber", assigned.map((a) => ({
    key: a.receiptId, lot: a.lotNumber, site: a.warehouseName ?? a.receipt.warehouse, date: a.receipt.arrivalDate,
  })));
  const slaSite = new Map(assigned.map((a) => [a.receiptId, a.warehouseName ?? a.receipt.warehouse]));
  changes.push(...dropCollisions(
    sla,
    new Map(assigned.filter((a) => a.lotNumber?.trim()).map((a) => [a.receiptId, `${slaSite.get(a.receiptId)}\u0000${a.lotNumber}`])),
    (c) => `${slaSite.get(c.key)}\u0000${c.to}`,
    skips
  ));

  // ── Lots the imported workbooks hold ──
  const discharges = await db.warehouseDischarge.findMany({
    select: { id: true, lotNo: true, lotNoRaw: true, warehouseSite: true, arrivalDate: true, dischargeDate: true },
  });
  const wd = await planLots(normalize, skips, "WarehouseDischarge", "lotNo", discharges.map((d) => ({
    key: d.id, lot: d.lotNo, raw: d.lotNoRaw, site: d.warehouseSite, date: dischargeLotDate(iso(d.arrivalDate), iso(d.dischargeDate)),
  })), "lotNoRaw");
  const wdSite = new Map(discharges.map((d) => [d.id, d.warehouseSite]));
  changes.push(...dropCollisions(
    wd,
    new Map(discharges.map((d) => [d.id, `${d.warehouseSite}\u0000${d.lotNo}`])),
    (c) => `${wdSite.get(c.key)}\u0000${c.to}`,
    skips
  ));

  const batches = await db.dryingBatch.findMany({ select: { id: true, lotNo: true, lotNoRaw: true, warehouseSite: true, warehouse: true, dryingDate: true } });
  changes.push(...(await planLots(normalize, skips, "DryingBatch", "lotNo", batches.map((b) => ({
    key: b.id, lot: b.lotNo, raw: b.lotNoRaw, site: b.warehouseSite ?? b.warehouse, date: iso(b.dryingDate),
  })))));

  const sorting = await db.dryingSortingReport.findMany({ select: { id: true, lotNo: true, lotNoRaw: true, warehouseSite: true, warehouse: true, dryingDate: true } });
  changes.push(...(await planLots(normalize, skips, "DryingSortingReport", "lotNo", sorting.map((s) => ({
    key: s.id, lot: s.lotNo, raw: s.lotNoRaw, site: s.warehouseSite ?? s.warehouse, date: iso(s.dryingDate),
  })))));

  // The receiving warehouse's own lot number — see commitJuteWarehouseTransfer.
  const transfers = await db.juteWarehouseTransferReceipt.findMany({ select: { id: true, lotNo: true, lotNoRaw: true, destinationWarehouse: true, receivedDate: true } });
  changes.push(...(await planLots(normalize, skips, "JuteWarehouseTransferReceipt", "lotNo", transfers.map((t) => ({
    key: t.id, lot: t.lotNo, raw: t.lotNoRaw, site: t.destinationWarehouse, date: iso(t.receivedDate),
  })), "lotNoRaw")));

  const dryingJobs = await db.dryingJob.findMany({ select: { id: true, lotNo: true, lotNoRaw: true, originLotNo: true, warehouse: true, date: true } });
  changes.push(...(await planLots(normalize, skips, "DryingJob", "lotNo", dryingJobs.map((j) => ({
    key: j.id, lot: j.lotNo, raw: j.lotNoRaw, site: j.warehouse, date: j.date,
  })), "lotNoRaw")));
  changes.push(...(await planLots(normalize, skips, "DryingJob", "originLotNo", dryingJobs.map((j) => ({
    key: j.id, lot: j.originLotNo, site: j.warehouse, date: j.date,
  })))));

  const supplierMoves = await db.juteSupplierMovement.findMany({ select: { id: true, lotNo: true, lotNoRaw: true, whLocation: true, movementDate: true } });
  changes.push(...(await planLots(normalize, skips, "JuteSupplierMovement", "lotNo", supplierMoves.map((m) => ({
    key: m.id, lot: m.lotNo, raw: m.lotNoRaw, site: m.whLocation, date: iso(m.movementDate),
  })), "lotNoRaw")));

  // The activity ledger sheet has no warehouse column; its lots can't be given a code without
  // guessing whose they are. Reported once per row, left exactly as written.
  const ledger = await db.warehouseActivityLedgerEntry.findMany({ where: { lotNo: { not: null } }, select: { id: true, lotNo: true } });
  for (const l of ledger) {
    if (legacyLotSeq(l.lotNo) !== undefined) skips.add("WarehouseActivityLedgerEntry", "sheet names no warehouse — re-upload it choosing the warehouse", String(l.id));
  }

  // ── Voyages (BKT) on dispatch lines ──
  const lines = await db.warehouseDispatchLine.findMany({
    where: { vyogeNumber: { not: null } },
    select: { id: true, vyogeNumber: true, vyogeNumberRaw: true, chargeDate: true },
  });
  for (const l of lines) {
    if (/^BKT-\d{4}-\d+$/.test(l.vyogeNumber!.trim())) continue;
    const v = normalizeVoyage(l.vyogeNumber, iso(l.chargeDate));
    if (v.normalized && v.value) {
      changes.push({ table: "WarehouseDispatchLine", key: l.id, column: "vyogeNumber", from: l.vyogeNumber, to: v.value, rawColumn: l.vyogeNumberRaw ? undefined : "vyogeNumberRaw" });
    } else {
      skips.add("WarehouseDispatchLine", iso(l.chargeDate) ? "not a BKT number" : "line has no charge date", l.id);
    }
  }

  return { changes, skipped: skips.list() };
}

const DELEGATE: Record<string, { model: string; pk: string }> = {
  StageLotAssignment: { model: "stageLotAssignment", pk: "receiptId" },
  WarehouseDischarge: { model: "warehouseDischarge", pk: "id" },
  DryingBatch: { model: "dryingBatch", pk: "id" },
  DryingSortingReport: { model: "dryingSortingReport", pk: "id" },
  JuteWarehouseTransferReceipt: { model: "juteWarehouseTransferReceipt", pk: "id" },
  DryingJob: { model: "dryingJob", pk: "id" },
  JuteSupplierMovement: { model: "juteSupplierMovement", pk: "id" },
  WarehouseDispatchLine: { model: "warehouseDispatchLine", pk: "id" },
};

export interface RenumberResult {
  receipts: number;
  values: number;
  byTable: Record<string, number>;
}

/**
 * Writes a plan in one transaction. Lots and voyages first — their rows are keyed by the receipt id
 * as it was when the plan was made — then the receipts themselves.
 */
export async function applyRenumber(plan: RenumberPlan): Promise<RenumberResult> {
  return prisma.$transaction((tx) => writeRenumber(tx, plan), { timeout: 10 * 60 * 1000, maxWait: 30_000 });
}

/** The writes themselves, inside the caller's transaction — so a test can apply and roll back. */
export async function writeRenumber(tx: Tx, plan: RenumberPlan): Promise<RenumberResult> {
  const byTable: Record<string, number> = {};
  for (const c of plan.changes) {
    if (c.table === "Receipt") continue;
    const d = DELEGATE[c.table]!;
    const data: Record<string, unknown> = { [c.column]: c.to };
    if (c.rawColumn) data[c.rawColumn] = c.from;
    await (tx as any)[d.model].update({ where: { [d.pk]: c.key }, data });
    byTable[c.table] = (byTable[c.table] ?? 0) + 1;
  }
  for (const c of plan.changes) {
    if (c.table !== "Receipt") continue;
    await tx.receipt.update({ where: { id: c.from! }, data: { id: c.to, legacyId: c.from } });
    // The two soft (non-FK) receipt references follow by hand; every hard FK cascades.
    await tx.juteWarehouseMovement.updateMany({ where: { receiptId: c.from }, data: { receiptId: c.to } });
    await tx.juteSupplierMovement.updateMany({ where: { receiptId: c.from }, data: { receiptId: c.to } });
    byTable.Receipt = (byTable.Receipt ?? 0) + 1;
  }
  return { receipts: byTable.Receipt ?? 0, values: plan.changes.length - (byTable.Receipt ?? 0), byTable };
}

const csvCell = (v: string | null | undefined) => {
  const s = v ?? "";
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function renumberCsv(plan: RenumberPlan): string {
  const rows = [["table", "key", "column", "from", "to"].join(",")];
  for (const c of plan.changes) rows.push([c.table, c.key, c.column, c.from, c.to].map(csvCell).join(","));
  return rows.join("\n") + "\n";
}
