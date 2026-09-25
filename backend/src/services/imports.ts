/**
 * The excel-upload import service: preview (parse + detect + dedup-check, cached) and commit
 * (the actual bulk write). See docs/UPLOAD_GUIDE.md for the plain-language version of every rule
 * enforced here, and the plan this was built from for the pressure-tested reasoning.
 *
 * Bulk writes mirror prisma/seed.ts's shape — direct Prisma calls inside one transaction per
 * receipt, masters upserted first, batch-computed starting ids/seqs — not the interactive
 * per-field service API (`setStageFields`/`createReceipt`), which is correct for a single
 * PATCH from the UI but would mean thousands of wasted full-relation reloads at this volume.
 */
import ExcelJS from "exceljs";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import type { Finding } from "../domain/dataQuality/types.js";
import type { ImporterId, ParsedRow, DuplicateFlag } from "../domain/imports/types.js";
import { IMPORTERS, getImporter, checkImporter, detectImporter } from "../domain/imports/registry.js";
import type { OffloadingRow } from "../domain/imports/offloadings.js";
import type { DryingJobRow } from "../domain/imports/drying.js";
import type { JuteWarehouseStockRow } from "../domain/imports/juteWarehouseStock.js";
import type { JuteWarehouseTransferRow } from "../domain/imports/juteWarehouseTransfer.js";
import type { WarehouseDischargeRow } from "../domain/imports/warehouseDischarges.js";
import { prisma } from "../db.js";
import { toColumnPayload, STAGE_MODEL_DELEGATE } from "../stageStore.js";

export class ImportRejectedError extends Error {
  constructor(message: string, public detail: unknown) {
    super(message);
    this.name = "ImportRejectedError";
  }
}
export class ImportTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportTokenError";
  }
}

// Guards against a maliciously/accidentally huge workbook even within the multipart size cap
// (xlsx is a zip — a small file can inflate a lot). Every real shape here tops out at 989 rows /
// 61 columns; this is generous headroom, not a tight fit.
const MAX_ROWS = 20_000;
const MAX_COLS = 100;

function guardWorkbookSize(workbook: ExcelJS.Workbook) {
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > MAX_ROWS || sheet.columnCount > MAX_COLS) {
      throw new ImportRejectedError(
        `Sheet "${sheet.name}" is ${sheet.rowCount} rows x ${sheet.columnCount} columns — larger than this app's known shapes (max ${MAX_ROWS} rows / ${MAX_COLS} columns). Not parsed.`,
        { sheet: sheet.name, rows: sheet.rowCount, cols: sheet.columnCount }
      );
    }
  }
}

// ── Preview cache ────────────────────────────────────────────────────────────────────────────
// In-memory, single-Fastify-instance — see the plan this was built from for why a staging table
// was considered and rejected as more machinery than this admin-triggered flow needs.

interface CacheEntry {
  importerId: ImporterId;
  filename: string;
  rows: ParsedRow<unknown>[];
  duplicates: DuplicateFlag[];
  timer: NodeJS.Timeout;
}

const TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function cachePut(entry: Omit<CacheEntry, "timer">): string {
  const token = crypto.randomUUID();
  const timer = setTimeout(() => cache.delete(token), TTL_MS);
  cache.set(token, { ...entry, timer });
  return token;
}

function cacheTake(token: string): CacheEntry {
  const entry = cache.get(token);
  if (!entry) throw new ImportTokenError("This preview has expired or was already committed — upload the file again.");
  clearTimeout(entry.timer);
  cache.delete(token); // consumed exactly once, whether commit succeeds or fails
  return entry;
}

// ── Preview ──────────────────────────────────────────────────────────────────────────────────

export interface PreviewResponse {
  token: string;
  importerId: ImporterId;
  label: string;
  rowCount: number;
  skippedCount: number;
  duplicateCount: number;
  findings: Finding[];
  sampleRows: unknown[];
}

