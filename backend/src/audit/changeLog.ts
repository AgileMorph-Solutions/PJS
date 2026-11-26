/**
 * The change log: every saved change to any record outside a truck's steps, written to ChangeLog by a Prisma query hook
 * (db.ts), so every service, route and upload is covered without calling anything — and a new table is covered the day it
 * is added. Only saves are logged: forms send one request per save, never one per keystroke, so the log adds no request
 * from the browser, just one read of the old values on the server inside the save.
 *
 * What a row says, by action:
 *   update — one row per field whose value changed: old → new.
 *   create — typed in the app: one row per value entered (old = empty). From an upload: one row for the record, since an
 *            upload's file is itself the record of what it held, and a row per cell would bury everything else.
 *   delete — one row for the record.
 * Bulk writes (createMany, and updateMany / deleteMany over many rows) log one summary row instead of one per record.
 *
 * Not logged here: a truck's step tables (StageFieldChange already logs them, by their workbook labels), the logs
 * themselves, sign-in sessions, and fields that record nothing a person chose (timestamps, *Num shadow columns).
 */
import { Prisma } from "@prisma/client";
import { STAGE_FIELD_MAP } from "@anagroci/contract/generated/stageFieldMap";
import { currentAudit } from "./context.js";

type Model = (typeof Prisma.dmmf.datamodel.models)[number];
type Row = Record<string, unknown>;
// The query hook hands us a client per call (the open transaction's, or the base one): model delegates by name.
type Client = Record<string, any>;

const MODELS = new Map<string, Model>(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));

const NOT_LOGGED = new Set([
  ...Object.values(STAGE_FIELD_MAP).map((s) => s.model),
  "StageEntry", "StageFieldChange", "TimelineEntry", "ChangeLog", "Session", "UploadIssue", "ProductionWorkbookUpload", "FormSubmission",
]);

/** Fields whose value is a secret: the log says they changed, never what to. */
const SECRET = new Set(["passwordHash", "token", "tokenHash"]);
const MASKED = "(changed)";

/** Above this many records, a bulk update or delete logs one summary row rather than one per record. */
const BULK_LIMIT = 50;

const WRITES = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "upsert", "delete", "deleteMany"]);

export const isLogged = (model: string | undefined, operation: string): model is string =>
  Boolean(model) && WRITES.has(operation) && !NOT_LOGGED.has(model!) && MODELS.has(model!);

const delegate = (client: Client, model: string) => client[model[0]!.toLowerCase() + model.slice(1)];

// A stored file's bytes (FicheDocument.data) aren't a value anyone reads in a log, and would be megabytes of text in it:
// they are neither read for the old values nor logged. The file's name and size, logged beside them, say it changed.
const scalars = (m: Model) => m.fields.filter((f) => (f.kind === "scalar" && f.type !== "Bytes") || f.kind === "enum");
const keyOf = (m: Model): string[] => m.primaryKey?.fields?.length ? [...m.primaryKey.fields] : m.fields.filter((f) => f.isId).map((f) => f.name);
/** The scalar columns that point at a parent record (transferId, receiptId…). */
const foreignKeys = (m: Model): string[] => m.fields.flatMap((f) => (f.kind === "object" ? [...(f.relationFromFields ?? [])] : []));

/** Columns that record nothing a person chose: row timestamps, and the typed *Num shadow of a text column. */
function isNoise(m: Model, field: string): boolean {
  const f = m.fields.find((x) => x.name === field);
  if (!f || f.isUpdatedAt || field === "createdAt") return true;
  return field.endsWith("Num") && m.fields.some((x) => x.name === field.slice(0, -3));
}

/** Every value as the text the log stores; null for none. */
export function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && v !== null && "toFixed" in v) return String(v); // Prisma.Decimal
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const selectAll = (m: Model) => Object.fromEntries(scalars(m).map((f) => [f.name, true]));

