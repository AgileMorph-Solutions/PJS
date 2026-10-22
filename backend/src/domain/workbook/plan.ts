/**
 * Turns an uploaded workbook into a plan (what would be created / changed / left alone, and what is
 * wrong), and applies a plan. Planning never writes; applying is called inside ONE transaction by
 * the service, so an upload is all-or-nothing.
 *
 * Sheets and columns arrive under their plain titles/labels (fields.ts). They are translated to the
 * internal keys here, once, so the sheet planners (receiptSheet.ts, tableSheet.ts) only ever deal
 * in keys — and everything that goes back to the person is translated to labels on the way out.
 */
import { applyReceipt, planReceipts } from "./receiptSheet.js";
import { hiddenKeys, normalizeHeader } from "./fields.js";
import { canonical, parseCell, serializeCell } from "./cells.js";
import { SHEETS, sheetByTitle, sheetsFor, type SheetSpec } from "./sheets.js";
import { applyTable, planTable, type FileKeys } from "./tableSheet.js";
import { sectionLabel } from "./write.js";
import type { Ctx, ParsedSheet, ParsedWorkbook, ReceiptOp, SheetResult, TableOp, WorkbookPlan } from "./types.js";

export const errorCount = (plan: WorkbookPlan) => plan.sheets.reduce((n, s) => n + s.errors.length, 0);

/** key -> plain label for one sheet in one section. */
/** A sheet's columns as this uploader may see them: the ones hidden from their role are not there at all. */
const visible = (spec: SheetSpec, ctx: Pick<Ctx, "type" | "role">) => {
  const hidden = hiddenKeys(ctx.role);
  return spec.fields(ctx.type).filter((f) => !hidden.has(f.key));
};

function labelsFor(spec: SheetSpec, ctx: Pick<Ctx, "type" | "role">) {
  const byKey = new Map(visible(spec, ctx).map((f) => [f.key, f.label]));
  return (key: string) => byKey.get(key) ?? key;
}

/** Re-key an uploaded sheet from plain headers to internal keys. Headers we don't use are dropped
 * (and said so). A column the sheet lacks is simply absent — and so left alone by the planner. */
function translate(spec: SheetSpec, sheet: ParsedSheet, ctx: Pick<Ctx, "type" | "role">, notices: string[]): ParsedSheet {
  // A column renamed since an older export (GRN Weight → GRN Quantity) still reads under its old header.
  const byHeader = new Map(visible(spec, ctx).flatMap((f) => [f.label, ...(f.aka ?? [])].map((h) => [normalizeHeader(h), f.key] as const)));
  const keyOf = new Map<string, string>();
  const unknown: string[] = [];
  for (const h of sheet.headers) {
    const key = byHeader.get(normalizeHeader(h));
    if (key) keyOf.set(h, key); else unknown.push(h);
  }
  if (unknown.length) {
    notices.push(`${spec.title}: ${unknown.map((u) => `"${u}"`).join(", ")} ${unknown.length > 1 ? "aren't columns we use" : "isn't a column we use"} — ignored.`);
  }
  return {
    name: sheet.name,
    headers: [...keyOf.values()],
    rows: sheet.rows.map((r) => ({
      rowNumber: r.rowNumber,
      cells: Object.fromEntries([...keyOf].map(([h, key]) => [key, r.cells[h]])),
    })),
  };
}

/**
 * A sheet that is for reading: nothing is planned or written. If the file carries it back changed, say so —
 * silently dropping someone's edit would look like it had worked.
 */