export async function previewImport(
  buffer: Buffer,
  filename: string,
  importerIdOverride?: ImporterId
): Promise<PreviewResponse> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs's own index.d.ts declares a module-local `interface Buffer extends ArrayBuffer {}`
    // that shadows Node's real Buffer (which extends Uint8Array) inside that file only — so
    // `load()`'s declared parameter type is that broken local shadow, not Node's Buffer, and a
    // real Buffer never structurally matches it. Upstream quirk (still present in exceljs 4.4.0,
    // the latest release), not a version mismatch on our side — cast past it here, at the single
    // call site, rather than laundering `buffer`'s real type anywhere else in this file.
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch (e) {
    throw new ImportRejectedError("Couldn't read this as an .xlsx file.", { error: String(e) });
  }
  guardWorkbookSize(workbook);

  let importerId: ImporterId;
  if (importerIdOverride) {
    // Manual override still runs the exact same header-fingerprint check as auto-detect — this is
    // the guard against the corruption case, and it applies whether the shape was guessed or
    // chosen, always. See headerCheck.ts.
    const check = checkImporter(workbook, importerIdOverride);
    if (!check.ok) {
      throw new ImportRejectedError(
        `This file doesn't match the "${getImporter(importerIdOverride).label}" shape.`,
        check
      );
    }
    importerId = importerIdOverride;
  } else {
    const detected = detectImporter(workbook);
    if (!detected.matched) {
      throw new ImportRejectedError(
        "Couldn't auto-detect which of the 5 known shapes this file is — pick one manually.",
        { attempts: detected.attempts }
      );
    }
    importerId = detected.matched;
  }

  const def = getImporter(importerId);
  const rows = def.parse(workbook);

  const { findings, duplicates } = await computeFindings(importerId, rows, filename);
  const token = cachePut({ importerId, filename, rows, duplicates });

  return {
    token,
    importerId,
    label: def.label,
    rowCount: rows.length,
    skippedCount: rows.filter((r) => r.skipReason).length,
    duplicateCount: duplicates.length,
    findings,
    sampleRows: rows.slice(0, 10).map((r) => r.data),
  };
}

/** GET /api/imports/types payload — the known shapes, for the manual-override dropdown. */
export function listImporterTypes() {
  return IMPORTERS.map((i) => ({
    id: i.id,
    label: i.label,
    exampleFilename: i.exampleFilename,
    expectedSheet: i.expectedSheet,
  }));
}

// ── Findings (dedup + the one generic anomaly check) ────────────────────────────────────────
// Findings are surfaced, never silently applied — same rule domain/dataQuality/ already follows.
// Aggregate, not per-row, for the same reason 367 identical DIFF rows is one finding there.

async function computeFindings(
  importerId: ImporterId,
  rows: ParsedRow<unknown>[],
  filename: string
): Promise<{ findings: Finding[]; duplicates: DuplicateFlag[] }> {
  const findings: Finding[] = [];
  let duplicates: DuplicateFlag[] = [];

  if (importerId === "receipts") {
    duplicates = await findReceiptDuplicates(rows as ParsedRow<OffloadingRow>[]);
  } else if (importerId === "juteWarehouseStock") {
    duplicates = await findLedger1Duplicates(rows as ParsedRow<JuteWarehouseStockRow>[]);
  }
  // dryingJobs / juteWarehouseTransfer: natural DB-unique keys, no content-key heuristic needed —
  // their dedup is a plain skipDuplicates at commit time (see the commit functions below).

  if (importerId === "warehouseDischarges") {
    findings.push(...(await dischargeLotFindings(rows as ParsedRow<WarehouseDischargeRow>[], filename)));
  }

  if (duplicates.length > 0) {
    findings.push({
      id: "likely_duplicate_rows",
      severity: "warning",
      title: "Rows that look like duplicates of existing data",
      entity: filename,
      affectedCount: duplicates.length,
      sampleIds: duplicates.slice(0, 5).map((d) => `row ${d.sheetRow}: ${d.reason}`),
      evidence: `Matched against ${duplicates[0]?.matchedAgainst ?? "existing records"} by content, not a source-provided key (this shape has none). "Skip likely duplicates" is on by default at commit time.`,
    });
  }

  // One generic, cheap check: a row where every real field carries the exact same literal value
  // is a known real artifact in the source data (confirmed in the drying sheet — a shifted row
  // where every column reads "BIN-03B") — reported, not silently dropped or "fixed".
  const suspicious = rows.filter((r) => {
    const vals = Object.values(r.data as Record<string, unknown>).filter((v) => typeof v === "string" && v.trim());
    return vals.length >= 3 && new Set(vals).size === 1;
  });
  if (suspicious.length > 0) {
    findings.push({
      id: "identical_field_values",
      severity: "info",
      title: "Rows where every field has the exact same value",
      entity: filename,
      affectedCount: suspicious.length,
      sampleIds: suspicious.slice(0, 5).map((r) => `row ${r.sheetRow}`),
      evidence: "Usually a shifted/corrupted source row rather than real data. Imported as-is — not corrected.",
    });
  }

  return { findings, duplicates };
}

