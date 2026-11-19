/**
 * The production workbook — Production Phases 1 to 5 as one .xlsx: download it (or the blank
 * sample), preview an upload, apply it. The same three steps, cache and answer shapes as Reception's workbook
 * (services/workbook.ts), so the same Upload / Export dialog serves both.
 *
 * Preview and Apply run the file the same way, in one transaction (domain/productionWorkbook/apply.ts): a
 * preview is rolled back, an Apply is committed — and refused whole when any row has a problem.
 */
import ExcelJS from "exceljs";
import { canSeeFactory, type Role } from "@anagroci/contract/data/roles";
import { prisma } from "../db.js";
import { ForbiddenError } from "../domain/validation.js";
import { cachePut, cacheTake } from "../domain/workbook/cache.js";
import { exportFilename, filterByDate, type DateRange } from "../domain/workbook/dateFilter.js";
import { readWorkbook } from "../domain/workbook/read.js";
import type { ParsedWorkbook } from "../domain/workbook/types.js";
import { addTableSheet, BLANK_ID_NOTE } from "../domain/workbook/write.js";
import { exportRows, monthWord, weekNum, type TabRow } from "../domain/productionWorkbook/exportRows.js";
import { runProductionWorkbook, type TabResult } from "../domain/productionWorkbook/apply.js";
import { INTAKE_TABS, TABS, type Tab } from "../domain/productionWorkbook/tabs.js";
import { procurementBinStock } from "./production/batches.js";
import { ImportRejectedError, ImportTokenError } from "./imports.js";

export interface Uploader { id: string; role: Role }

const today = () => new Date().toISOString().slice(0, 10);
const ERRORS_SHOWN_PER_SHEET = 25;

/**
 * The tabs this person may see: the warehouse team its three intake tabs, the production team every one (18 Nov 2026: the
 * warehouse doesn't see production past its loads). Omitted, every tab.
 */
export const tabsFor = (role?: Role): Tab[] => (role === undefined || canSeeFactory(role) ? TABS : TABS.filter((t) => INTAKE_TABS.includes(t.id)));

export function productionWorkbookInfo(site: string, role?: Role) {
  return { warehouse: site, type: "CENTRAL" as const, sheets: tabsFor(role).map((t) => ({ name: t.title, master: false, dateLabel: t.dateLabel })) };
}

const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/**
 * The formula columns most of the client's sheets start with, as their formulas give them: SL.NO counts the rows,
 * Week is =WEEKNUM(date), Month =TEXT(date,"mmm-yy"), Year the date's. Filled only where the row doesn't say already.
 */
function withSheetFormulas(tab: Tab, rows: TabRow[]): TabRow[] {
  const keys = new Set(tab.fields.filter((f) => f.derived).map((f) => f.key));
  return rows.map((row, i) => {
    const date = iso(row[tab.dateKey]) ?? iso(row.date);
    const out: TabRow = { ...row };
    if (keys.has("slNo") && out.slNo === undefined) out.slNo = i + 1;
    if (date && keys.has("week") && out.week === undefined) out.week = weekNum(date);
    if (date && keys.has("month") && out.month === undefined) out.month = monthWord(date);
    if (date && keys.has("year") && out.year === undefined) out.year = Number(date.slice(0, 4));
    return out;
  });
}

/**
 * One tab per step of the floor, in its order and coloured by its stage (tabs.ts STAGES), and nothing else: no Read me,
 * no marking of which columns or tabs are the app's own (team decision, Nov 2026 — the floor has no time to read, and
 * "New" tags only cluttered the file). Column help stays a hover note on the header.
 */
export async function downloadProductionWorkbook(site: string, range: DateRange, blank: boolean, role?: Role) {
  const data = blank ? null : await exportRows(site);
  const wb = new ExcelJS.Workbook();
  let exported = 0;
  let withoutDate = 0;
  for (const tab of tabsFor(role)) {
    let rows = data?.[tab.id] ?? [];
    const f = filterByDate(rows, tab.dateKey, range);
    rows = withSheetFormulas(tab, f.rows);
    withoutDate += f.withoutDate;
    exported += rows.length;
    // A system ID column says what a blank one means, wherever it sits. isNew stays the tabs' own business: unmarked here.
    const fields = tab.fields.map(({ isNew: _app, ...x }) => (x.key === "id" && tab.key === "id" ? { ...x, note: [BLANK_ID_NOTE, x.note].filter(Boolean).join(" ") } : x));
    const ws = addTableSheet(wb, tab.title, fields, rows);
    if (tab.color) ws.properties.tabColor = { argb: tab.color };
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

/** What an applied upload added and changed, per tab: the commit's answer and its log row. */
const appliedOf = (tabs: TabResult[]) =>
  tabs.filter((t) => t.created || t.changed).map((t) => ({ name: t.name, created: t.created, updated: t.changed }));

/** commit: the file name to log the upload under; omitted, the run is a preview and is rolled back. */
async function run(site: string, user: Uploader, parsed: ParsedWorkbook, commit?: { filename: string }) {
  // Read before the transaction, as the New run screen reads it before saving: the file may start a run.
  const stock = await procurementBinStock(site);
  try {
    return await prisma.$transaction(async (tx) => {
      const result = await runProductionWorkbook({ tx, site, actor: user, stock }, parsed);
      if (!commit) throw new RolledBack(result);
      if (result.tabs.some((t) => t.errors.length)) {
        throw new ImportRejectedError("The data changed since the preview and the upload no longer passes — nothing was written. Upload it again.", summarize(result));
      }
      // Who uploaded what, in the same transaction as the rows it wrote: a refused upload leaves no log.
      const applied = appliedOf(result.tabs);
      await tx.productionWorkbookUpload.create({
        data: {
          warehouse: site, filename: commit.filename, uploadedById: user.id, tabs: applied,
          created: applied.reduce((n, a) => n + a.created, 0), updated: applied.reduce((n, a) => n + a.updated, 0),
        },
      });
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
  const result = await run(site, user, parsed);
  const token = cachePut({ userId: user.id, warehouse: site, filename, parsed, kind: "production" });
  return { token, filename, warehouse: site, type: "CENTRAL" as const, ...summarize(result) };
}

export async function commitProductionWorkbook(user: Uploader, token: string) {
  const taken = cacheTake(token);
  const entry = taken?.kind === "production" ? taken : undefined;
  if (!entry) throw new ImportTokenError("That preview has expired — upload the file again.");
  if (entry.userId !== user.id) throw new ForbiddenError("That preview belongs to another user.");
  const { tabs } = await run(entry.warehouse, user, entry.parsed, { filename: entry.filename });
  const applied = appliedOf(tabs);
  return { applied, totalCreated: applied.reduce((n, a) => n + a.created, 0), totalUpdated: applied.reduce((n, a) => n + a.updated, 0) };
}

/** The site's applied uploads, newest first: who, when, which file, and what it added and changed. */
export async function listProductionWorkbookUploads(site: string) {
  const rows = await prisma.productionWorkbookUpload.findMany({
    where: { warehouse: site },
    orderBy: { uploadedAt: "desc" },
    take: 200,
    include: { uploadedBy: { select: { displayName: true, role: true } } },
  });
  return rows.map((r) => ({
    id: r.id, filename: r.filename, uploadedAt: r.uploadedAt.toISOString(),
    uploadedBy: r.uploadedBy.displayName, uploadedByRole: r.uploadedBy.role,
    created: r.created, updated: r.updated, tabs: r.tabs as { name: string; created: number; updated: number }[],
  }));
}
