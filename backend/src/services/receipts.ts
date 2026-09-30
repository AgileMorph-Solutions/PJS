/**
 * The receipt service. Routes and the seeder both go through here, which is why every mutating
 * function takes `bypassValidation`.
 *
 * That flag exists for one honest reason: the real seed data violates the rules. Six of the 50
 * imported receipts are rejected with no recorded reason. Importing them through the HTTP
 * validation path would mean either dropping six real trucks or inventing six reasons — both
 * forbidden by ground rule §4. So the seeder bypasses the hard rules and the violations are
 * reported by /api/data-quality instead.
 */
import { Prisma } from "@prisma/client";
import { STAGE_FIELD_MAP } from "@anagroci/contract/generated/stageFieldMap";
import { deriveStatus } from "@anagroci/contract/domain/receiptStatus";
import type { ReceiptRecord } from "@anagroci/contract/types/receipt";
import { prisma } from "../db.js";
import { RECEIPT_INCLUDE, toColumnPayload, STAGE_MODEL_DELEGATE } from "../stageStore.js";
import { toReceiptRecord } from "../serialize.js";
import { assertLotBeforeBin, assertRejectionHasReason, ValidationError } from "../domain/validation.js";

type Tx = Prisma.TransactionClient;
export interface WriteOpts {
  bypassValidation?: boolean;
  /** Who is writing, and how — when set, every changed field is recorded in StageFieldChange.
   * The seeder and importers pass nothing: their data predates users and gets no invented actor. */
  actor?: { id: string; via: "direct" | "approval" };
}

export async function loadReceiptRow(id: string, tx: Tx | typeof prisma = prisma) {
  return tx.receipt.findUnique({ where: { id }, include: RECEIPT_INCLUDE });
}

export async function getReceipt(id: string) {
  const row = await loadReceiptRow(id);
  return row ? toReceiptRecord(row) : null;
}

export interface ReceiptActivities {
  otherActivities: unknown[];
  activityLedger: unknown[];
}

/**
 * The full 1:N history for n-otheract / n-ledger. ReceiptRecord.stageData can only carry the most
 * recent row of each (see stageStore.ts) — this is the real sequence doc §7 asks for.
 */
export async function getReceiptActivities(id: string): Promise<ReceiptActivities> {
  const [otherActivities, activityLedger] = await Promise.all([
    prisma.otherActivity.findMany({ where: { receiptId: id }, orderBy: { seq: "asc" } }),
    prisma.activityLedgerEntry.findMany({ where: { receiptId: id }, orderBy: { seq: "asc" } }),
  ]);
  return { otherActivities, activityLedger };
}

/** `site` is a resolved list of names (see domain/site.ts's resolveSite) — the caller expands the
 * site before calling in, so this stays a plain Prisma filter with no site-lookup of its own. */