async function findReceiptDuplicates(rows: ParsedRow<OffloadingRow>[]): Promise<DuplicateFlag[]> {
  const flags: DuplicateFlag[] = [];
  for (const row of rows) {
    const { vehicleNo, arrivalDate, supplierName } = row.data;
    if (!vehicleNo.trim() || !arrivalDate.trim()) continue;
    const match = await prisma.receipt.findFirst({
      where: {
        vehicleNo: { equals: vehicleNo.trim(), mode: "insensitive" },
        arrivalDate: arrivalDate.trim(),
        supplierName: { equals: supplierName.trim(), mode: "insensitive" },
      },
      select: { id: true },
    });
    if (match) {
      flags.push({
        sheetRow: row.sheetRow,
        matchedAgainst: match.id,
        reason: `vehicle ${vehicleNo} + ${arrivalDate} + ${supplierName} already exists as ${match.id}`,
      });
    }
  }
  return flags;
}

async function findLedger1Duplicates(rows: ParsedRow<JuteWarehouseStockRow>[]): Promise<DuplicateFlag[]> {
  const existing = await prisma.juteWarehouseMovement.findMany({
    select: {
      whLocation: true, movementDate: true, rawDate: true, activitiesType: true,
      bagsIssued: true, bagsReceived: true, truckNumber: true, wrNo: true,
    },
  });
  const existingKeys = new Set(
    existing.map((r) =>
      contentKey(r.whLocation, r.movementDate?.toISOString().slice(0, 10) ?? r.rawDate, r.activitiesType, r.bagsIssued, r.bagsReceived, r.truckNumber, r.wrNo)
    )
  );
  const flags: DuplicateFlag[] = [];
  for (const row of rows) {
    const d = row.data;
    const key = contentKey(d.whLocation, d.movementDate ?? d.rawDate, d.activitiesType, d.bagsIssued, d.bagsReceived, d.truckNumber, d.wrNo);
    if (existingKeys.has(key)) {
      flags.push({ sheetRow: row.sheetRow, matchedAgainst: "an existing warehouse-stock row", reason: "same date/activity/bag counts as an existing row" });
    }
  }
  return flags;
}

function contentKey(...parts: (string | number | null | undefined)[]): string {
  return parts.map((p) => (p === null || p === undefined ? "" : String(p).trim().toUpperCase())).join("\u0000");
}

// ── Commit ───────────────────────────────────────────────────────────────────────────────────

export interface CommitResponse {
  importerId: ImporterId;
  created: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  /** Only the warehouseDischarges importer writes back onto existing receipts, so these are
   * absent for every other shape rather than reported as a misleading zero. */
  lotWriteBack?: LotWriteBackResult;
}

/** What the Lot write-back did. Every skip is counted and named rather than silently applied —
 * the same "surface it, never fix it quietly" rule the data-quality checks follow. */
export interface LotWriteBackResult {
  written: number;
  /** The sheet's fiche matched no receipt — expected the first time a newer workbook arrives. */
  skippedUnmatched: number;
  /** Two rows in the sheet claim the same fiche, so which lot belongs to the receipt is unknowable
   * (fiche 82130 is exactly this on today's file: two different trucks). Never "first row wins". */
  skippedAmbiguous: number;
  /** That lot is already held by a DIFFERENT receipt in the same warehouse. Reassigning would
   * silently move a lot between trucks, so it is refused and reported. */
  skippedConflict: number;
}

export async function commitImport(token: string, opts: { skipFlagged: boolean }): Promise<CommitResponse> {
  const entry = cacheTake(token);
  const skippedInvalid = entry.rows.filter((r) => r.skipReason).length;
  const usable = entry.rows.filter((r) => !r.skipReason);
  const duplicateRows = opts.skipFlagged ? new Set(entry.duplicates.map((d) => d.sheetRow)) : new Set<number>();
  const toWrite = usable.filter((r) => !duplicateRows.has(r.sheetRow));

  let created = 0;
  let lotWriteBack: LotWriteBackResult | undefined;
  switch (entry.importerId) {
    case "warehouseDischarges": {
      const result = await commitWarehouseDischarges(
        toWrite as ParsedRow<WarehouseDischargeRow>[], entry.filename
      );
      created = result.created;
      lotWriteBack = result.lotWriteBack;
      break;
    }
    case "receipts":
      created = await commitReceipts(toWrite as ParsedRow<OffloadingRow>[], entry.filename);
      break;
    case "dryingJobs":
      created = await commitDryingJobs(toWrite as ParsedRow<DryingJobRow>[]);
      break;
    case "juteWarehouseStock":
      created = await commitJuteWarehouseStock(toWrite as ParsedRow<JuteWarehouseStockRow>[], entry.filename);
      break;
    case "juteWarehouseTransfer":
      created = await commitJuteWarehouseTransfer(toWrite as ParsedRow<JuteWarehouseTransferRow>[], entry.filename);
      break;
  }

  return {
    importerId: entry.importerId, created, skippedDuplicates: duplicateRows.size, skippedInvalid,
    ...(lotWriteBack ? { lotWriteBack } : {}),
  };
}