/**
 * How a person finds the record. Its own key when that means something (BKT-2026-017, PR-YAK-2026-004); for a row keyed
 * by a bare counter (a BKT's Lot line), the parents it belongs to, with the counter only when those don't pin it down.
 */
/** A row keyed by a bare counter (a BKT's Lot line): it is named by its parents instead (recordIdOf). */
const isCounterKeyed = (m: Model) => { const key = keyOf(m); return key.length === 1 && m.fields.find((f) => f.name === key[0])?.type === "Int"; };

export function recordIdOf(m: Model, r: Row): string {
  const key = keyOf(m);
  const counter = isCounterKeyed(m);
  const fks = foreignKeys(m).filter((f) => r[f] !== null && r[f] !== undefined);
  if (!counter || !fks.length) return key.map((k) => asText(r[k]) ?? "").join(" · ");
  const unique = (m.uniqueFields ?? []).some((u) => u.length === fks.length && u.every((f) => fks.includes(f)));
  return [...fks.map((f) => asText(r[f])!), ...(unique ? [] : [`#${asText(r[key[0]!])}`])].join(" · ");
}

const WAREHOUSE_FIELDS = ["warehouse", "warehouseName", "fromWarehouse", "toWarehouse", "toStore", "destinationWarehouse", "destinationStore"];

/**
 * The warehouses a record belongs to, for who may read its log rows: its own warehouse columns, or else its parents'
 * (a BKT's Lot line → the BKT's two ends; a pallet → its RCN receipt → its batch's factory). Users and supplier access are
 * an admin's business, so they belong to none and only an admin sees them.
 */
async function warehousesOf(client: Client, m: Model, r: Row, depth = 0): Promise<string[]> {
  if (["User", "BranchManagerSupplier", "SupplierRequest", "Supplier"].includes(m.name)) return [];
  if (m.name === "Warehouse") return [r.name, r.site].filter((x): x is string => typeof x === "string" && x !== "");
  const own = WAREHOUSE_FIELDS.filter((f) => m.fields.some((x) => x.name === f)).map((f) => r[f]).filter((x): x is string => typeof x === "string" && x !== "");
  if (own.length || depth >= 3) return [...new Set(own)];
  for (const rel of m.fields.filter((f) => f.kind === "object" && f.relationFromFields?.length)) {
    const parent = MODELS.get(rel.type);
    if (!parent) continue;
    const where = Object.fromEntries(rel.relationFromFields!.map((from, i) => [rel.relationToFields![i]!, r[from]]));
    if (Object.values(where).some((v) => v === null || v === undefined)) continue;
    const row = await delegate(client, parent.name).findFirst({ where, select: selectAll(parent) });
    if (!row) continue;
    const found = await warehousesOf(client, parent, row, depth + 1);
    if (found.length) return found;
  }
  return [];
}

export interface LogRow {
  userId: string | null;
  byName: string | null;
  via: string;
  action: "create" | "update" | "delete";
  entity: string;
  recordId: string | null;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  warehouses: string[];
}

/** One row per field that differs between `before` and `after` (null `before` = a create). */
export function fieldChanges(m: Model, before: Row | null, after: Row): { field: string; oldValue: string | null; newValue: string | null }[] {
  // On a create, the record's own key says nothing new, nor do the parents a counter-keyed row is named by. Other links
  // are a person's choice (a BKT's "To" warehouse) and are logged like any value.
  const skip = new Set([...keyOf(m), ...(isCounterKeyed(m) ? foreignKeys(m) : [])]);
  return scalars(m).flatMap((f) => {
    if (isNoise(m, f.name) || (before === null && skip.has(f.name))) return [];
    const oldValue = before ? asText(before[f.name]) : null;
    const newValue = asText(after[f.name]);
    if (oldValue === newValue || (before === null && (newValue === null || newValue === ""))) return [];
    return SECRET.has(f.name) ? [{ field: f.name, oldValue: null, newValue: MASKED }] : [{ field: f.name, oldValue, newValue }];
  });
}

