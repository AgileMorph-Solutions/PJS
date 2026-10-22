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
import { DERIVED_RULES, computeDerivedFields, derivedRuleInForce } from "@anagroci/contract/domain/receiptMath";
import { RECEIPT_STAGE_MIRRORS, STAGE_TO_RECEIPT_COLUMNS } from "@anagroci/contract/domain/receiptMirror";
import { currentFormOfSiteId } from "@anagroci/contract/domain/ids";
import { autoDateFill } from "@anagroci/contract/data/autoFields";
import { BIN_FINALISED_MESSAGE, LOCKED_DECISIONS, LOCKED_MESSAGE, LOCKED_STAGES, isGrnComplete } from "@anagroci/contract/domain/recordLock";
import { prisma } from "../db.js";
import { RECEIPT_INCLUDE, assembleStageData, toColumnPayload, STAGE_MODEL_DELEGATE } from "../stageStore.js";
import { toReceiptRecord } from "../serialize.js";
import { assertLotBeforeBin, assertRejectionHasReason, ForbiddenError, ValidationError } from "../domain/validation.js";
import { canSeeField, canSetPrice, type Role } from "@anagroci/contract/data/roles";
import { nextLotNumber, nextReceiptId } from "./ids.js";

type Tx = Prisma.TransactionClient;
export interface WriteOpts {
  bypassValidation?: boolean;
  /** Who is writing, and how — when set, every changed field is recorded in StageFieldChange.
   * The seeder and importers pass nothing: their data predates users and gets no invented actor. */
  actor?: { id: string; via: "direct" | "approval" | "import"; role?: Role };
}

export async function loadReceiptRow(id: string, tx: Tx | typeof prisma = prisma) {
  return tx.receipt.findUnique({ where: { id }, include: RECEIPT_INCLUDE });
}

export async function getReceipt(id: string) {
  // An old REC-2026-NNNN id (a bookmark, an export, a printed form) resolves to the renumbered receipt,
  // and so does one issued under a since-replaced warehouse code (REC-BKE01-… → REC-BKE-…).
  const row = (await loadReceiptRow(id)) ?? (await loadByLegacyId(id)) ?? (await loadBySupersededCode(id));
  return row ? toReceiptRecord(row) : null;
}

async function loadByLegacyId(legacyId: string) {
  const hit = await prisma.receipt.findUnique({ where: { legacyId }, select: { id: true } });
  return hit ? loadReceiptRow(hit.id) : null;
}