/** Upserts one master row per observed value not already known — the same "observed union with
 * provenance" pattern prisma/seed.ts uses for the initial seed, with a distinct source string so
 * an upload's masters are traceable separately from the original seed data. */
async function upsertObservedMasters(warehouses: Set<string>, origins: Set<string>, filename: string) {
  const source = `upload: ${filename}`;
  if (warehouses.size) {
    await prisma.warehouse.createMany({
      data: [...warehouses].map((name) => ({ name, source })),
      skipDuplicates: true,
    });
  }
  if (origins.size) {
    await prisma.origin.createMany({
      data: [...origins].map((name) => ({ name, source })),
      skipDuplicates: true,
    });
  }
}

/** Supplier.code is a soft-in-spirit relation on JuteWarehouseMovement.supplierCode, but Postgres
 * still enforces the FK for any non-null value — a code observed in an upload that isn't already a
 * known Supplier would fail the whole insert with a P2003 unless upserted first, same as
 * prisma/seed.ts does for the initial ledger-1 seed (where `name` falls back to the code itself,
 * since this ledger never carries a supplier name column — only supplierReceipts.ts's OFFLOADINGS
 * import gets a real name). */
async function upsertObservedSuppliers(codeToName: Map<string, string>, filename: string) {
  if (!codeToName.size) return;
  await prisma.supplier.createMany({
    data: [...codeToName].map(([code, name]) => ({ code, name, source: `upload: ${filename}` })),
    skipDuplicates: true,
  });
}

async function commitReceipts(rows: ParsedRow<OffloadingRow>[], filename: string): Promise<number> {
  if (rows.length === 0) return 0;

  const warehouses = new Set(rows.map((r) => r.data.warehouse.trim()).filter(Boolean));
  const origins = new Set(rows.map((r) => r.data.origin.trim()).filter(Boolean));
  const suppliers = new Map<string, string>();
  for (const r of rows) if (r.data.lbaCode.trim() && r.data.supplierName.trim()) suppliers.set(r.data.lbaCode.trim(), r.data.supplierName.trim());
  await upsertObservedMasters(warehouses, origins, filename);
  await upsertObservedSuppliers(suppliers, filename);

  // Batch-computed starting id — one scan, not one per row (avoids the O(n^2) rescan
  // nextReceiptId() does per-call, which is fine for a single interactive create but not for
  // hundreds of rows in one commit).
  const year = new Date().getFullYear();
  const prefix = `REC-${year}-`;
  const existingIds = await prisma.receipt.findMany({ where: { id: { startsWith: prefix } }, select: { id: true } });
  let counter = existingIds
    .map((r) => Number(r.id.slice(prefix.length)))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0);

  let created = 0;
  for (const row of rows) {
    counter += 1;
    const id = `${prefix}${String(counter).padStart(4, "0")}`;
    const d = row.data;
    await prisma.$transaction(async (tx) => {
      await tx.receipt.create({
        data: {
          id, source: "imported", arrivalDate: d.arrivalDate, supplierName: d.supplierName,
          lbaCode: d.lbaCode, vehicleNo: d.vehicleNo, warehouse: d.warehouse, origin: d.origin.trim() || null,
          timeline: { create: [{ status: "arrived", at: d.arrivalDate }] },
          stageEntries: { create: Object.keys(d.stageData).map((stageId) => ({ stageId })) },
        },
      });
      for (const [stageId, fields] of Object.entries(d.stageData)) {
        const spec = STAGE_MODEL_DELEGATE[stageId];
        if (!spec) continue;
        const data = toColumnPayload(stageId, fields);
        await (tx as any)[spec].create({ data: { receiptId: id, ...data } });
      }
    });
    created += 1;
  }
  return created;
}

async function commitDryingJobs(rows: ParsedRow<DryingJobRow>[]): Promise<number> {
  if (rows.length === 0) return 0;
  const result = await prisma.dryingJob.createMany({ data: rows.map((r) => r.data), skipDuplicates: true });
  return result.count;
}

