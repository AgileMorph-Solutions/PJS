/**
 * Shared types for the excel-upload import path. See docs/UPLOAD_GUIDE.md for the plain-language
 * version of everything below — this file is the types those concepts are implemented as.
 *
 * Reuses the same `Finding` shape `domain/dataQuality/types.ts` already established, rather than
 * inventing a parallel report format — an import preview's findings and the data-quality audit's
 * findings look identical on the wire, on purpose.
 */
import type { Finding } from "../dataQuality/types.js";

export type ImporterId = "receipts" | "dryingJobs" | "juteWarehouseStock" | "juteWarehouseTransfer";

/** The outcome of checking an uploaded workbook against one importer's expected shape. */
export type HeaderCheckResult =
  | { ok: true }
  | { ok: false; reason: "missing-sheet"; expectedSheet: string; foundSheets: string[] }
  | { ok: false; reason: "header-mismatch"; expectedSheet: string; headerRow: number; expected: string[]; found: string[] };

/** One row this importer parsed, plus whatever it decided about it before any DB check. */
export interface ParsedRow<T> {
  /** 1-based row number in the source sheet, for findings/sampleIds and operator sanity-checking. */
  sheetRow: number;
  data: T;
  /** Set by the parser when a row is skipped outright (not written even if "import anyway" is on) —
   * e.g. a completely blank row, or a row failing the importer's own required-field check. Distinct
   * from a dedup match, which IS writable if the operator chooses to. */
  skipReason?: string;
}

/** A parsed row flagged as a likely duplicate of something already in the database. Still writable
 * if the operator turns off "skip likely duplicates" at commit time — flagged, never silently
 * dropped, matching this app's data-quality convention. */
export interface DuplicateFlag {
  sheetRow: number;
  matchedAgainst: string;
  reason: string;
}

export interface PreviewResult<T> {
  importerId: ImporterId;
  rows: ParsedRow<T>[];
  duplicates: DuplicateFlag[];
  findings: Finding[];
}

/** One entry in the importer registry — the single place all 4 known shapes are declared. */
export interface ImporterDef<T = unknown> {
  id: ImporterId;
  label: string;
  /** The client-facing filename this shape is normally seen in, for the UI's "what does this look
   * like" hint — not used for matching (sheet/header content is, since filenames vary). */
  exampleFilename: string;
  expectedSheet: string;
  headerRow: number;
  /** Exact, order-sensitive, trimmed label list expected at `headerRow` — the guard against the
   * same-name-different-shape corruption case documented in docs/UPLOAD_GUIDE.md. */
  expectedHeader: string[];
  /** Only the leading columns actually required to be present are checked (a header row can have
   * real trailing blank-formatted columns) — this is how many of `expectedHeader`'s entries must
   * match, left-to-right, from column A. */
  checkHeaderPrefix: number;
  /** Parses every data row into typed records. Never throws on a single bad row — records a
   * `skipReason` on that row instead, so one malformed row doesn't fail an entire upload. Only
   * called after the registry's shared `verifyHeader()` (headerCheck.ts) has already confirmed
   * this importer's shape matches — a parser never has to defend against a shape mismatch itself. */
  parse(workbook: import("exceljs").Workbook): ParsedRow<T>[];
}
