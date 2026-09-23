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
        "Couldn't auto-detect which of the 4 known shapes this file is — pick one manually.",
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
}

export async function commitImport(token: string, opts: { skipFlagged: boolean }): Promise<CommitResponse> {
  const entry = cacheTake(token);
  const skippedInvalid = entry.rows.filter((r) => r.skipReason).length;
  const usable = entry.rows.filter((r) => !r.skipReason);
  const duplicateRows = opts.skipFlagged ? new Set(entry.duplicates.map((d) => d.sheetRow)) : new Set<number>();
  const toWrite = usable.filter((r) => !duplicateRows.has(r.sheetRow));

  let created = 0;
  switch (entry.importerId) {
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

  return { importerId: entry.importerId, created, skippedDuplicates: duplicateRows.size, skippedInvalid };
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