async function loadBySupersededCode(id: string) {
  const current = currentFormOfSiteId(id);
  return current ? loadReceiptRow(current) : null;
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
 * A blank receipt with a seeded `planned` timeline entry. Recording the arrival is what issues the
 * Receipt ID (REC-<warehouse code>-<arrival year>-NNN), so the warehouse and arrival date are known
 * up front — the year in the id is the arrival date's, not the day the form happened to be opened.
 */
export async function createReceipt(warehouse?: string, arrivalDate?: string, deliveryPlanId?: string) {
  const row = await prisma.$transaction(async (tx) => {
    const now = new Date().toISOString();
    // Arriving against a plan copies what the plan already knows, so nobody types it twice. Only the
    // receipt's own columns — the stage rows are written when the gate step is actually filled, so
    // picking a plan doesn't on its own move the truck to "arrived".
    const plan = deliveryPlanId ? await tx.deliveryPlan.findUnique({ where: { id: deliveryPlanId } }) : null;
    if (deliveryPlanId && !plan) throw new ValidationError(`Delivery plan ${deliveryPlanId} doesn't exist.`);
    if (plan && warehouse && plan.destinationWarehouse !== warehouse) {
      throw new ValidationError(`Delivery plan ${plan.id} is for ${plan.destinationWarehouse}, not ${warehouse}.`);
    }
    // Receipt.warehouse is a hard FK, so a blank receipt needs a real warehouse to point at.
    const wh = plan?.destinationWarehouse ?? warehouse
      ?? (await tx.warehouse.findFirst({ where: { site: null, code: { not: null } }, orderBy: { name: "asc" } }))?.name;
    if (!wh) throw new ValidationError("No warehouse with a code exists yet — set one in Masters › Warehouses before creating a receipt.");
    const date = arrivalDate ?? now.slice(0, 10);
    const id = await nextReceiptId(tx, wh, date);
    await tx.receipt.create({
      data: {
        id,
        source: "entered",
        arrivalDate: date,
        supplierName: plan?.supplierName ?? "",
        lbaCode: plan?.supplierCode ?? "",
        vehicleNo: "",
        warehouse: wh,
        deliveryPlanId: plan?.id ?? null,
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
  if (!opts.bypassValidation) await assertRecordOpen(prisma, id);
  for (const k of PATCHABLE) if (k in patch) data[k] = patch[k] === "" && k === "origin" ? null : patch[k];
  // lotNo / binNo are not columns here — they live on their stage rows. Route them properly
  // instead of silently ignoring them. The Lot is issued by the system on quality pass, so a
  // request to set one is refused rather than routed.
  if ("lotNo" in patch && !opts.bypassValidation) throw new ValidationError(SYSTEM_LOT_MESSAGE);
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
 *
 * Two kinds of field are the system's, not the caller's (Oct 2026 team feedback): the Lot (issued
 * on quality pass — see applyBranch) and the calculated weights/totals/amount (contract's
 * domain/receiptMath.ts). A person writing either is refused; after any write that feeds a
 * calculation, the calculated fields are rewritten in the same transaction. Imports and the seeder
 * (bypassValidation) skip both: they carry the workbook's own recorded values, which are kept
 * verbatim even where they disagree with the formula (44 real rows' bag totals do) and reported.
 */
export async function applyStageFields(
  tx: Tx,
  id: string,
  stageId: string,
  fields: Record<string, string>,
  opts: WriteOpts = {}
) {
  if (!opts.bypassValidation) {
    const current = await assertCallerMayWrite(tx, id, stageId, fields, opts.actor?.role);
    const meta = await tx.receipt.findUnique({ where: { id }, select: { arrivalDate: true, lockedAt: true } });
    if (meta?.lockedAt && LOCKED_STAGES.has(stageId)) throw new ValidationError(LOCKED_MESSAGE);
    if (stageId === "n-bin" && (current["n-bin"]?.["Bin allocation date"] ?? "").trim()) throw new ValidationError(BIN_FINALISED_MESSAGE);
    // A date the step carries but the person left blank fills itself (contract data/autoFields.ts), whatever route the write came by.
    fields = { ...fields, ...autoDateFill(stageId, fields, current[stageId], { today: new Date().toISOString().slice(0, 10), arrivalDate: meta?.arrivalDate ?? "" }) };
  }
  await writeStageFields(tx, id, stageId, fields, opts);
  if (!opts.bypassValidation) await syncReceiptColumns(tx, id, stageId, fields);
  if (!opts.bypassValidation && DERIVED_INPUT_STAGES.has(stageId)) await refreshDerivedFields(tx, id, opts);
  if (!opts.bypassValidation && stageId === "n-grn") await lockIfGrnComplete(tx, id, opts);
}

/** Refuses a change to a receipt whose GRN is complete (the lock), as one place for every route that edits its own columns. */
async function assertRecordOpen(db: Tx | typeof prisma, id: string) {
  const r = await db.receipt.findUnique({ where: { id }, select: { lockedAt: true } });
  if (r?.lockedAt) throw new ValidationError(LOCKED_MESSAGE);
}

/**
 * Locks the reception record the moment its GRN is complete (the quantity and the price, in either order). The actor is
 * who completed it; a seeder or import (no validation) never gets here, so existing records are left open.
 */
async function lockIfGrnComplete(tx: Tx, id: string, opts: WriteOpts) {
  const row = await loadReceiptRow(id, tx);
  if (!row || row.lockedAt || !isGrnComplete(assembleStageData(row as Record<string, unknown>))) return;
  await tx.receipt.update({ where: { id }, data: { lockedAt: new Date(), lockedById: opts.actor?.id ?? null } });
  await tx.timelineEntry.create({
    data: { receiptId: id, status: deriveStatus(toReceiptRecord(row) as ReceiptRecord), at: new Date().toISOString(), actorId: opts.actor?.id, note: "Record locked: the GRN is complete" },
  });
}

/**
 * The receipt's supplier, LBA code and truck number are each stored twice — on the receipt (what the
 * list shows) and on the gate/verify stage (the record of the step). Typing one on the stage form
 * moves the other in the same transaction, so the list can't show a supplier the stage doesn't have.
 * Imports and the seeder (bypassValidation) keep what the workbook recorded.
 */
async function syncReceiptColumns(tx: Tx, id: string, stageId: string, fields: Record<string, string>) {
  const data: Record<string, string> = {};
  for (const col of STAGE_TO_RECEIPT_COLUMNS) {
    const [mirrorStage, label] = RECEIPT_STAGE_MIRRORS[col]!;
    if (mirrorStage === stageId && label in fields) data[col] = fields[label]!.trim();
  }
  if (Object.keys(data).length) await tx.receipt.update({ where: { id }, data });
}

export const SYSTEM_BIN_DATE_MESSAGE =
  "The bin allocation date is stamped when the allocation is finalised — it can't be typed. Use Finalise.";

export const SYSTEM_LOT_MESSAGE =
  "The Lot Number is issued by the system when the truck passes quality — it can't be typed or changed.";

async function assertCallerMayWrite(tx: Tx, id: string, stageId: string, fields: Record<string, string>, role?: Role) {
  if (stageId === "n-lot") throw new ValidationError(SYSTEM_LOT_MESSAGE);
  // A field hidden from the writer's role is not theirs to write either (price and amount, for the Warehouse Incharge).
  if (role) for (const label of Object.keys(fields)) if (!canSeeField(role, stageId, label)) throw new ForbiddenError(PRICE_NOT_YOURS_MESSAGE);
  if (stageId === "n-bin" && ("Bin allocation date" in fields || "Finalised by" in fields)) throw new ValidationError(SYSTEM_BIN_DATE_MESSAGE);
  // A value that is typed until its inputs exist (KOR, before the cut-test grams) is the system's only
  // once they do — judged on the stage as it will stand after this write, so grams and KOR sent
  // together are refused rather than leaving a typed number the next recalculation would overwrite.
  const current = assembleStageData((await loadReceiptRow(id, tx)) as Record<string, unknown>);
  const after = { ...current, [stageId]: { ...current[stageId], ...fields } };
  for (const label of Object.keys(fields)) {
    const rule = derivedRuleInForce(after, stageId, label);
    if (rule) throw new ValidationError(`${label} is calculated (${rule.formula}) — change the values it is calculated from instead.`);
  }
  return current;
}

/** Stages whose fields feed at least one calculation — a write anywhere else can't change a derived value. */
const DERIVED_INPUT_STAGES = new Set(DERIVED_RULES.flatMap((r) => r.inputs.map(([stageId]) => stageId)));

/**
 * Rewrites every calculated field whose inputs are all present and whose stored value differs.
 * Calculated values are audited like any other change (same actor, same channel), so the history
 * shows why a net weight moved.
 */
async function refreshDerivedFields(tx: Tx, id: string, opts: WriteOpts) {
  const row = await loadReceiptRow(id, tx);
  const current = assembleStageData(row as Record<string, unknown>);
  for (const [stageId, values] of Object.entries(computeDerivedFields(current))) {
    const changed = Object.fromEntries(Object.entries(values).filter(([label, v]) => current[stageId]?.[label] !== v));
    if (Object.keys(changed).length) await writeStageFields(tx, id, stageId, changed, opts);
  }
}

/** The write itself, with no say over WHO may write which field — callers above decide that. */
async function writeStageFields(
  tx: Tx,
  id: string,
  stageId: string,
  fields: Record<string, string>,
  opts: WriteOpts
) {
  const spec = STAGE_FIELD_MAP[stageId];
  if (!spec) throw new ValidationError(`Unknown stage "${stageId}"`);

  const data: Record<string, unknown> = toColumnPayload(stageId, fields);
  const delegate = STAGE_MODEL_DELEGATE[stageId];

  if (!opts.bypassValidation && stageId === "n-bin" && "Bin Number" in fields) {
    const existing = await tx.stageLotAssignment.findUnique({ where: { receiptId: id } });
    assertLotBeforeBin(existing?.lotNumber, fields["Bin Number"]);
    await assertBinIsAPhysicalBin(tx, fields["Bin Number"]);
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

export const PRICE_NOT_YOURS_MESSAGE = "The price is recorded by the Branch Manager (or an Admin); it isn't shown to the Warehouse Incharge.";

/**
 * The negotiated price per kg, set directly by the Branch Manager who negotiated it (or an Admin), with no approval step: the
 * Warehouse Incharge, who approves the other reception details, may no longer see prices (Oct 2026). The amount follows by
 * itself (price × paid weight), and a price that completes the GRN locks the record, exactly as any other GRN write.
 */
export async function setPrice(id: string, price: unknown, actor: { id: string; role: Role }) {
  if (!canSetPrice(actor.role)) throw new ForbiddenError(PRICE_NOT_YOURS_MESSAGE);
  const v = String(price ?? "").trim();
  if (v !== "") {
    const n = Number(v.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) throw new ValidationError("The price must be a number above 0 (XOF per kg).");
  }
  return setStageFields(id, "n-grn", { PRICE: v }, { actor: { id: actor.id, via: "direct", role: actor.role } });
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
 * The decision write itself, without the timeline entry — exposed so a caller that records several
 * changes at once (the workbook upload) can run it inside its own transaction and append ONE
 * timeline entry for the lot. A QFS fail still needs a reason, here as everywhere.
 */
export async function applyBranch(
  tx: Tx,
  id: string,
  stageId: string,
  branchId: string,
  reason?: string,
  opts: WriteOpts = {}
) {
  if (!opts.bypassValidation && stageId === "n-qfs") assertRejectionHasReason(branchId, reason);
  // The quality decision is part of the locked record; the drying and transfer decisions come after the GRN and stay open.
  if (!opts.bypassValidation && LOCKED_DECISIONS.has(stageId)) await assertRecordOpen(tx, id);

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

  // Imports and the seeder record history: a truck the workbook never gave a Lot doesn't get one
  // invented now.
  if (stageId === "n-qfs" && branchId === "pass" && !opts.bypassValidation) {
    return { lotIssued: await issueLotIfMissing(tx, id, opts) };
  }
  return {};
}

/**
 * A Bin is a physical location INSIDE a store (BKE-002-BIN-012), not the store itself (BKE-002) —
 * the client's point 3. New allocations must name a Bin the master holds and must not name a store.
 * Several Bins for one Lot may be written "BKE-002-BIN-004 / BKE-002-BIN-006", as their sheet does.
 * Only NEW writes are held to this: Bin values already stored are never rewritten, and the ones
 * that are really store codes are reported by the data-quality audit instead.
 */
async function assertBinIsAPhysicalBin(tx: Tx, value: string | undefined) {
  const bins = (value ?? "").split(/\s*[\/,]\s*/).map((b) => b.trim()).filter(Boolean);
  for (const code of bins) {
    const store = await tx.warehouse.findFirst({ where: { name: code, site: { not: null } }, select: { name: true } });
    if (store) {
      throw new ValidationError(`${code} is a store (a warehouse code), not a Bin. Choose the Bin inside it, e.g. ${code}-BIN-012.`);
    }
    if (!(await tx.bin.findUnique({ where: { code }, select: { code: true } }))) {
      throw new ValidationError(`Bin "${code}" isn't in the Bin master — add it in Masters › Bins first, so the same place is never spelled two ways.`);
    }
  }
}

/**
 * Passing quality is the "accepted reception" moment — one accepted truck creates one original Lot
 * (Oct 2026 team feedback). Issued at most once: switching the decision to fail and back to pass
 * keeps the Lot it already has, and a Lot is never taken back or reused.
 */
async function issueLotIfMissing(tx: Tx, id: string, opts: WriteOpts): Promise<string | undefined> {
  const existing = await tx.stageLotAssignment.findUnique({ where: { receiptId: id }, select: { lotNumber: true } });
  if (existing?.lotNumber?.trim()) return undefined;

  const receipt = await tx.receipt.findUniqueOrThrow({ where: { id }, select: { warehouse: true, arrivalDate: true } });
  const lotNumber = await nextLotNumber(tx, receipt.warehouse, receipt.arrivalDate);
  const by = opts.actor
    ? (await tx.user.findUnique({ where: { id: opts.actor.id }, select: { displayName: true } }))?.displayName ?? "System"
    : "System";
  // The truck the Lot belongs to is already on the receipt (typed at the gate) — carried here, not retyped.
  const truck = (await tx.stageGateEntry.findUnique({ where: { receiptId: id }, select: { vehicleNo: true } }))?.vehicleNo?.trim()
    || (await tx.receipt.findUniqueOrThrow({ where: { id }, select: { vehicleNo: true } })).vehicleNo.trim();
  await writeStageFields(tx, id, "n-lot", {
    "Lot Number": lotNumber,
    ...(truck ? { "Truck reference": truck } : {}),
    "Assigned by (Warehouse Team)": by,
    "Date/time assigned": new Date().toISOString(),
  }, opts);
  return lotNumber;
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
  await prisma.$transaction(async (tx) => {
    const { lotIssued } = await applyBranch(tx, id, stageId, branchId, reason, opts);

    const fresh = await loadReceiptRow(id, tx);
    const status = deriveStatus(toReceiptRecord(fresh!) as ReceiptRecord);
    await tx.timelineEntry.create({
      data: { receiptId: id, status, at: new Date().toISOString(), actorId: opts.actor?.id, note: lotIssued ? `Lot ${lotIssued} issued` : undefined },
    });
  });

  const row = await loadReceiptRow(id);
  return toReceiptRecord(row!);
}

/**
 * Closes the bin allocation: stamps today's date and who finalised it (the stage's "Bin allocation date" and "Finalised by").
 * Needs a Lot and a Bin first, and can only be done once; after it the bin step can't change until an Admin reopens it.
 */
export async function finaliseBin(id: string, actor: { id: string; displayName: string }) {
  await prisma.$transaction(async (tx) => {
    await assertRecordOpen(tx, id);
    const row = await loadReceiptRow(id, tx);
    if (!row) throw Object.assign(new Error("Receipt not found"), { code: "P2025" });
    const stages = assembleStageData(row as Record<string, unknown>);
    if (!(stages["n-lot"]?.["Lot Number"] ?? "").trim()) throw new ValidationError("A Bin can only be finalised once the truck has a Lot.");
    if (!(stages["n-bin"]?.["Bin Number"] ?? "").trim()) throw new ValidationError("Choose the Bin first, then finalise.");
    if ((stages["n-bin"]?.["Bin allocation date"] ?? "").trim()) throw new ValidationError("The bin allocation is already finalised.");
    await writeStageFields(
      tx, id, "n-bin",
      { "Bin allocation date": new Date().toISOString().slice(0, 10), "Finalised by": actor.displayName },
      { actor: { id: actor.id, via: "direct" } },
    );
    await tx.timelineEntry.create({
      data: { receiptId: id, status: deriveStatus(toReceiptRecord(row) as ReceiptRecord), at: new Date().toISOString(), actorId: actor.id, note: `Bin ${stages["n-bin"]["Bin Number"]} finalised` },
    });
  });
  return toReceiptRecord((await loadReceiptRow(id))!);
}

/**
 * Admin only (the route enforces it): reopens a locked record and/or a finalised bin so it can be corrected. The reason is
 * required and stays on the timeline, so a later reader sees who reopened it and why. The record locks again by itself the
 * next time its GRN is completed.
 */
export async function reopenRecord(id: string, actor: { id: string; displayName: string }, reason: string | undefined) {
  if (!reason?.trim()) throw new ValidationError("Say why the record is being reopened.");
  await prisma.$transaction(async (tx) => {
    const row = await loadReceiptRow(id, tx);
    if (!row) throw Object.assign(new Error("Receipt not found"), { code: "P2025" });
    const stages = assembleStageData(row as Record<string, unknown>);
    const finalised = (stages["n-bin"]?.["Bin allocation date"] ?? "").trim() !== "";
    if (!row.lockedAt && !finalised) throw new ValidationError("This record isn't locked or finalised, so there is nothing to reopen.");
    if (row.lockedAt) await tx.receipt.update({ where: { id }, data: { lockedAt: null, lockedById: null } });
    if (finalised) await writeStageFields(tx, id, "n-bin", { "Bin allocation date": "", "Finalised by": "" }, { actor: { id: actor.id, via: "direct" } });
    await tx.timelineEntry.create({
      data: { receiptId: id, status: deriveStatus(toReceiptRecord(row) as ReceiptRecord), at: new Date().toISOString(), actorId: actor.id, note: `Reopened by ${actor.displayName}: ${reason.trim()}` },
    });
  });
  return toReceiptRecord((await loadReceiptRow(id))!);
}
