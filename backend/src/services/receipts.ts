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
export interface WriteOpts { bypassValidation?: boolean }

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

export async function listReceipts() {
  const rows = await prisma.receipt.findMany({ include: RECEIPT_INCLUDE, orderBy: { createdAt: "asc" } });
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

export async function patchReceipt(id: string, patch: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const k of PATCHABLE) if (k in patch) data[k] = patch[k] === "" && k === "origin" ? null : patch[k];
  // lotNo / binNo are not columns here — they live on their stage rows. Route them properly
  // instead of silently ignoring them.
  if ("lotNo" in patch) await setStageFields(id, "n-lot", { "Lot Number": String(patch.lotNo ?? "") });
  if ("binNo" in patch) await setStageFields(id, "n-bin", { "Bin Number": String(patch.binNo ?? "") });

  if (Object.keys(data).length) await prisma.receipt.update({ where: { id }, data });
  const row = await loadReceiptRow(id);
  return toReceiptRecord(row!);
}

/**
 * Write one or more fields of one stage.
 *
 * Always upserts the StageEntry, even when every incoming value is "". That reproduces the
 * frontend's current behaviour exactly — where typing and deleting a character in a system stage
 * permanently sets that status — because the migration must be behaviour-preserving. The
 * resulting "present but empty" stages are reported by /api/data-quality rather than silently
 * changed. See stageStore.ts's header.
 */
export async function setStageFields(
  id: string,
  stageId: string,
  fields: Record<string, string>,
  opts: WriteOpts = {}
) {
  const spec = STAGE_FIELD_MAP[stageId];
  if (!spec) throw new ValidationError(`Unknown stage "${stageId}"`);

  const data = toColumnPayload(stageId, fields);
  const delegate = STAGE_MODEL_DELEGATE[stageId];

  await prisma.$transaction(async (tx) => {
    if (!opts.bypassValidation && stageId === "n-bin" && "Bin Number" in fields) {
      const existing = await tx.stageLotAssignment.findUnique({ where: { receiptId: id } });
      assertLotBeforeBin(existing?.lotNumber, fields["Bin Number"]);
    }

    // The partial unique index is the real guarantee (it can't be raced); this check exists only
    // so the caller gets the rule explained rather than a bare constraint violation.
    if (!opts.bypassValidation && stageId === "n-lot" && (fields["Lot Number"] ?? "").trim()) {
      const lotNumber = fields["Lot Number"].trim();
      const clash = await tx.stageLotAssignment.findFirst({
        where: { lotNumber, receiptId: { not: id } }, select: { receiptId: true },
      });
      if (clash) {
        throw new ValidationError(
          `Lot ${lotNumber} is already assigned to receipt ${clash.receiptId} — one truck = one Lot, always.`
        );
      }
    }

    await tx.stageEntry.upsert({
      where: { receiptId_stageId: { receiptId: id, stageId } },
      update: {},
      create: { receiptId: id, stageId },
    });

    const model = (tx as any)[delegate];
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
  });

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
    await tx.timelineEntry.create({ data: { receiptId: id, status, at: new Date().toISOString() } });
  });

  const row = await loadReceiptRow(id);
  return toReceiptRecord(row!);
}
