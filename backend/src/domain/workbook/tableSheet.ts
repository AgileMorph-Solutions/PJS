/**
 * Planning and applying one plain-table sheet (every sheet except Receipt).
 *
 * Planning is a diff against the database: a row whose cells all equal what's stored is
 * "unchanged" and writes nothing; only cells that differ become part of an update. That is what
 * makes exporting and re-uploading a file a no-op, and what keeps rows that already break a rule
 * from being re-judged by an upload that doesn't touch them. Checked before anything is written:
 * required columns, that the row belongs to this section's warehouse, that foreign keys and unique
 * sets hold.
 */
import { categoriseActivity } from "../../services/imports.js";
import { canonical, parseCell } from "./cells.js";
import { columnInfo, delegateOf, foreignKeys, uniqueSets } from "./schemaInfo.js";
import type { SheetSpec } from "./sheets.js";
import { SAMPLE_LIMIT, type Change, type Ctx, type ParsedSheet, type RowError, type SheetResult, type TableOp } from "./types.js";

/** `Model.column` -> the values the same upload is adding to that column (masters), so a row may
 * reference a warehouse / supplier / origin that arrives in the same file. */
export type FileKeys = Map<string, Set<string>>;

const chunk = <T>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
type Vals = Record<string, unknown>;

/** `label` turns an internal column key into the plain header the person sees, for messages. */
export async function planTable(ctx: Ctx, spec: SheetSpec, sheet: ParsedSheet, fileKeys: FileKeys, label: (key: string) => string): Promise<SheetResult> {
  const model = spec.model!;
  const delegate = (ctx.db as any)[delegateOf(model)];
  const info = columnInfo(model);
  const keyType = info.get(spec.key)!.type;
  const writable = sheet.headers.filter((h) => h !== spec.key && info.has(h) && !spec.readOnly.includes(h));
  const result: SheetResult = { name: sheet.name, rows: sheet.rows.length, created: 0, changed: 0, unchanged: 0, errors: [], samples: [], ops: [] };

  // ── 1. parse every row ────────────────────────────────────────────────────────────────────────
  interface Parsed { row: number; key: string | null; vals: Vals; errs: RowError[] }
  const parsed: Parsed[] = sheet.rows.map(({ rowNumber, cells }) => {
    const errs: RowError[] = [];
    const k = parseCell(cells[spec.key], keyType);
    if (!k.ok) errs.push({ row: rowNumber, column: spec.key, message: k.error });
    const key = k.ok && k.value !== null ? canonical(k.value) : null;
    const vals: Vals = {};
    for (const h of writable) {
      const p = parseCell(cells[h], info.get(h)!.type);
      if (p.ok) vals[h] = p.value;
      else errs.push({ row: rowNumber, column: h, message: p.error });
    }
    return { row: rowNumber, key, vals, errs };
  });

  // ── 2. load what already exists for the keys given ────────────────────────────────────────────
  const keys = [...new Set(parsed.map((p) => p.key).filter((k): k is string => k !== null))];
  const existing = new Map<string, Vals>();
  for (const c of chunk(keys, 1000)) {
    for (const row of await delegate.findMany({ where: { [spec.key]: { in: c } } })) existing.set(canonical(row[spec.key]), row);
  }

  // "No" is the sheet's own running number; nobody should have to invent the next one.
  let lastSn: number | undefined;
  const nextSn = async () => {
    lastSn ??= (await delegate.aggregate({ _max: { sn: true } }))._max.sn ?? 0;
    return ++lastSn!;
  };

  // ── 3. decide each row ────────────────────────────────────────────────────────────────────────
  interface Planned { p: Parsed; op: TableOp; merged: Vals; changes: Change[] }
  const planned: Planned[] = [];
  const seen = new Set<string>();

  for (const p of parsed) {
    const err = (message: string, column?: string) => p.errs.push({ row: p.row, column, message });
    if (p.key !== null) {
      if (seen.has(p.key)) err(`${label(spec.key)} "${p.key}" appears more than once in this sheet`, spec.key);
      seen.add(p.key);
    }
    const current = p.key !== null ? existing.get(p.key) : undefined;
    if (p.key === null && spec.master) err(`${label(spec.key)} is required`, spec.key);
    if (p.key !== null && !current && !spec.master) err(`unknown ${label(spec.key)} "${p.key}" — leave it blank to add a new row`, spec.key);

    let data: Vals = {};
    const changes: Change[] = [];
    if (current) {
      for (const h of writable) {
        if (!(h in p.vals) || canonical(current[h]) === canonical(p.vals[h])) continue;
        if (p.vals[h] === null && info.get(h)!.required && !info.get(h)!.hasDefault) { err(`can't be blank`, h); continue; }
        data[h] = p.vals[h];
        changes.push({ column: h, from: canonical(current[h]), to: canonical(p.vals[h]) });
      }
      if (model === "JuteWarehouseMovement" && "activitiesType" in data) data.activityCategory = categoriseActivity(String(data.activitiesType ?? ""));
    } else {
      for (const h of writable) if (p.vals[h] !== null && p.vals[h] !== undefined) { data[h] = p.vals[h]; changes.push({ column: h, from: "", to: canonical(p.vals[h]) }); }
      // A master row IS its key (a new Origin is just a name), so the key alone makes it a new row.
      if (spec.master && p.key !== null) { data[spec.key] = p.key; changes.unshift({ column: spec.key, from: "", to: p.key }); }
      // Hidden from the file, so filled in for the person: this section's warehouse, the next number.
      for (const col of spec.defaultToSection(ctx.type)) if (data[col] === undefined || data[col] === null) data[col] = ctx.warehouse;
      if (info.get("sn")?.required && (data.sn === undefined || data.sn === null)) data.sn = await nextSn();
      for (const [col, c] of info) {
        if (c.required && !c.hasDefault && !c.isId && !spec.readOnly.includes(col) && col !== spec.key && (data[col] === undefined || data[col] === null)) err(`is required`, col);
      }
      if (info.has("source")) data.source = `workbook: ${ctx.filename}`;
      if (model === "JuteWarehouseMovement") data.activityCategory = categoriseActivity(String(data.activitiesType ?? ""));
    }

    const merged: Vals = { ...(current ?? {}), ...data };

    // Belongs to this section's warehouse — before AND after the change, so a row can't be pulled in
    // from, or pushed out to, another warehouse.
    if (spec.siteColumns.length) {
      const inSite = (v: Vals) => spec.siteColumns.some((c) => typeof v[c] === "string" && ctx.site.includes(v[c] as string));
      if (current && !inSite(current)) err(`belongs to another warehouse`);
      else if (!inSite(merged)) err(`must be in ${ctx.warehouse}`);
    }

    if (p.errs.length) { result.errors.push(...p.errs); continue; }
    if (current && !changes.length) { result.unchanged++; continue; }
    if (!current && !changes.length) { result.unchanged++; continue; } // a fully blank row
    planned.push({ p, op: { kind: current ? "update" : "create", row: p.row, key: p.key ?? undefined, data }, merged, changes });
  }

  // ── 4. foreign keys: new values must exist in the database or arrive in this same file ─────────
  for (const fk of foreignKeys(model)) {
    const touched = planned.filter((x) => x.op.data[fk.column] !== undefined && x.op.data[fk.column] !== null);
    if (!touched.length) continue;
    const values = [...new Set(touched.map((x) => String(x.op.data[fk.column])))];
    const found = new Set<string>(fileKeys.get(`${fk.targetModel}.${fk.targetColumn}`) ?? []);
    for (const c of chunk(values, 1000)) {
      const rows = await (ctx.db as any)[delegateOf(fk.targetModel)].findMany({ where: { [fk.targetColumn]: { in: c } }, select: { [fk.targetColumn]: true } });
      for (const r of rows) found.add(String(r[fk.targetColumn]));
    }
    for (const x of touched) {
      if (!found.has(String(x.op.data[fk.column]))) {
        result.errors.push({ row: x.p.row, column: fk.column, message: `"${String(x.op.data[fk.column])}" isn't a known ${label(fk.column)}` });
        x.p.errs.push(result.errors[result.errors.length - 1]);
      }
    }
  }

  // ── 5. unique sets: within the file, and against rows already stored ──────────────────────────
  for (const set of uniqueSets(model).filter((s) => !s.every((c) => spec.readOnly.includes(c)))) {
    const tuples = new Map<string, Planned>();
    const toCheck: { x: Planned; tuple: Vals }[] = [];
    for (const x of planned) {
      if (x.p.errs.length || !set.some((c) => c in x.op.data)) continue;
      const vals = set.map((c) => x.merged[c]);
      if (vals.some((v) => v === null || v === undefined || v === "")) continue;
      const k = vals.map(canonical).join("\u0000");
      const dup = tuples.get(k);
      if (dup) {
        result.errors.push({ row: x.p.row, message: `${set.map(label).join(" + ")} "${vals.map(canonical).join(" / ")}" is also used by row ${dup.p.row}` });
        x.p.errs.push(result.errors[result.errors.length - 1]);
        continue;
      }
      tuples.set(k, x);
      toCheck.push({ x, tuple: Object.fromEntries(set.map((c, i) => [c, vals[i]])) });
    }
    for (const c of chunk(toCheck, 300)) {
      const hits = await delegate.findMany({ where: { OR: c.map((t) => t.tuple) }, select: { [spec.key]: true, ...Object.fromEntries(set.map((s) => [s, true])) } });
      for (const hit of hits) {
        const owner = c.find((t) => set.every((col) => canonical(t.tuple[col]) === canonical(hit[col])));
        if (owner && canonical(hit[spec.key]) !== (owner.x.op.key ?? "")) {
          result.errors.push({ row: owner.x.p.row, message: `${set.map(label).join(" + ")} "${set.map((col) => canonical(hit[col])).join(" / ")}" already exists on another row` });
          owner.x.p.errs.push(result.errors[result.errors.length - 1]);
        }
      }
    }
  }

  // ── 6. tally ──────────────────────────────────────────────────────────────────────────────────
  const ok = planned.filter((x) => !x.p.errs.length);
  result.ops = ok.map((x) => x.op);
  for (const x of ok) {
    if (x.op.kind === "create") result.created++; else result.changed++;
    if (result.samples.length < SAMPLE_LIMIT) result.samples.push({ row: x.p.row, key: x.p.key ?? "(new)", changes: x.changes.slice(0, 6) });
  }
  return result;
}

export async function applyTable(ctx: Ctx, spec: SheetSpec, ops: TableOp[]): Promise<void> {
  const delegate = (ctx.db as any)[delegateOf(spec.model!)];
  const creates = ops.filter((o) => o.kind === "create");
  if (spec.assignsSeq && creates.length) {
    // seq orders a ledger's rows and is unique; it's the server's, never read from the file.
    let max = (await delegate.aggregate({ _max: { seq: true } }))._max.seq ?? 0;
    for (const o of creates) o.data.seq = ++max;
  }
  const prepare = spec.prepare ?? ((d: Record<string, unknown>) => d);
  for (const c of chunk(creates, 200)) await delegate.createMany({ data: c.map((o) => prepare(o.data)) });
  for (const o of ops.filter((x) => x.kind === "update")) await delegate.update({ where: { [spec.key]: o.key }, data: prepare(o.data) });
}