async function commitJuteWarehouseStock(rows: ParsedRow<JuteWarehouseStockRow>[], filename: string): Promise<number> {
  if (rows.length === 0) return 0;
  const warehouses = new Set(rows.map((r) => r.data.whLocation.trim()).filter(Boolean));
  await upsertObservedMasters(warehouses, new Set(), filename);

  // supplierCode is nullable but, when set, still a real FK — the real sheet has 26 distinct
  // non-empty codes (confirmed against docs/Procurement/BOUAKE WAREHOUSE JUTE BAGS MOVEMENT
  // REPORT.xlsx). This ledger never carries a supplier NAME column, so `name` falls back to the
  // code itself, same as prisma/seed.ts's initial-seed upsert for this exact ledger.
  const supplierCodes = new Map<string, string>();
  for (const r of rows) if (r.data.supplierCode?.trim()) supplierCodes.set(r.data.supplierCode.trim(), r.data.supplierCode.trim());
  await upsertObservedSuppliers(supplierCodes, filename);

  const last = await prisma.juteWarehouseMovement.findFirst({ orderBy: { seq: "desc" }, select: { seq: true } });
  const startingSeq = last?.seq ?? 0;

  const result = await prisma.juteWarehouseMovement.createMany({
    data: rows.map((r) => ({
      seq: startingSeq + r.data.localSeq,
      sn: r.data.sn,
      sheetRow: r.sheetRow,
      movementDate: r.data.movementDate ? new Date(r.data.movementDate) : null,
      rawDate: r.data.rawDate,
      activitiesType: r.data.activitiesType,
      activityCategory: categoriseActivity(r.data.activitiesType),
      supplierCode: r.data.supplierCode?.trim() || null,
      whLocation: r.data.whLocation,
      truckNumber: r.data.truckNumber, wrNo: r.data.wrNo,
      bagsIssued: r.data.bagsIssued, bagsReceived: r.data.bagsReceived,
      reportedBalance: r.data.reportedBalance,
    })),
    skipDuplicates: true,
  });
  return result.count;
}

/** Same reading of the overloaded ACTIVITIES TYPE column as prisma/seed.ts's categorise(). */
function categoriseActivity(v: string): string | null {
  const s = v.toUpperCase();
  if (!s) return null;
  if (s.includes("TRANSFF") || s.includes("TRANSFER")) return "TRANSFER_OUT";
  if (s.includes("PURCHAS") || s.includes("UNLOADING")) return "PURCHASE";
  if (s.includes("REBAGGING")) return "REBAGGING";
  return "SUPPLIER_ISSUE";
}

async function commitJuteWarehouseTransfer(rows: ParsedRow<JuteWarehouseTransferRow>[], filename: string): Promise<number> {
  if (rows.length === 0) return 0;
  const warehouses = new Set(rows.map((r) => r.data.sourceWarehouse?.trim()).filter((v): v is string => Boolean(v)));
  await upsertObservedMasters(warehouses, new Set(), filename);

  const dec = (v: number | null) => (v === null ? null : new Prisma.Decimal(v));
  const result = await prisma.juteWarehouseTransferReceipt.createMany({
    data: rows.map((r) => ({
      sn: r.data.sn,
      receivedDate: r.data.receivedDate ? new Date(r.data.receivedDate) : null,
      rawDate: r.data.rawDate, month: r.data.month, dryUndry: r.data.dryUndry, idTransfer: r.data.idTransfer,
      truckRegistration: r.data.truckRegistration, lotNo: r.data.lotNo, lotDry: r.data.lotDry,
      noFiche: r.data.noFiche, ccaFicheNumber: r.data.ccaFicheNumber, binNo: r.data.binNo,
      damagedBags: r.data.damagedBags, newBagsUsed: r.data.newBagsUsed, recondition: r.data.recondition,
      sourceWarehouse: r.data.sourceWarehouse ?? "BOUAKE", origin: r.data.origin,
      bagsDispatched: r.data.bagsDispatched, bagsReceived: r.data.bagsReceived,
      reportedDifference: r.data.reportedDifference, finalBagsAfterRebagging: r.data.finalBagsAfterRebagging,
      reportedDiff: r.data.reportedDiff, laissePasserEntree: r.data.laissePasserEntree,
      fullyLoadedTruckWeight: r.data.fullyLoadedTruckWeight, emptyTruckTareWeight: r.data.emptyTruckTareWeight,
      grossWeightReceived: r.data.grossWeightReceived, netWeightAtArrival: r.data.netWeightAtArrival,
      netWeightDispatched: r.data.netWeightDispatched, weightDifference: r.data.weightDifference,
      korReceived: dec(r.data.korReceived), korReceivedRaw: r.data.korReceivedRaw,
      korDispatched: dec(r.data.korDispatched), korDispatchedRaw: r.data.korDispatchedRaw,
      moistureReceived: dec(r.data.moistureReceived), moistureReceivedRaw: r.data.moistureReceivedRaw,
      moistureDispatched: dec(r.data.moistureDispatched), moistureDispatchedRaw: r.data.moistureDispatchedRaw,
      ncArrival: r.data.ncArrival, comment: r.data.comment,
    })),
    skipDuplicates: true,
  });
  return result.count;
}

