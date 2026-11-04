/**
 * The production workbook — Production Phase 1 (Batch & Intake) as one .xlsx: download it (or the blank
 * sample), preview an upload, apply it. The same three steps, cache and answer shapes as Reception's workbook
 * (services/workbook.ts), so the same Upload / Export dialog serves both.
 *
 * Preview and Apply run the file the same way, in one transaction (domain/productionWorkbook/apply.ts): a
 * preview is rolled back, an Apply is committed — and refused whole when any row has a problem.
 */
import ExcelJS from "exceljs";
import type { Role } from "@anagroci/contract/data/roles";
import { prisma } from "../db.js";
import { ForbiddenError } from "../domain/validation.js";
import { cachePut, cacheTake } from "../domain/workbook/cache.js";
import { exportFilename, filterByDate, type DateRange } from "../domain/workbook/dateFilter.js";
import { readWorkbook } from "../domain/workbook/read.js";
import type { ParsedWorkbook } from "../domain/workbook/types.js";
import { addTableSheet, BLANK_ID_NOTE } from "../domain/workbook/write.js";
import { exportRows } from "../domain/productionWorkbook/exportRows.js";
import { runProductionWorkbook, type TabResult } from "../domain/productionWorkbook/apply.js";
import { TABS } from "../domain/productionWorkbook/tabs.js";
import { procurementBinStock } from "./production/batches.js";
import { ImportRejectedError, ImportTokenError } from "./imports.js";

export interface Uploader { id: string; role: Role }

const today = () => new Date().toISOString().slice(0, 10);
const ERRORS_SHOWN_PER_SHEET = 25;

export function productionWorkbookInfo(site: string) {
  return { warehouse: site, type: "CENTRAL" as const, sheets: TABS.map((t) => ({ name: t.title, master: false, dateLabel: t.dateLabel })) };
}

export async function downloadProductionWorkbook(site: string, range: DateRange, blank: boolean) {
  const data = blank ? null : await exportRows(site);
  const wb = new ExcelJS.Workbook();
  let exported = 0;
  let withoutDate = 0;
  for (const tab of TABS) {
    let rows = data?.[tab.id] ?? [];
    const f = filterByDate(rows, tab.dateKey, range);
    rows = f.rows;
    withoutDate += f.withoutDate;
    exported += rows.length;
    // Batches are named by the person, so only the tabs with a system ID say what a blank first column means.
    addTableSheet(wb, tab.title, tab.fields, rows, tab.key === "id" ? BLANK_ID_NOTE : undefined);
  }
  const base = "ANAGROCI - Production";
  return {
    buffer: await wb.xlsx.writeBuffer(),
    filename: blank ? `${base} - Sample.xlsx` : exportFilename(`${base} - Export`, range, today()),
    exported,
    withoutDate,
  };
}

/** Preview and Apply run the file the same way; a preview is undone by throwing this out of the transaction. */
class RolledBack extends Error {
  constructor(public result: { tabs: TabResult[]; notices: string[] }) { super("rolled back"); }
}

async function run(site: string, user: Uploader, parsed: ParsedWorkbook, commit: boolean) {
  // Read before the transaction, as the New batch screen reads it before saving.
  const stock = await procurementBinStock(site);
  try {
    return await prisma.$transaction(async (tx) => {
      const result = await runProductionWorkbook({ tx, site, actor: user, stock }, parsed);
      if (!commit) throw new RolledBack(result);
      if (result.tabs.some((t) => t.errors.length)) {
        throw new ImportRejectedError("The data changed since the preview and the upload no longer passes — nothing was written. Upload it again.", summarize(result));
      }
      return result;
    }, { timeout: 300_000, maxWait: 10_000 });
  } catch (e) {
    if (e instanceof RolledBack) return e.result;
    throw e;
  }
}

/** The answer Reception's workbook preview gives, so the same dialog shows it. */
function summarize({ tabs, notices }: { tabs: TabResult[]; notices: string[] }) {
  const sheets = tabs.map((t) => ({
    name: t.name, rows: t.rows, created: t.created, changed: t.changed, unchanged: t.unchanged,
    errorCount: t.errors.length, errors: t.errors.slice(0, ERRORS_SHOWN_PER_SHEET), samples: t.samples,
    warningCount: t.warnings.length, warnings: t.warnings.slice(0, ERRORS_SHOWN_PER_SHEET),
  }));
  return {
    sheets, notices,
    errorCount: sheets.reduce((n, s) => n + s.errorCount, 0),
    warningCount: sheets.reduce((n, s) => n + s.warningCount, 0),
    totalCreated: sheets.reduce((n, s) => n + s.created, 0),
    totalChanged: sheets.reduce((n, s) => n + s.changed, 0),
  };
}

export async function previewProductionWorkbook(user: Uploader, site: string, buffer: Buffer, filename: string) {
  const parsed = await readWorkbook(buffer);
  const result = await run(site, user, parsed, false);
  const token = cachePut({ userId: user.id, warehouse: site, filename, parsed, kind: "production" });
  return { token, filename, warehouse: site, type: "CENTRAL" as const, ...summarize(result) };
}

export async function commitProductionWorkbook(user: Uploader, token: string) {
  const taken = cacheTake(token);
  const entry = taken?.kind === "production" ? taken : undefined;
  if (!entry) throw new ImportTokenError("That preview has expired — upload the file again.");
  if (entry.userId !== user.id) throw new ForbiddenError("That preview belongs to another user.");
  const { tabs } = await run(entry.warehouse, user, entry.parsed, true);
  const applied = tabs.filter((t) => t.created || t.changed).map((t) => ({ name: t.name, created: t.created, updated: t.changed }));
  return { applied, totalCreated: applied.reduce((n, a) => n + a.created, 0), totalUpdated: applied.reduce((n, a) => n + a.updated, 0) };
}