async function compareExportOnly(ctx: Ctx, spec: SheetSpec, sheet: ParsedSheet, notices: string[]): Promise<SheetResult> {
  const current = new Map((await spec.rows(ctx.site)).map((r) => [canonical(r[spec.key]), r]));
  const fields = visible(spec, ctx);
  const plain = (v: unknown) => { const p = parseCell(v, "String"); return p.ok ? canonical(p.value) : String(v); };
  let differing = 0;
  for (const r of sheet.rows) {
    const row = current.get(plain(r.cells[spec.key]));
    // A column the file doesn't carry isn't a difference; a cell it carries that disagrees is.
    if (!row || fields.some((f) => f.key in r.cells && plain(r.cells[f.key]) !== canonical(serializeCell(row[f.key])))) differing++;
  }
  if (differing) {
    notices.push(`${spec.title}: ${differing} row${differing > 1 ? "s differ" : " differs"} from what the app holds, but this sheet is for reading - nothing was changed. Make the change in the app.`);
  }
  return { name: spec.title, rows: sheet.rows.length, created: 0, changed: 0, unchanged: sheet.rows.length - differing, errors: [], samples: [], ops: [] };
}

export async function planWorkbook(ctx: Ctx, wb: ParsedWorkbook): Promise<WorkbookPlan> {
  const notices = [...wb.notices];
  const inSection = sheetsFor(ctx.type);
  const given = new Map<SheetSpec, ParsedSheet>();

  for (const sheet of wb.sheets.values()) {
    const spec = sheetByTitle(sheet.name);
    if (!spec) notices.push(`Sheet "${sheet.name}" isn't one of our sheets — ignored.`);
    else if (!inSection.includes(spec)) notices.push(`Sheet "${sheet.name}" isn't part of the ${sectionLabel(ctx.type)} workbook — ignored.`);
    else given.set(spec, translate(spec, sheet, ctx, notices));
  }
  if (!wb.sheets.size) notices.push("The file has no data sheets.");

  // Masters that arrive in this file, so a row may reference a supplier that is added by the same upload.
  const fileKeys: FileKeys = new Map();
  for (const [spec, sheet] of given) {
    if (!spec.master) continue;
    const set = new Set<string>();
    for (const r of sheet.rows) {
      const v = r.cells[spec.key];
      if (typeof v === "string" && v !== "") set.add(v);
    }
    fileKeys.set(`${spec.model}.${spec.key}`, set);
  }

  const sheets: SheetResult[] = [];
  for (const spec of inSection) {
    const sheet = given.get(spec);
    if (!sheet) continue;
    const label = labelsFor(spec, ctx);

    let planned: SheetResult;
    if (spec.exportOnly) {
      planned = await compareExportOnly(ctx, spec, sheet, notices);
    } else if (!sheet.headers.includes(spec.key)) {
      // Without the id column every row would look new — refuse rather than guess.
      planned = { name: spec.title, rows: sheet.rows.length, created: 0, changed: 0, unchanged: 0, samples: [], ops: [],
        errors: [{ row: 1, column: spec.idLabel, message: `the "${spec.idLabel}" column is missing` }] };
    } else {
      planned = spec.kind === "receipt" ? await planReceipts(ctx, sheet, fileKeys) : await planTable(ctx, spec, sheet, fileKeys, label);
      planned.name = spec.title;
      // Back to the words the person uses.
      planned.errors = planned.errors.map((e) => ({ ...e, column: e.column ? label(e.column) : undefined }));
      planned.samples = planned.samples.map((s) => ({ ...s, changes: s.changes.map((c) => ({ ...c, column: label(c.column) })) }));
    }
    sheets.push(planned);
  }
  return { sheets, notices };
}

export interface ApplyResult { name: string; created: number; updated: number }

/** Suppliers first (a row may point at a new one), then receipts, then everything else. */
const rank = (spec: SheetSpec) => (spec.master ? 0 : spec.kind === "receipt" ? 10 : 20 + SHEETS.indexOf(spec));

export async function applyWorkbook(ctx: Ctx, plan: WorkbookPlan): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];
  const todo = plan.sheets.map((sheet) => ({ sheet, spec: sheetByTitle(sheet.name)! })).sort((a, b) => rank(a.spec) - rank(b.spec));
  for (const { sheet, spec } of todo) {
    if (!sheet.ops.length) continue;
    if (spec.kind === "receipt") for (const op of sheet.ops as ReceiptOp[]) await applyReceipt(ctx, op, spec.title);
    else await applyTable(ctx, spec, sheet.ops as TableOp[]);
    results.push({ name: spec.title, created: sheet.created, updated: sheet.changed });
  }
  return results;
}