/** Bin codes observed in an upload. `Bin.code` is a plain id with no FK, so this is purely the
 * "observed union with provenance" pattern again — note DISCHARGEMENT introduces a THIRD bin
 * namespace (DIRECT-00x, 101 rows) alongside Bouaké's BKE-* and Yakro's BIN-*, which is why
 * reconciling bins is deliberately left out of this importer's write-back. */
async function upsertObservedBins(codes: Set<string>, filename: string) {
  if (!codes.size) return;
  await prisma.bin.createMany({
    data: [...codes].map((code) => ({ code, source: `upload: ${filename}` })),
    skipDuplicates: true,
  });
}

/**
 * Unit-warehouse offloading. Two distinct jobs, in order: store the sheet verbatim, then write the
 * Lot it assigns back onto the matching Receipt — the only path by which a receipt ever gets a real
 * Lot Number, since OFFLOADINGS has no Lot column.
 */
async function commitWarehouseDischarges(
  rows: ParsedRow<WarehouseDischargeRow>[],
  filename: string
): Promise<{ created: number; lotWriteBack: LotWriteBackResult }> {
  const empty: LotWriteBackResult = { written: 0, skippedUnmatched: 0, skippedAmbiguous: 0, skippedConflict: 0 };
  if (rows.length === 0) return { created: 0, lotWriteBack: empty };

  // ── Step A: masters, then the sheet stored verbatim ──
  const warehouses = new Set(rows.map((r) => r.data.warehouse?.trim()).filter((v): v is string => !!v));
  const origins = new Set(rows.map((r) => r.data.origin?.trim()).filter((v): v is string => !!v));
  const bins = new Set(rows.map((r) => r.data.unloadingBin?.trim()).filter((v): v is string => !!v));
  const suppliers = new Map<string, string>();
  for (const r of rows) {
    const code = r.data.supplierCode?.trim();
    if (code) suppliers.set(code, r.data.supplierName?.trim() || code);
  }
  await upsertObservedMasters(warehouses, origins, filename);
  await upsertObservedSuppliers(suppliers, filename);
  await upsertObservedBins(bins, filename);

  const dec = (v: number | null) => (v === null ? null : new Prisma.Decimal(v));
  const created = await prisma.warehouseDischarge.createMany({
    data: rows.map((r) => {
      const d = r.data;
      return {
        lotNo: d.lotNo, sn: d.sn, sheetRow: r.sheetRow, source: `upload: ${filename}`,
        warehouseSite: d.warehouseSite, warehouse: d.warehouse,
        unloadingBin: d.unloadingBin, afterDryingBin: d.afterDryingBin,
        scaleLocation: d.scaleLocation, whReceiptNo: d.whReceiptNo, ficheCca: d.ficheCca,
        truckNo: d.truckNo,
        arrivalDate: d.arrivalDate ? new Date(d.arrivalDate) : null, arrivalDateRaw: d.arrivalDateRaw,
        dischargeDate: d.dischargeDate ? new Date(d.dischargeDate) : null, dischargeDateRaw: d.dischargeDateRaw,
        origin: d.origin, supplierName: d.supplierName, supplierCode: d.supplierCode,
        bonSacs: d.bonSacs, humidSacs: d.humidSacs, tornSacs: d.tornSacs, reconSacs: d.reconSacs,
        totalSacsLot: d.totalSacsLot, sacsExports: d.sacsExports, sacsBio: d.sacsBio,
        sacsBrousses: d.sacsBrousses, totalRecd: d.totalRecd,
        grossWtRecd: dec(d.grossWtRecd), totalRefraction: dec(d.totalRefraction), grnQty: dec(d.grnQty),
        weightPaid: dec(d.weightPaid), netWeight: dec(d.netWeight), diff: dec(d.diff),
        grnFreshQty: dec(d.grnFreshQty), grnDriedQty: dec(d.grnDriedQty),
        samplingBrowns: dec(d.sampling.browns), samplingVoids: dec(d.sampling.voids),
        samplingOil: dec(d.sampling.oil), samplingTotDefect: dec(d.sampling.totDefect),
        samplingGoodKernel: dec(d.sampling.goodKernel), samplingImmature: dec(d.sampling.immature),
        samplingSpotted: dec(d.sampling.spotted), samplingTotKernels: dec(d.sampling.totKernels),
        samplingKor: dec(d.sampling.kor), samplingShot: dec(d.sampling.shot), samplingFot: dec(d.sampling.fot),
        samplingUsefulKernelsYield: dec(d.sampling.usefulKernelsYield),
        samplingTotalYield: dec(d.sampling.totalYield), samplingMoisture: dec(d.sampling.moisture),
        samplingNc: dec(d.sampling.nc), samplingShell: dec(d.sampling.shell),
        finalOffloadBrowns: dec(d.finalOffload.browns), finalOffloadVoids: dec(d.finalOffload.voids),
        finalOffloadOil: dec(d.finalOffload.oil), finalOffloadTotDefect: dec(d.finalOffload.totDefect),
        finalOffloadGoodKernel: dec(d.finalOffload.goodKernel), finalOffloadImmature: dec(d.finalOffload.immature),
        finalOffloadSpotted: dec(d.finalOffload.spotted), finalOffloadTotKernels: dec(d.finalOffload.totKernels),
        finalOffloadKor: dec(d.finalOffload.kor), finalOffloadShot: dec(d.finalOffload.shot),
        finalOffloadFot: dec(d.finalOffload.fot),
        finalOffloadUsefulKernelsYield: dec(d.finalOffload.usefulKernelsYield),
        finalOffloadTotalYield: dec(d.finalOffload.totalYield), finalOffloadMoisture: dec(d.finalOffload.moisture),
        finalOffloadNc: dec(d.finalOffload.nc), finalOffloadShell: dec(d.finalOffload.shell),
      };
    }),
    skipDuplicates: true,
  });

  return { created: created.count, lotWriteBack: await writeLotsOntoReceipts(rows) };
}