export async function listReceipts(site?: string[]) {
  const rows = await prisma.receipt.findMany({
    where: site ? { warehouse: { in: site } } : {},
    include: RECEIPT_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toReceiptRecord);
}

/**
 * Next id in the REC-<year>-NNNN series.
 *
 * Scoped to the current year's prefix — the previous implementation took the max trailing number
 * across ALL years, so an existing REC-2025-0099 produced REC-2026-0100. Wrapped in a serializable
 * transaction by the caller so two concurrent creates can't collide.
 */
export async function nextReceiptId(tx: Tx): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `REC-${year}-`;
  const rows = await tx.receipt.findMany({ where: { id: { startsWith: prefix } }, select: { id: true } });
  const max = rows
    .map((r) => Number(r.id.slice(prefix.length)))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

/** Mirrors createReceipt(): a blank receipt with a seeded `planned` timeline entry. */
export async function createReceipt(warehouse?: string) {
  const row = await prisma.$transaction(async (tx) => {
    const id = await nextReceiptId(tx);
    const now = new Date().toISOString();
    // Receipt.warehouse is a hard FK, so a blank receipt needs a real warehouse to point at.
    const wh = warehouse ?? (await tx.warehouse.findFirst({ orderBy: { name: "asc" } }))?.name;
    if (!wh) throw new ValidationError("No warehouses exist yet — add one before creating a receipt.");
    await tx.receipt.create({
      data: {
        id,
        source: "entered",
        arrivalDate: now.slice(0, 10),
        supplierName: "",
        lbaCode: "",
        vehicleNo: "",
        warehouse: wh,
        timeline: { create: [{ status: "planned", at: now }] },
      },
    });
    return loadReceiptRow(id, tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return toReceiptRecord(row!);
}

/** Mirrors updateReceiptField(id, patch) — top-level ReceiptRecord fields only. */
const PATCHABLE = ["source", "arrivalDate", "supplierName", "lbaCode", "vehicleNo", "warehouse", "origin"] as const;

export async function patchReceipt(id: string, patch: Record<string, unknown>, opts: WriteOpts = {}) {
  const data: Record<string, unknown> = {};
  for (const k of PATCHABLE) if (k in patch) data[k] = patch[k] === "" && k === "origin" ? null : patch[k];
  // lotNo / binNo are not columns here — they live on their stage rows. Route them properly
  // instead of silently ignoring them.
  if ("lotNo" in patch) await setStageFields(id, "n-lot", { "Lot Number": String(patch.lotNo ?? "") }, opts);
  if ("binNo" in patch) await setStageFields(id, "n-bin", { "Bin Number": String(patch.binNo ?? "") }, opts);

  if (Object.keys(data).length) await prisma.receipt.update({ where: { id }, data });
  const row = await loadReceiptRow(id);
  return toReceiptRecord(row!);
}

/**
 * The partial unique index is the real guarantee (it can't be raced); this check exists only so the
 * caller gets the rule explained rather than a bare constraint violation. Scoped to the receipt's
 * OWN warehouse, matching writeLotsOntoReceipts (services/imports.ts) and the DB index itself — a
 * global check would reject Yakro's Lot 1 as a clash with Bouaké's Lot 1. Shared with the
 * submission flow so a clashing Lot is rejected at submit time, not first discovered at approval.
 */
export async function assertLotAvailable(tx: Tx | typeof prisma, receiptId: string, warehouse: string, lotNumber: string) {
  const clash = await tx.stageLotAssignment.findFirst({
    where: { lotNumber, warehouseName: warehouse, receiptId: { not: receiptId } },
    select: { receiptId: true },
  });
  if (clash) {
    throw new ValidationError(
      `Lot ${lotNumber} is already assigned to receipt ${clash.receiptId} at ${warehouse} — one truck = one Lot, always.`
    );
  }
}

/**
 * Write one or more fields of one stage.
 *
 * Always upserts the StageEntry, even when every incoming value is "". That reproduces the
 * frontend's current behaviour exactly — where typing and deleting a character in a system stage
 * permanently sets that status — because the migration must be behaviour-preserving. The
 * resulting "present but empty" stages are reported by /api/data-quality rather than silently
 * changed. See stageStore.ts's header.
 *
 * This is the transactional body, exposed so a caller that needs several writes to land atomically
 * (approving a submission touches up to six stages plus the timeline) can run them in one
 * transaction. Everything else goes through setStageFields below.
 */
export async function applyStageFields(
  tx: Tx,
  id: string,
  stageId: string,
  fields: Record<string, string>,
  opts: WriteOpts = {}
) {
  const spec = STAGE_FIELD_MAP[stageId];
  if (!spec) throw new ValidationError(`Unknown stage "${stageId}"`);

  const data: Record<string, unknown> = toColumnPayload(stageId, fields);
  const delegate = STAGE_MODEL_DELEGATE[stageId];

  if (!opts.bypassValidation && stageId === "n-bin" && "Bin Number" in fields) {
    const existing = await tx.stageLotAssignment.findUnique({ where: { receiptId: id } });
    assertLotBeforeBin(existing?.lotNumber, fields["Bin Number"]);
  }

  if (stageId === "n-lot") {
    // warehouseName is not a stage field (see the model's own comment) — it's a controlled copy
    // of Receipt.warehouse, kept in sync here on every n-lot write rather than only by the
    // discharge importer's write-back, so a manually-entered Lot is scoped by warehouse exactly
    // like an imported one. Without this, a hand-typed Lot stores warehouseName = NULL, and
    // Postgres's partial unique index never treats two NULLs as equal — it would silently bypass
    // per-warehouse uniqueness rather than enforce it.
    const receipt = await tx.receipt.findUnique({ where: { id }, select: { warehouse: true } });
    data.warehouseName = receipt!.warehouse;

    if (!opts.bypassValidation && (fields["Lot Number"] ?? "").trim()) {
      await assertLotAvailable(tx, id, receipt!.warehouse, fields["Lot Number"].trim());
    }
  }

  await tx.stageEntry.upsert({
    where: { receiptId_stageId: { receiptId: id, stageId } },
    update: {},
    create: { receiptId: id, stageId },
  });

  const model = (tx as any)[delegate];

  if (opts.actor) {
    const before =
      spec.cardinality === "many"
        ? await model.findFirst({ where: { receiptId: id }, orderBy: { seq: "desc" } })
        : await model.findUnique({ where: { receiptId: id } });
    const changes = Object.entries(fields).flatMap(([label, value]) => {
      const col = spec.fields.find((f) => f.label === label)!.col;
      const old = before?.[col] ?? null;
      return String(old ?? "") === value ? [] : [{
        receiptId: id, stageId, label, oldValue: old === null ? null : String(old), newValue: value,
        userId: opts.actor!.id, via: opts.actor!.via,
      }];
    });
    if (changes.length) await tx.stageFieldChange.createMany({ data: changes });
  }

  if (spec.cardinality === "many") {
    // The assembler projects the highest-seq row, so setStageField targets that same row,
    // creating seq 1 if none exists. Extra rows are created via the activities endpoint.
    const latest = await model.findFirst({ where: { receiptId: id }, orderBy: { seq: "desc" } });
    if (latest) await model.update({ where: { id: latest.id }, data });
    else await model.create({ data: { receiptId: id, seq: 1, ...data } });
  } else {
    await model.upsert({
      where: { receiptId: id },
      update: data,
      create: { receiptId: id, ...data },
    });
  }
}

export async function setStageFields(
  id: string,
  stageId: string,
  fields: Record<string, string>,
  opts: WriteOpts = {}
) {
  await prisma.$transaction((tx) => applyStageFields(tx, id, stageId, fields, opts));

  const row = await loadReceiptRow(id);
  return toReceiptRecord(row!);
}

/**
 * Mirrors setBranch(): records the decision, recomputes status server-side, appends a timeline
 * entry — the same three steps TrackingContext does client-side today, but as the source of truth.
 */
export async function setBranch(
  id: string,
  stageId: string,
  branchId: string,
  reason?: string,
  opts: WriteOpts = {}
) {
  if (!opts.bypassValidation && stageId === "n-qfs") assertRejectionHasReason(branchId, reason);

  await prisma.$transaction(async (tx) => {
    await tx.receiptBranch.upsert({
      where: { receiptId_stageId: { receiptId: id, stageId } },
      update: { branchId, decidedAt: new Date() },
      create: { receiptId: id, stageId, branchId },
    });

    if (stageId === "n-qfs" && branchId === "fail" && reason) {
      await tx.stageEntry.upsert({
        where: { receiptId_stageId: { receiptId: id, stageId: "n-reject" } },
        update: {},
        create: { receiptId: id, stageId: "n-reject" },
      });
      await tx.stageRejection.upsert({
        where: { receiptId: id },
        update: { reason },
        create: { receiptId: id, reason },
      });
    }

    const fresh = await loadReceiptRow(id, tx);
    const status = deriveStatus(toReceiptRecord(fresh!) as ReceiptRecord);
    await tx.timelineEntry.create({ data: { receiptId: id, status, at: new Date().toISOString(), actorId: opts.actor?.id } });
  });

  const row = await loadReceiptRow(id);
  return toReceiptRecord(row!);
}
