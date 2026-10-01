/**
 * The ANAGROCI workbook's three operations — download (or a blank template), preview an upload,
 * commit it. The format and rules are in domain/workbook/; this wires them to a section (one
 * warehouse, Unit or Central) and a user.
 */
import type { WarehouseType } from "@anagroci/contract/data/warehouseTypes";
import { prisma } from "../db.js";
import { resolveSite } from "../domain/site.js";
import { ForbiddenError, ValidationError } from "../domain/validation.js";
import { cachePut, cacheTake } from "../domain/workbook/cache.js";
import type { DateRange } from "../domain/workbook/dateFilter.js";
import { applyWorkbook, errorCount, planWorkbook } from "../domain/workbook/plan.js";
import { readWorkbook } from "../domain/workbook/read.js";
import type { Ctx, RowError, WorkbookPlan } from "../domain/workbook/types.js";
import { buildWorkbookFile } from "../domain/workbook/write.js";
import { ImportRejectedError, ImportTokenError } from "./imports.js";

export interface Section { warehouse: string; type: WarehouseType; site: string[] }
export interface Uploader { id: string; role: string }

const today = () => new Date().toISOString().slice(0, 10);

/** A section is one warehouse SITE that has a Unit/Central type — the type decides which sheets the
 * workbook carries, so a warehouse without one can't have a workbook until an admin sets it. */
export async function sectionFor(warehouse: string): Promise<Section> {
  const wh = await prisma.warehouse.findUnique({ where: { name: warehouse } });
  if (!wh || wh.site !== null) throw new ValidationError(`"${warehouse}" isn't a warehouse site.`);
  if (wh.type !== "UNIT" && wh.type !== "CENTRAL") {
    throw new ValidationError(`"${warehouse}" has no Unit/Central type yet — an admin sets it under Masters › Warehouses.`);
  }
  return { warehouse, type: wh.type, site: await resolveSite(warehouse) };
}

export async function downloadWorkbook(section: Section, range: DateRange, blank: boolean) {
  return buildWorkbookFile({ type: section.type, warehouse: section.warehouse, site: section.site, range, blank, today: today() });
}

const ctxFor = (db: Ctx["db"], section: Section, user: Uploader, filename: string): Ctx => ({
  db, userId: user.id, isAdmin: user.role === "admin", warehouse: section.warehouse, type: section.type, site: section.site, filename, today: today(),
});

const ERRORS_SHOWN_PER_SHEET = 25;

/** The plan as the UI shows it: counts, a few sample changes, and the first errors per sheet. */
export function summarize(plan: WorkbookPlan) {
  const sheets = plan.sheets.map((s) => ({
    name: s.name, rows: s.rows, created: s.created, changed: s.changed, unchanged: s.unchanged,
    errorCount: s.errors.length, errors: s.errors.slice(0, ERRORS_SHOWN_PER_SHEET) as RowError[], samples: s.samples,
  }));
  return {
    sheets, notices: plan.notices, errorCount: errorCount(plan),
    totalCreated: sheets.reduce((n, s) => n + s.created, 0),
    totalChanged: sheets.reduce((n, s) => n + s.changed, 0),
  };
}

export async function previewWorkbook(user: Uploader, section: Section, buffer: Buffer, filename: string) {
  const parsed = await readWorkbook(buffer);
  const plan = await planWorkbook(ctxFor(prisma, section, user, filename), parsed);
  const token = cachePut({ userId: user.id, warehouse: section.warehouse, filename, parsed });
  return { token, filename, warehouse: section.warehouse, type: section.type, ...summarize(plan) };
}

export async function commitWorkbook(user: Uploader, token: string) {
  const entry = cacheTake(token);
  if (!entry) throw new ImportTokenError("That preview has expired — upload the file again.");
  if (entry.userId !== user.id) throw new ForbiddenError("That preview belongs to another user.");
  const section = await sectionFor(entry.warehouse);

  // Re-planned inside the transaction: the database may have moved since the preview, and the
  // commit must be judged against what is there NOW. Anything wrong aborts the lot.
  return prisma.$transaction(async (tx) => {
    const ctx = ctxFor(tx, section, user, entry.filename);
    const plan = await planWorkbook(ctx, entry.parsed);
    if (errorCount(plan)) {
      throw new ImportRejectedError("The data changed since the preview and the upload no longer passes — nothing was written. Upload it again.", summarize(plan));
    }
    const applied = await applyWorkbook(ctx, plan);
    return { applied, totalCreated: applied.reduce((n, a) => n + a.created, 0), totalUpdated: applied.reduce((n, a) => n + a.updated, 0) };
  }, { timeout: 300_000, maxWait: 10_000 });
}