/**
 * Writes each discharge row's Lot onto the Receipt its fiche identifies.
 *
 * Bulk, not `setStageFields`: that helper reloads the whole 16-relation receipt per call, so 452 of
 * them would be ~1,800 statements for work that is ~20 here — exactly the waste this file's header
 * says the bulk path exists to avoid. The partial unique index stays the real guarantee; the
 * pre-checks below exist so a conflict is REPORTED rather than surfacing as a failed transaction.
 */
async function writeLotsOntoReceipts(rows: ParsedRow<WarehouseDischargeRow>[]): Promise<LotWriteBackResult> {
  const out: LotWriteBackResult = { written: 0, skippedUnmatched: 0, skippedAmbiguous: 0, skippedConflict: 0 };

  // A fiche claimed by two rows can't say which lot belongs to the receipt — never "first row wins".
  const rowsByFiche = new Map<string, ParsedRow<WarehouseDischargeRow>[]>();
  for (const r of rows) {
    const f = r.data.ficheCca.trim();
    if (!f) continue;
    if (!rowsByFiche.has(f)) rowsByFiche.set(f, []);
    rowsByFiche.get(f)!.push(r);
  }

  const verify = await prisma.stageVerifyDocs.findMany({
    where: { fiche: { in: [...rowsByFiche.keys()] } },
    select: { receiptId: true, fiche: true, receipt: { select: { warehouse: true } } },
  });
  const receiptByFiche = new Map(verify.map((v) => [v.fiche!.trim(), v]));

  interface Target { receiptId: string; warehouse: string; lotNo: string }
  const targets: Target[] = [];
  for (const [fiche, group] of rowsByFiche) {
    const hit = receiptByFiche.get(fiche);
    if (!hit) { out.skippedUnmatched += group.length; continue; }
    if (group.length > 1) { out.skippedAmbiguous += group.length; continue; }
    targets.push({ receiptId: hit.receiptId, warehouse: hit.receipt.warehouse, lotNo: group[0]!.data.lotNo });
  }
  if (targets.length === 0) return out;

  // Existing lot rows: which receipts already have one, and who already owns each (warehouse, lot).
  const [existingForTargets, owners] = await Promise.all([
    prisma.stageLotAssignment.findMany({
      where: { receiptId: { in: targets.map((t) => t.receiptId) } },
      select: { receiptId: true, lotNumber: true },
    }),
    prisma.stageLotAssignment.findMany({
      where: {
        warehouseName: { in: [...new Set(targets.map((t) => t.warehouse))] },
        lotNumber: { in: [...new Set(targets.map((t) => t.lotNo))] },
      },
      select: { receiptId: true, warehouseName: true, lotNumber: true },
    }),
  ]);
  const hasRow = new Set(existingForTargets.map((e) => e.receiptId));
  const ownerOf = new Map(owners.map((o) => [`${o.warehouseName}\u0000${o.lotNumber}`, o.receiptId]));

  const toCreate: Target[] = [];
  const toUpdate: Target[] = [];
  for (const t of targets) {
    const owner = ownerOf.get(`${t.warehouse}\u0000${t.lotNo}`);
    // Already ours → genuine no-op, and what makes re-uploading the same file idempotent.
    if (owner === t.receiptId) continue;
    // Someone else's → refuse. Reassigning would silently move a lot between trucks.
    if (owner) { out.skippedConflict += 1; continue; }
    (hasRow.has(t.receiptId) ? toUpdate : toCreate).push(t);
  }

  // `warehouseName` is not a stage field, so it is set alongside the payload rather than through
  // toColumnPayload() — which stays the only thing naming real stage columns.
  await prisma.$transaction(async (tx) => {
    if (toCreate.length || toUpdate.length) {
      await tx.stageEntry.createMany({
        data: [...toCreate, ...toUpdate].map((t) => ({ receiptId: t.receiptId, stageId: "n-lot" })),
        skipDuplicates: true,
      });
    }
    if (toCreate.length) {
      await tx.stageLotAssignment.createMany({
        data: toCreate.map((t) => ({
          receiptId: t.receiptId,
          warehouseName: t.warehouse,
          ...toColumnPayload("n-lot", { "Lot Number": t.lotNo }),
        })),
        skipDuplicates: true,
      });
    }
    // Partial update: these rows already carry a real truck reference / assigned-by from the seed,
    // and this sheet has nothing better to say about either.
    for (const t of toUpdate) {
      await tx.stageLotAssignment.update({
        where: { receiptId: t.receiptId },
        data: { warehouseName: t.warehouse, ...toColumnPayload("n-lot", { "Lot Number": t.lotNo }) },
      });
    }
  });

  out.written = toCreate.length + toUpdate.length;
  return out;
}

