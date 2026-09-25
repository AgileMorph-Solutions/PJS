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
import type { OffloadingRow } from "../domain/imports/truckReception.js";
import type { JuteWarehouseStockRow } from "../domain/imports/juteBagsMovement.js";
import type { DryingSortingRow } from "../domain/imports/dryingSorting.js";
import type { SupplierMasterRow } from "../domain/imports/suppliersMaster.js";
import type { JuteWarehouseTransferRow } from "../domain/imports/juteWarehouseTransfer.js";
import type { WarehouseDischargeRow } from "../domain/imports/warehouseDischarges.js";
import type { WarehouseDispatchLineRow } from "../domain/imports/warehouseDispatches.js";
import type { DryingBatchRow } from "../domain/imports/dryingBatch.js";
import type { IssuedToProductionRow } from "../domain/imports/issuedToProduction.js";
import type { WarehouseReceivingRow } from "../domain/imports/warehouseReceiving.js";
import type { WarehouseActivityLedgerRow } from "../domain/imports/warehouseActivityLedger.js";
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
        "Couldn't auto-detect which of the 10 known shapes this file is — pick one manually.",
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

  if (importerId === "truckReception") {
    duplicates = await findReceiptDuplicates(rows as ParsedRow<OffloadingRow>[]);
  } else if (importerId === "juteBagsMovement") {
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
    case "truckReception":
      created = await commitReceipts(toWrite as ParsedRow<OffloadingRow>[], entry.filename);
      break;
    case "juteBagsMovement":
      created = await commitJuteWarehouseStock(toWrite as ParsedRow<JuteWarehouseStockRow>[], entry.filename);
      break;
    case "dryingSorting":
      created = await commitDryingSorting(toWrite as ParsedRow<DryingSortingRow>[], entry.filename);
      break;
    case "suppliersMaster":
      created = await commitSuppliersMaster(toWrite as ParsedRow<SupplierMasterRow>[]);
      break;
    case "juteWarehouseTransfer":
      created = await commitJuteWarehouseTransfer(toWrite as ParsedRow<JuteWarehouseTransferRow>[], entry.filename);
      break;
    case "warehouseDispatches":
      created = await commitWarehouseDispatches(toWrite as ParsedRow<WarehouseDispatchLineRow>[], entry.filename);
      break;
    case "dryingBatch":
      created = await commitDryingBatch(toWrite as ParsedRow<DryingBatchRow>[], entry.filename);
      break;
    case "issuedToProduction":
      created = await commitIssuedToProduction(toWrite as ParsedRow<IssuedToProductionRow>[], entry.filename);
      break;
    case "warehouseReceiving":
      // Deliberately NOT commitWarehouseDischarges — see that function's own header comment and
      // warehouseReceiving.ts's: this path must never call writeLotsOntoReceipts(). A genuinely
      // separate function, not a copy that accidentally reintroduces the write-back.
      created = await commitWarehouseReceiving(toWrite as ParsedRow<WarehouseReceivingRow>[], entry.filename);
      break;
    case "warehouseActivityLedger":
      created = await commitWarehouseActivityLedger(toWrite as ParsedRow<WarehouseActivityLedgerRow>[], entry.filename);
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

/** The Suppliers sheet IS the canonical master (unlike every other importer's "observed union"
 * upsert) — an existing code's name is updated, not just filled in when missing. 58 rows, cheap
 * enough for a plain per-row upsert loop (same reasoning as upsertObservedStores). */
async function commitSuppliersMaster(rows: ParsedRow<SupplierMasterRow>[]): Promise<number> {
  if (rows.length === 0) return 0;
  let created = 0;
  for (const r of rows) {
    const code = r.data.code.trim();
    const existing = await prisma.supplier.findUnique({ where: { code } });
    await prisma.supplier.upsert({
      where: { code },
      update: { name: r.data.name },
      create: { code, name: r.data.name, source: "upload: ANAGROCI DATA PROCUREMENT 2026.xlsx (sheet Suppliers)" },
    });
    if (!existing) created += 1;
  }
  return created;
}

async function commitDryingSorting(rows: ParsedRow<DryingSortingRow>[], filename: string): Promise<number> {
  if (rows.length === 0) return 0;
  const warehouses = new Set(rows.map((r) => r.data.warehouseSite?.trim()).filter((v): v is string => !!v));
  await upsertObservedMasters(warehouses, new Set(), filename);

  const dec = (v: number | null) => (v === null ? null : new Prisma.Decimal(v));
  const result = await prisma.dryingSortingReport.createMany({
    data: rows.map((r) => {
      const d = r.data;
      return {
        sn: d.sn, sheetRow: r.sheetRow, source: `upload: ${filename}`,
        dryingDate: d.dryingDate ? new Date(d.dryingDate) : null, dryingDateRaw: d.dryingDateRaw,
        warehouseSite: d.warehouseSite, warehouse: d.warehouse,
        unloadingBin: d.unloadingBin, afterDryingBin: d.afterDryingBin,
        lotNo: d.lotNo, lotNoRaw: d.lotNoRaw, whReceiptNoRaw: d.whReceiptNoRaw,
        origin: d.origin, supplierName: d.supplierName,
        supplierCodeAnagroci: d.supplierCodeAnagroci, supplierCodeCcak: d.supplierCodeCcak,
        issuedNetWeightGrn: dec(d.issuedNetWeightGrn), receivedNetWeightAfterDrying: dec(d.receivedNetWeightAfterDrying),
        inputMoisture: dec(d.inputMoisture), inputNutCount: dec(d.inputNutCount), inputKor: dec(d.inputKor),
        outputMoisture: dec(d.outputMoisture), outputNutCount: dec(d.outputNutCount), outputKor: dec(d.outputKor),
        drainageLossKg: dec(d.drainageLossKg), lossPct: dec(d.lossPct),
        drainageLossKg2: dec(d.drainageLossKg2), drainageLossPct: dec(d.drainageLossPct),
        goodOrDriedSacs: d.goodOrDriedSacs, damagedNutsKgTriage: dec(d.damagedNutsKgTriage),
        totalSacReceived: d.totalSacReceived, inputBagsForDrying: d.inputBagsForDrying,
        outputBagsAfterDrying: d.outputBagsAfterDrying, dryingPicking: d.dryingPicking, remarks: d.remarks,
      };
    }),
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

/** The sheet this importer reads ("Bouake Stock Reciving") only ever asserts its destination in
 * column HEADERS ("Gross Weight (Yakro) Recived", "KOR Received (At Yakro)", ...), never in a
 * per-row cell — see JuteWarehouseTransferReceipt.destinationProvenance's comment. Constant across
 * every row this importer has ever produced, so it's set here at commit time, not parsed. */
const INFERRED_DESTINATION = "YAKRO FACTORY";

async function commitJuteWarehouseTransfer(rows: ParsedRow<JuteWarehouseTransferRow>[], filename: string): Promise<number> {
  if (rows.length === 0) return 0;
  const warehouses = new Set(rows.map((r) => r.data.sourceWarehouse?.trim()).filter((v): v is string => Boolean(v)));
  warehouses.add(INFERRED_DESTINATION);
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
      // Non-null by construction: rows with a blank source warehouse are skipped by the parser
      // before reaching `usable`/`toWrite` (see juteWarehouseTransfer.ts) rather than defaulted here.
      sourceWarehouse: r.data.sourceWarehouse!, origin: r.data.origin,
      destinationWarehouse: INFERRED_DESTINATION, destinationProvenance: "inferred",
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

/** A store (e.g. BKE-002) observed alongside the site it belongs to. `createMany({skipDuplicates})`
 * can't be used here — a store code may already exist as a bare row from before the warehouse-
 * typology migration, and skipDuplicates would leave its `site` unset forever. An explicit upsert
 * loop is what actually backfills `site` on an existing row, not just on a newly-created one; the
 * per-commit cardinality is at most a handful of distinct stores, so the loop is cheap. */
async function upsertObservedStores(storeToSite: Map<string, string>, filename: string) {
  for (const [store, site] of storeToSite) {
    await prisma.warehouse.upsert({
      where: { name: store },
      update: { site },
      create: { name: store, site, source: `upload: ${filename}` },
    });
  }
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
  // Real hierarchy is Site -> Store -> Bin (BOUAKE -> BKE-002 -> BKE-002-BIN-026). `warehouseSite`
  // is the SITE ("BOUAKE") — a plain observed-master upsert, same as every other importer.
  // `warehouse` is a STORE ("BKE-001"/"BKE-002"/"BKE-003") — a level below a site, not a warehouse
  // itself, so it gets its own upsert (below) that also records which site it belongs to. An
  // earlier version of this importer upserted the store code as if it were a site; the
  // warehouse-typology migration reclassified the three rows that mistake had already created.
  const warehouses = new Set(rows.map((r) => r.data.warehouseSite?.trim()).filter((v): v is string => !!v));
  const origins = new Set(rows.map((r) => r.data.origin?.trim()).filter((v): v is string => !!v));
  const bins = new Set(rows.map((r) => r.data.unloadingBin?.trim()).filter((v): v is string => !!v));
  const storeToSite = new Map<string, string>();
  for (const r of rows) {
    const store = r.data.warehouse?.trim(), site = r.data.warehouseSite?.trim();
    if (store && site) storeToSite.set(store, site);
  }
  const suppliers = new Map<string, string>();
  for (const r of rows) {
    const code = r.data.supplierCode?.trim();
    if (code) suppliers.set(code, r.data.supplierName?.trim() || code);
  }
  await upsertObservedMasters(warehouses, origins, filename);
  await upsertObservedSuppliers(suppliers, filename);
  await upsertObservedBins(bins, filename);
  await upsertObservedStores(storeToSite, filename);

  const dec = (v: number | null) => (v === null ? null : new Prisma.Decimal(v));
  const created = await prisma.warehouseDischarge.createMany({
    data: rows.map((r) => {
      const d = r.data;
      return {
        lotNo: d.lotNo, sn: d.sn, sheetRow: r.sheetRow, source: `upload: ${filename}`,
        // Non-null by construction: the parser's third skip-guard filters out every row with a
        // blank warehouseSite before it reaches `usable`/`toWrite`, so nothing without one gets here.
        warehouseSite: d.warehouseSite!, warehouse: d.warehouse,
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

/**
 * Unit-warehouse dispatch out (CHARGEMENT). Flat parent/line shape — see
 * WarehouseDispatchLine's schema.prisma comment. No write-back to any receipt stage: this sheet's
 * Fiche column is optional and this importer does not attempt the same fiche->receipt bridge
 * warehouseDischarges.ts does.
 */
async function commitWarehouseDispatches(rows: ParsedRow<WarehouseDispatchLineRow>[], filename: string): Promise<number> {
  if (rows.length === 0) return 0;

  const warehouses = new Set(rows.map((r) => r.data.warehouseSite?.trim()).filter((v): v is string => !!v));
  const origins = new Set(rows.map((r) => r.data.origin?.trim()).filter((v): v is string => !!v));
  const bins = new Set(rows.map((r) => r.data.bin?.trim()).filter((v): v is string => !!v));
  const storeToSite = new Map<string, string>();
  for (const r of rows) {
    const store = r.data.warehouse?.trim(), site = r.data.warehouseSite?.trim();
    if (store && site) storeToSite.set(store, site);
  }
  await upsertObservedMasters(warehouses, origins, filename);
  await upsertObservedBins(bins, filename);
  await upsertObservedStores(storeToSite, filename);

  const dec = (v: number | null) => (v === null ? null : new Prisma.Decimal(v));
  const result = await prisma.warehouseDispatchLine.createMany({
    data: rows.map((r) => {
      const d = r.data;
      return {
        sn: d.sn, chargeDate: d.chargeDate ? new Date(d.chargeDate) : null, chargeDateRaw: d.chargeDateRaw,
        warehouseSite: d.warehouseSite, vyogeNumber: d.vyogeNumber, remark: d.remark,
        scaleLocation: d.scaleLocation, warehouse: d.warehouse, whOrDirect: d.whOrDirect, bin: d.bin,
        origin: d.origin, truckNo: d.truckNo, transporter: d.transporter, driver: d.driver,
        phone: d.phone, whReceiptNo: d.whReceiptNo, ficheCca: d.ficheCca,
        binwiseLoadedBags: d.binwiseLoadedBags, totalBags: d.totalBags,
        grossWt: dec(d.grossWt), netWeight: dec(d.netWeight),
        status: d.status, unloadingStatus: d.unloadingStatus,
        browns: dec(d.panel.browns), voids: dec(d.panel.voids), oil: dec(d.panel.oil),
        totDefect: dec(d.panel.totDefect), goodKernel: dec(d.panel.goodKernel),
        immature: dec(d.panel.immature), spotted: dec(d.panel.spotted), totKernels: dec(d.panel.totKernels),
        kor: dec(d.panel.kor), shot: dec(d.panel.shot), fot: dec(d.panel.fot),
        usefulKernelsYield: dec(d.panel.usefulKernelsYield), totalYield: dec(d.panel.totalYield),
        moisture: dec(d.panel.moisture), nc: dec(d.panel.nc), shell: dec(d.panel.shell),
        bagsYakro: d.bagsYakro, grossYakro: dec(d.grossYakro), differenceWeight: dec(d.differenceWeight),
        sheetRow: r.sheetRow, source: `upload: ${filename}`,
      };
    }),
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * Consolidated Drying Batch (both sites). Stores the client's own *_raw twins verbatim; the clean
 * `lotNo` is exactly what dryingBatch.ts's resolveCleanLotNo() already decided — no further logic
 * here. No write-back to DryingJob/receipt stages this pass (see the plan: DryingJob stays the
 * live source until a reconciliation check reports zero drift).
 */
async function commitDryingBatch(rows: ParsedRow<DryingBatchRow>[], filename: string): Promise<number> {
  if (rows.length === 0) return 0;

  const warehouses = new Set(rows.map((r) => r.data.warehouseSite?.trim()).filter((v): v is string => !!v));
  const bins = new Set<string>();
  for (const r of rows) {
    if (r.data.sourceBinNo?.trim()) bins.add(r.data.sourceBinNo.trim());
    if (r.data.destinationBinNo?.trim()) bins.add(r.data.destinationBinNo.trim());
  }
  const storeToSite = new Map<string, string>();
  for (const r of rows) {
    const store = r.data.warehouse?.trim(), site = r.data.warehouseSite?.trim();
    if (store && site) storeToSite.set(store, site);
  }
  await upsertObservedMasters(warehouses, new Set(), filename);
  await upsertObservedBins(bins, filename);
  await upsertObservedStores(storeToSite, filename);

  const dec = (v: number | null) => (v === null ? null : new Prisma.Decimal(v));
  const result = await prisma.dryingBatch.createMany({
    data: rows.map((r) => {
      const d = r.data;
      return {
        sn: d.sn, dryingDate: d.dryingDate ? new Date(d.dryingDate) : null, dryingDateRaw: d.dryingDateRaw,
        warehouseSite: d.warehouseSite, warehouse: d.warehouse,
        sourceBinNo: d.sourceBinNo, destinationBinNo: d.destinationBinNo,
        lotNoRaw: d.lotNoRaw, lotNo: d.lotNo,
        whReceiptNoRaw: d.whReceiptNoRaw, ficheNoRaw: d.ficheNoRaw, originRaw: d.originRaw,
        supplierNameRaw: d.supplierNameRaw, supplierCodeRaw: d.supplierCodeRaw,
        ccakSupplierCodeRaw: d.ccakSupplierCodeRaw, status: d.status, dryType: d.dryType,
        destinationRaw: d.destinationRaw,
        issuedGrossWithBagsPalletsKg: dec(d.issuedGrossWithBagsPalletsKg),
        issuedPalletWeightKg: dec(d.issuedPalletWeightKg), issuedGrossWithBagsKg: dec(d.issuedGrossWithBagsKg),
        issuedBags: d.issuedBags, issuedNetWeightKg: dec(d.issuedNetWeightKg),
        receivedGrossWithBagsPalletsKg: dec(d.receivedGrossWithBagsPalletsKg),
        receivedPalletWeightKg: dec(d.receivedPalletWeightKg),
        receivedGrossWithBagsKg: dec(d.receivedGrossWithBagsKg), receivedBags: d.receivedBags,
        receivedNetWeightKg: dec(d.receivedNetWeightKg),
        inputMoisturePct: dec(d.inputMoisturePct), inputNutCount: dec(d.inputNutCount), inputKor: dec(d.inputKor),
        outputMoisturePct: dec(d.outputMoisturePct), outputNutCount: dec(d.outputNutCount), outputKor: dec(d.outputKor),
        oil: dec(d.oil), rejection: dec(d.rejection), goodKernel: dec(d.goodKernel), immature: dec(d.immature),
        spotted: dec(d.spotted), shell: dec(d.shell), void: dec(d.voidField),
        moistureLossPct: dec(d.moistureLossPct), dryingLossKg: dec(d.dryingLossKg), dryingLossPct: dec(d.dryingLossPct),
        triageLossKg: dec(d.triageLossKg), triageLossPct: dec(d.triageLossPct), damagedNutsKg: dec(d.damagedNutsKg),
        inputBagsForDrying: d.inputBagsForDrying, outputBagsAfterDrying: d.outputBagsAfterDrying,
        dryingOrPicking: d.dryingOrPicking, remarks: d.remarks, issuedToProduction: d.issuedToProduction,
        reDryingDate: d.reDryingDate ? new Date(d.reDryingDate) : null, reDryingDateRaw: d.reDryingDateRaw,
        moistureFirstRedryPct: dec(d.moistureFirstRedryPct), moistureSecondDryPct: dec(d.moistureSecondDryPct),
        issuedToProduction3: d.issuedToProduction3, remarks4: d.remarks4,
        needsLotAllocationClarificationRaw: d.needsLotAllocationClarificationRaw,
        sheetRow: r.sheetRow, source: `upload: ${filename}`,
      };
    }),
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * Issued to Production Section. btmNo is a soft reference by design — never upserted into
 * BtmIntake here (ground rule §4: a sheet running ahead of production's own intake records is not
 * evidence a BtmIntake should be invented). Source Bin / DRY BIN pairs are reported by
 * production_issue_source_dry_bin_pairs, never normalised.
 */
async function commitIssuedToProduction(rows: ParsedRow<IssuedToProductionRow>[], filename: string): Promise<number> {
  if (rows.length === 0) return 0;
  const result = await prisma.issuedToProduction.createMany({
    data: rows.map((r) => {
      const d = r.data;
      return {
        btmNo: d.btmNo, sNo: d.sNo ? String(d.sNo) : null, date: d.date ?? d.dateRaw,
        rcn: d.rcn, sourceBin: d.sourceBin, dryBin: d.dryBin, binStatus: d.binStatus,
        korIssued: d.korIssued, nutCount: d.nutCount, gk: d.gk, moisture: d.moisture,
        immature: d.immature, spotted: d.spotted, rejection: d.rejection, oilGram: d.oilGram,
        voidGram: d.voidGram, shellGram: d.shellGram, ficheNo: d.ficheNo,
        bagInStockAfterDry: d.bagInStockAfterDry, noOfBagIssuedToProduction: d.noOfBagIssuedToProduction,
        avgBagWtEmptyBag: d.avgBagWtEmptyBag, bagWtEmptyBag: d.bagWtEmptyBag, noOfPallet: d.noOfPallet,
        avgPalletWt: d.avgPalletWt, palletWeightKg: d.palletWeightKg, grossWtBeforeDry: d.grossWtBeforeDry,
        grossWtAfterDryingWithJuteBag: d.grossWtAfterDryingWithJuteBag,
        netWtWithoutJuteBag: d.netWtWithoutJuteBag, dateOfIssueToCalibration: d.dateOfIssueToCalibration,
        receivedByProductionNetWt: d.receivedByProductionNetWt, issuedFrom: d.issuedFrom,
        diffInIssue: d.diffInIssue, remarks: d.remarks, checkValue: d.checkValue,
        sheetRow: r.sheetRow, source: `upload: ${filename}`,
      };
    }),
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * Warehouse Receiving — a SECOND, richer source for WarehouseDischarge (see that model's own
 * schema.prisma comment). Deliberately a standalone function, not a call into
 * commitWarehouseDischarges: it must NEVER call writeLotsOntoReceipts(). Re-importing after
 * warehouseDischarges.ts has already written the 454 Bouaké rows inserts only the 256 genuinely new
 * Yamoussoukro ones — the composite (warehouseSite, lotNo) key (step 3) is what makes that safe.
 */
async function commitWarehouseReceiving(rows: ParsedRow<WarehouseReceivingRow>[], filename: string): Promise<number> {
  if (rows.length === 0) return 0;

  const warehouses = new Set(rows.map((r) => r.data.warehouseSite?.trim()).filter((v): v is string => !!v));
  const origins = new Set(rows.map((r) => r.data.origin?.trim()).filter((v): v is string => !!v));
  const bins = new Set<string>();
  for (const r of rows) {
    if (r.data.initialBinNo?.trim()) bins.add(r.data.initialBinNo.trim());
    if (r.data.afterDryingBinNo?.trim()) bins.add(r.data.afterDryingBinNo.trim());
  }
  const storeToSite = new Map<string, string>();
  for (const r of rows) {
    const store = r.data.warehouse?.trim(), site = r.data.warehouseSite?.trim();
    if (store && site) storeToSite.set(store, site);
  }
  const suppliers = new Map<string, string>();
  for (const r of rows) {
    const code = r.data.supplierCode?.trim();
    if (code) suppliers.set(code, r.data.supplierName?.trim() || code);
  }
  await upsertObservedMasters(warehouses, origins, filename);
  await upsertObservedBins(bins, filename);
  await upsertObservedStores(storeToSite, filename);
  await upsertObservedSuppliers(suppliers, filename);

  const dec = (v: number | null) => (v === null ? null : new Prisma.Decimal(v));
  const result = await prisma.warehouseDischarge.createMany({
    data: rows.map((r) => {
      const d = r.data;
      return {
        lotNo: d.lotNo, sn: d.sn, sheetRow: r.sheetRow, source: `upload: ${filename}`,
        warehouseSite: d.warehouseSite, warehouse: d.warehouse,
        unloadingBin: d.initialBinNo, afterDryingBin: d.afterDryingBinNo,
        lotDry: d.lotDry, deliveryNoteNo: d.deliveryNoteNo,
        scaleLocation: d.scaleLocation, whReceiptNo: d.whReceiptNo, ficheDateRaw: d.ficheDateRaw,
        activity: d.activity, ccakValidated: d.ccakValidated, storageArea: d.storageArea,
        ficheCca: d.ficheCca, truckNo: d.truckNo,
        arrivalDate: d.arrivalDate ? new Date(d.arrivalDate) : null, arrivalDateRaw: d.arrivalDateRaw,
        dischargeDate: d.dischargeDate ? new Date(d.dischargeDate) : null, dischargeDateRaw: d.dischargeDateRaw,
        origin: d.origin, supplierName: d.supplierName, ccaNo: d.ccaNo, supplierCode: d.supplierCode,
        goodBagsOffloaded: d.goodBagsOffloaded, damagedBagsOffloaded: d.damagedBagsOffloaded,
        totalBagsDischarged: d.totalBagsDischarged, reconditionBags: d.reconditionBags,
        totalBagsStock: d.totalBagsStock, newBagsUsedRecondition: d.newBagsUsedRecondition,
        bonSacs: d.bonSacs, humidSacs: d.humidSacs, tornSacs: d.tornSacs,
        reconditionFlag: d.reconditionFlag, reconditionedBags: d.reconditionedBags,
        totalSacsLot: d.totalSacsLot, sacsExports: d.sacsExports, sacsBio: d.sacsBio,
        sacsBrousses: d.sacsBrousses, totalRecd: d.totalRecd,
        grossWtRecd: dec(d.grossWtRecd), totalRefraction: dec(d.totalRefraction), grnQty: dec(d.grnQty),
        weightPaid: dec(d.weightPaid), netWeight: dec(d.netWeight),
        weightDifferenceKg: dec(d.weightDifferenceKg), netWeightBookKg: dec(d.netWeightBookKg),
        grnFreshQty: dec(d.grnFreshQty), grnDriedQty: dec(d.grnDriedQty),
        q1RejectionG: dec(d.q1.rejectionG), q1VoidG: dec(d.q1.voidG), q1OilG: dec(d.q1.oilG),
        q1TotalDefectG: dec(d.q1.totalDefectG), q1GoodKernelG: dec(d.q1.goodKernelG),
        q1ImmatureG: dec(d.q1.immatureG), q1SpottedG: dec(d.q1.spottedG),
        q1TotalKernelsG: dec(d.q1.totalKernelsG), q1Kor: dec(d.q1.kor), q1Murli: dec(d.q1.murli),
        q1Shot: dec(d.q1.shot), q1Fot: dec(d.q1.fot),
        q1UsefulKernelYieldPct: dec(d.q1.usefulKernelYieldPct), q1TotalYieldPct: dec(d.q1.totalYieldPct),
        q1MoisturePct: dec(d.q1.moisturePct), q1NutCount: dec(d.q1.nutCount), q1ShellG: dec(d.q1.shellG),
        q2RejectionG: dec(d.q2.rejectionG), q2MurliTotalPct: dec(d.q2.murliTotalPct), q2VoidG: dec(d.q2.voidG),
        q2OilG: dec(d.q2.oilG), q2TotalDefectG: dec(d.q2.totalDefectG), q2GoodKernelG: dec(d.q2.goodKernelG),
        q2ImmatureG: dec(d.q2.immatureG), q2SpottedG: dec(d.q2.spottedG), q2TotalKernelsG: dec(d.q2.totalKernelsG),
        q2Kor: dec(d.q2.kor), q2Murli: dec(d.q2.murli), q2AfterDryKor: dec(d.q2.afterDryKor),
        q2Shot: dec(d.q2.shot), q2Fot: dec(d.q2.fot),
        q2UsefulKernelYieldPct: dec(d.q2.usefulKernelYieldPct), q2TotalYieldPct: dec(d.q2.totalYieldPct),
        q2MoisturePct: dec(d.q2.moisturePct), q2NutCount: dec(d.q2.nutCount), q2ShellG: dec(d.q2.shellG),
      };
    }),
    skipDuplicates: true,
  });
  return result.count;
}

/** Warehouse activity ledger — its own site-agnostic table (the source sheet carries no site
 * column at all — see WarehouseActivityLedgerEntry's schema.prisma comment). No master upserts:
 * every field is plain verbatim text with no FK. */
async function commitWarehouseActivityLedger(rows: ParsedRow<WarehouseActivityLedgerRow>[], filename: string): Promise<number> {
  if (rows.length === 0) return 0;
  const result = await prisma.warehouseActivityLedgerEntry.createMany({
    data: rows.map((r) => {
      const d = r.data;
      return {
        activityDate: d.activityDate ? new Date(d.activityDate) : null, activityDateRaw: d.activityDateRaw,
        activityType: d.activityType, particulars: d.particulars, offloaded: d.offloaded, bags: d.bags,
        quantityMt: d.quantityMt, ficheNo: d.ficheNo, lotNo: d.lotNo, vendor: d.vendor, rate: d.rate,
        total: d.total, referenceNo: d.referenceNo, remarks: d.remarks,
        grossWeightWithPalletKg: d.grossWeightWithPalletKg, palletCount: d.palletCount,
        grossWeightKg: d.grossWeightKg, grossWeightWithoutPalletKg: d.grossWeightWithoutPalletKg,
        netWeightKg: d.netWeightKg,
        sheetRow: r.sheetRow, source: `upload: ${filename}`,
      };
    }),
    skipDuplicates: true,
  });
  return result.count;
}