/**
 * Runs one write and logs it. `client` is where the log reads old values and writes its rows: the open transaction when
 * there is one (so a failed save leaves no row), the base client otherwise.
 */
export async function loggedWrite(client: Client, model: string, operation: string, args: any, run: (args: any) => Promise<any>): Promise<any> {
  const m = MODELS.get(model)!;
  const { userId, userName, via } = currentAudit();
  const rows: LogRow[] = [];
  const base = { userId, byName: userName ?? null, via, entity: model };
  const one = async (action: LogRow["action"], record: Row, changes: ReturnType<typeof fieldChanges>, summary = false) => {
    const warehouses = await warehousesOf(client, m, record);
    const recordId = recordIdOf(m, record);
    if (summary || !changes.length) rows.push({ ...base, action, recordId, field: null, oldValue: null, newValue: null, warehouses });
    else for (const c of changes) rows.push({ ...base, action, recordId, ...c, warehouses });
  };
  // A write that asked for only some fields back is read again in full; one whose answer lacks its own key (a narrow
  // select) falls back to what it was given, so the log never fails the save over a missing key.
  const reread = async (r: Row): Promise<Row> => {
    if (keyOf(m).some((k) => r?.[k] === undefined)) return { ...(args.data ?? args.create ?? {}), ...r };
    return (await delegate(client, model).findUnique({ where: whereKey(m, r), select: selectAll(m) })) ?? r;
  };

  let result: any;
  switch (operation) {
    case "create": {
      result = await run(args);
      const after = args.select || args.include ? await reread(result) : result;
      await one("create", after, fieldChanges(m, null, after), via === "import");
      break;
    }
    case "update":
    case "upsert": {
      const before = await delegate(client, model).findUnique({ where: args.where, select: selectAll(m) });
      result = await run(args);
      const after = args.select || args.include ? await reread(result) : result;
      if (before) { const changes = fieldChanges(m, before, after); if (changes.length) await one("update", after, changes); }
      else await one("create", after, fieldChanges(m, null, after), via === "import");
      break;
    }
    case "delete": {
      const before = await delegate(client, model).findUnique({ where: args.where, select: selectAll(m) });
      result = await run(args);
      if (before) await one("delete", before, [], true);
      break;
    }
    case "updateMany":
    case "deleteMany": {
      const befores: Row[] = await delegate(client, model).findMany({ where: args.where, select: selectAll(m), take: BULK_LIMIT + 1 });
      result = await run(args);
      if (!befores.length) break;
      if (befores.length > BULK_LIMIT) {
        rows.push({ ...base, action: operation === "updateMany" ? "update" : "delete", recordId: null, field: operation === "updateMany" ? Object.keys(args.data ?? {}).join(", ") : null, oldValue: null, newValue: `${result?.count ?? "many"} records`, warehouses: [] });
        break;
      }
      for (const before of befores) {
        if (operation === "deleteMany") { await one("delete", before, [], true); continue; }
        const after = await reread(before);
        if (after) { const changes = fieldChanges(m, before, after); if (changes.length) await one("update", after, changes); }
      }
      break;
    }
    case "createMany":
    case "createManyAndReturn": {
      result = await run(args);
      const data: Row[] = Array.isArray(args.data) ? args.data : [args.data];
      const count = result?.count ?? (Array.isArray(result) ? result.length : data.length);
      if (count) rows.push({ ...base, action: "create", recordId: null, field: null, oldValue: null, newValue: `${count} records`, warehouses: data[0] ? await warehousesOf(client, m, data[0]) : [] });
      break;
    }
    default:
      return run(args);
  }
  if (rows.length) await client.changeLog.createMany({ data: rows });
  return result;
}

function whereKey(m: Model, r: Row): Row {
  const key = keyOf(m);
  if (key.length === 1) return { [key[0]!]: r[key[0]!] };
  return { [m.primaryKey?.name ?? key.join("_")]: Object.fromEntries(key.map((k) => [k, r[k]])) };
}