/**
 * What the Lot write-back will and won't be able to do, reported BEFORE anything is written — so
 * the operator sees it on the preview rather than discovering it in the commit counts afterwards.
 * Aggregate, like every other finding.
 */
async function dischargeLotFindings(
  rows: ParsedRow<WarehouseDischargeRow>[],
  filename: string
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const usable = rows.filter((r) => !r.skipReason);

  const rowsByFiche = new Map<string, ParsedRow<WarehouseDischargeRow>[]>();
  for (const r of usable) {
    const f = r.data.ficheCca.trim();
    if (!f) continue;
    if (!rowsByFiche.has(f)) rowsByFiche.set(f, []);
    rowsByFiche.get(f)!.push(r);
  }

  const ambiguous = [...rowsByFiche.entries()].filter(([, g]) => g.length > 1);
  if (ambiguous.length) {
    findings.push({
      id: "fiche_duplicated_in_sheet", severity: "warning",
      title: "Two rows claim the same Fiche, so their Lot can't be assigned",
      entity: filename,
      affectedCount: ambiguous.reduce((n, [, g]) => n + g.length, 0),
      sampleIds: ambiguous.slice(0, 5).map(([f, g]) => `fiche ${f}: rows ${g.map((r) => r.sheetRow).join(", ")}`),
      evidence:
        "One Fiche identifies one truck, so two rows carrying it can't say which Lot belongs to that " +
        "receipt. These rows are still stored in full; only the Lot write-back is skipped for them, " +
        "because guessing (first row wins) would silently attach a real Lot to the wrong truck.",
    });
  }

  const known = await prisma.stageVerifyDocs.findMany({
    where: { fiche: { in: [...rowsByFiche.keys()] } }, select: { fiche: true },
  });
  const knownFiches = new Set(known.map((k) => k.fiche!.trim()));
  const unmatched = [...rowsByFiche.entries()].filter(([f]) => !knownFiches.has(f));
  if (unmatched.length) {
    findings.push({
      id: "fiche_not_matched", severity: "info",
      title: "Rows whose Fiche matches no receipt in the app",
      entity: filename,
      affectedCount: unmatched.reduce((n, [, g]) => n + g.length, 0),
      sampleIds: unmatched.slice(0, 5).map(([f, g]) => `row ${g[0]!.sheetRow}: fiche ${f}`),
      evidence:
        "Expected whenever this sheet runs ahead of the receipts sheet — the offloading was recorded " +
        "before that truck's arrival was imported. The rows are stored in full; their Lot simply has " +
        "no receipt to attach to yet, and re-uploading after importing the receipts will attach it.",
    });
  }

  return findings;
}
