/**
 * The production twin of stageStore.ts — the bridge between PRODUCTION_FIELD_MAP and the 22
 * generated per-table models. stageStore.ts itself is procurement-only and untouched by this file.
 *
 * The key structural difference from stageStore.ts: procurement's per-stage tables are Prisma
 * relations off one Receipt (1:1 or 1:N via a receiptId FK), assembled through a single `include`.
 * Production's 22 tables are deliberately NOT Prisma relations off BtmIntake/ProductionLot/
 * ProductionBin — every one of them is cardinality "many" with its own uuid PK and a soft, indexed
 * link column (btmNo/lotNo/binNo) rather than a hard FK (see schema.prisma's Production header
 * comment for why: several of those real columns are known-unreliable, e.g. btm-input-quality's
 * own "Lot No" column actually holds Source Bin values). So there is no single `include` to build;
 * presence and listing are separate per-table queries against PRODUCTION_FIELD_MAP's spine.
 */
import { Prisma } from "@prisma/client";
import { PRODUCTION_FIELD_MAP, productionColFor } from "@anagroci/contract/generated/productionFieldMap";
import { prisma } from "./db.js";
import { UnknownStageFieldError } from "./stageStore.js";

/** Same alias services/receipts.ts uses for its `tx` parameters. */
type Tx = Prisma.TransactionClient;

/** table id -> Prisma client delegate name ("btm-receipt" -> "btmReceipt"), mirrors
 * STAGE_MODEL_DELEGATE exactly. */
export const PRODUCTION_MODEL_DELEGATE: Record<string, string> = Object.fromEntries(
  Object.entries(PRODUCTION_FIELD_MAP).map(([id, s]) => [
    id,
    s.model.charAt(0).toLowerCase() + s.model.slice(1),
  ])
);

/** spine -> the column every table in that spine links its parent by. Must match
 * packages/contract/scripts/gen-production-prisma-models.ts's own PARENT_COL table exactly — that
 * script is what actually put these columns in the schema, this is just the read-side mirror. */
export const PARENT_COL: Record<string, string | null> = {
  btm: "btmNo",
  lot: "lotNo",
  bin: "binNo",
  standalone: null,
};

/** Translate {label: value} into {col: value} for one production table. Reuses
 * UnknownStageFieldError (not a new error class) — app.ts's existing handler already maps it to
 * 400, so a typo'd label on a production write gets the same treatment as on a procurement one
 * with zero changes to the error handler. */
export function toProductionColumnPayload(tableId: string, fields: Record<string, string>) {
  const spec = PRODUCTION_FIELD_MAP[tableId];
  if (!spec) throw new Error(`Unknown production table "${tableId}"`);
  const data: Record<string, unknown> = {};
  for (const [label, value] of Object.entries(fields)) {
    try {
      data[productionColFor(tableId, label)] = value;
    } catch {
      // productionColFor throws a plain Error on an unknown label; re-throw as the typed error
      // routes/app.ts already know how to map, using tableId in place of stageId for the message.
      throw new UnknownStageFieldError(tableId, label);
    }
  }
  return data;
}

type Delegate = { findMany: (args: any) => Promise<any[]>; count: (args: any) => Promise<number>; create: (args: any) => Promise<any> };

function delegateFor(tableId: string, client: Tx | typeof prisma = prisma): Delegate {
  const name = PRODUCTION_MODEL_DELEGATE[tableId];
  if (!name) throw new Error(`Unknown production table "${tableId}"`);
  return (client as unknown as Record<string, Delegate>)[name];
}

/** All table ids belonging to one spine, in PRODUCTION_FIELD_MAP's own order. */
export function tableIdsForSpine(spine: "btm" | "lot" | "bin" | "standalone"): string[] {
  return Object.entries(PRODUCTION_FIELD_MAP)
    .filter(([, s]) => s.spine === spine)
    .map(([id]) => id);
}

/**
 * Which of a spine's tables have at least one row for this key — the TablePresence shape
 * deriveBtmStatus/deriveLotStatus (packages/contract/src/domain/productionStatus.ts) already
 * expect. One count() per table, batched — there are at most 4 BTM tables and 15 Lot tables, so
 * this stays cheap without needing a cached presence table (unlike procurement's StageEntry, which
 * exists because 16 per-request joins would otherwise be needed on every read).
 */
export async function presentTables(spine: "btm" | "lot" | "bin", key: string): Promise<Record<string, boolean>> {
  const parentCol = PARENT_COL[spine];
  const ids = tableIdsForSpine(spine);
  const counts = await Promise.all(
    ids.map((id) => delegateFor(id).count({ where: { [parentCol!]: key } }))
  );
  return Object.fromEntries(ids.map((id, i) => [id, counts[i] > 0]));
}

/** Create one row in a production table, linked to its parent by the spine's parent column. */
export async function createProductionRow(tableId: string, parentKey: string, fields: Record<string, string>, tx: Tx | typeof prisma = prisma) {
  const spec = PRODUCTION_FIELD_MAP[tableId];
  if (!spec) throw new Error(`Unknown production table "${tableId}"`);
  const parentCol = PARENT_COL[spec.spine];
  const data = toProductionColumnPayload(tableId, fields);
  if (parentCol) data[parentCol] = parentKey;
  return delegateFor(tableId, tx).create({ data });
}

/** Default/maximum page size for listProductionRows — several real tables have 10,000+ rows
 * (shelling-machine-sample: 15,742), so an unbounded findMany is a real cost, not a theoretical
 * one. The frontend paginates client-side on top of this (same DataTable/usePagination every other
 * list page uses), so this cap just bounds one request's payload, not the data itself. */
const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 5000;

/** List rows for one table — scoped to a parent key for btm/lot/bin-spine tables, or every row
 * (up to the limit) for a standalone table with no key to scope by. */
export async function listProductionRows(tableId: string, key: string | null, limit = DEFAULT_LIMIT) {
  const spec = PRODUCTION_FIELD_MAP[tableId];
  if (!spec) throw new Error(`Unknown production table "${tableId}"`);
  const take = Math.min(Math.max(1, limit), MAX_LIMIT);
  const parentCol = PARENT_COL[spec.spine];
  if (!parentCol || key === null) return delegateFor(tableId).findMany({ take });
  return delegateFor(tableId).findMany({ where: { [parentCol]: key }, take });
}
