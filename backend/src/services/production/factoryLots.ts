/**
 * Production Phases 3–4: a batch's Lots. Cooking takes kg out of the silos, QC-3 and QC-4 decide when a Lot may move on,
 * and shelling records its day. Rules are in the contract (domain/cooking.ts, lotEntries.ts, shelling.ts); status,
 * totals and every percentage are calculated from these rows, never stored.
 *
 * Each write has an `…In` form that runs in the caller's transaction, like rcnReceipts.ts, so the production workbook
 * upload goes through the same rules with the same words.
 */
import type { Prisma } from "@prisma/client";
import { canWriteStageDirectly } from "@anagroci/contract/data/roles";
import { SILO_SIZE_KEYS, siloLabel, type SiloSize, type SizeValues } from "@anagroci/contract/domain/calibration";
import {
  canColourSort, canShell, coolingCheck, coolingError, cookChecks, cookRunError, lotBags, lotSizes, lotStatus,
} from "@anagroci/contract/domain/cooking";
import { isIsoDate } from "@anagroci/contract/domain/dateFormat";
import { SORTER_STREAMS, isColourSorted, sortChecks, sorterStreamKg } from "@anagroci/contract/domain/colourSort";
import { AFTER_COOLING, AFTER_SHELLING, ENTRY_DEFS, entryError, entryNotes, isEntryKind, normalizeEntryValues, type EntryKind } from "@anagroci/contract/domain/lotEntries";
import type { MoistureCheckStatus } from "@anagroci/contract/domain/rcnReceipt";
import { SHELLING_KG_FIELDS, shellingDayError, shellingDayNotes, shellingFigures, type ShellingKgField } from "@anagroci/contract/domain/shelling";
import type { CoolingInput, CookRunInput, LotEntryInput, LotEntryView, LotView, ShellingDayInput, ShellingDayView } from "@anagroci/contract/types/lots";
import { prisma } from "../../db.js";
import { ForbiddenError, ValidationError } from "../../domain/validation.js";
import { assertStoresNotShort } from "./byProducts.js";
import { siloStockBySize } from "./calibration.js";
import { blankToNull, runSizes, type Actor } from "./rcnReceipts.js";

type Tx = Prisma.TransactionClient;

const name = { select: { displayName: true } };

export const LOT_INCLUDE = {
  runs: { include: { createdBy: name }, orderBy: { id: "asc" } },
  entries: { include: { submittedBy: name, reviewedBy: name }, orderBy: { id: "asc" } },
  shellingDays: { include: { createdBy: name }, orderBy: { id: "asc" } },
} satisfies Prisma.FactoryLotInclude;

type LotRow = Prisma.FactoryLotGetPayload<{ include: typeof LOT_INCLUDE }>;

function entryView(e: LotRow["entries"][number], coolingAt: string | null): LotEntryView {
  const kind = e.kind as EntryKind;
  const values = e.values as Record<string, string>;
  return {
    id: e.id, lotCode: e.lotCode, kind, date: e.date, values, decision: e.decision, status: e.status as MoistureCheckStatus,
    notes: entryNotes(kind, values, { date: e.date, coolingAt }),
    submittedBy: e.submittedBy.displayName, submittedAt: e.submittedAt.toISOString(),
    reviewedBy: e.reviewedBy?.displayName ?? null, reviewedAt: e.reviewedAt?.toISOString() ?? null, rejectReason: e.rejectReason,
  };
}

function dayValues(d: LotRow["shellingDays"][number]) {
  const kg: Partial<Record<ShellingKgField, string>> = {};
  for (const [k] of SHELLING_KG_FIELDS) if (d[k] !== null) kg[k] = d[k]!;
  return kg;
}

export function lotView(l: LotRow): LotView {
  const runs = l.runs.map((r) => {
    const sizes = runSizes(r);
    return { id: r.id, date: r.date, sizes, totalKg: Object.values(sizes).reduce((n, v) => n + (Number(v) || 0), 0), createdBy: r.createdBy.displayName, createdAt: r.createdAt.toISOString() };
  });
  const sizes = lotSizes(runs);
  const cookedSizes = SILO_SIZE_KEYS.filter((k) => sizes[k] > 0);
  const totalKg = Math.round(runs.reduce((n, r) => n + r.totalKg, 0) * 100) / 100;
  const entries = l.entries.map((e) => entryView(e, l.coolingAt));
  const of = (kind: EntryKind) => entries.filter((e) => e.kind === kind);
  const cooling = coolingCheck(of("qc4"));
  let shelled = 0;
  const shellingDays: ShellingDayView[] = l.shellingDays.map((d) => {
    const kg = dayValues(d);
    const left = totalKg - shelled;
    shelled += Number(d.inputKg) || 0;
    const v = { ...kg, inputKg: d.inputKg, date: d.date };
    return { id: d.id, lotCode: d.lotCode, date: d.date, inputKg: d.inputKg, kg, figures: shellingFigures(v), notes: shellingDayNotes(v, left), createdBy: d.createdBy.displayName, createdAt: d.createdAt.toISOString() };
  });
  const shelledKg = Math.round(shelled * 100) / 100;
  const sorterKg = sorterStreamKg(shellingDays);
  const sorterStreams = SORTER_STREAMS.filter((s) => sorterKg[s] > 0);
  const sorted = sortChecks(sorterStreams, of("qc7_after"));
  return {
    code: l.code, batchCode: l.batchCode,
    status: lotStatus({ inCooling: l.coolingAt !== null, cooling, shellingDays: shellingDays.length, colourSorted: isColourSorted(sorterStreams, sorted) }),
    date: runs[0]?.date ?? "", runs, sizes, cookedSizes, totalKg, bags: lotBags(totalKg),
    coolingSilo: l.coolingSilo, coolingAt: l.coolingAt,
    cookChecks: cookChecks(cookedSizes, of("qc3")), coolingCheck: cooling,
    entries, shellingDays, shelledKg, leftToShellKg: Math.round((totalKg - shelledKg) * 100) / 100,
    sorterKg, sorterStreams, sortChecks: sorted,
  };
}

async function lotAt(tx: Tx | typeof prisma, site: string, code: string): Promise<LotRow> {
  const row = await tx.factoryLot.findFirst({ where: { code: code.trim().toUpperCase(), batch: { warehouse: site } }, include: LOT_INCLUDE });
  if (!row) throw new ValidationError(`Lot ${code} doesn't exist at ${site}.`);
  return row;
}

export async function listLots(site: string, batchCode?: string): Promise<LotView[]> {
  const rows = await prisma.factoryLot.findMany({ where: { batch: { warehouse: site }, ...(batchCode ? { batchCode } : {}) }, include: LOT_INCLUDE, orderBy: { createdAt: "asc" } });
  return rows.map(lotView);
}

const asDate = (v: string | undefined, label = "A date is required.") => {
  const d = (v ?? "").trim();
  if (d && !isIsoDate(d)) throw new ValidationError(label);
  return d;
};

const kgColumns = (sizes: SizeValues | undefined) =>
  Object.fromEntries(SILO_SIZE_KEYS.map((k) => [`kg${k}`, blankToNull(sizes?.[k])])) as Record<`kg${SiloSize}`, string | null>;

// ── Phase 3, step 1 · Cook by size ──────────────────────────────────────────────────────────────

export async function cookLot(site: string, actorId: string, input: CookRunInput): Promise<LotView> {
  return lotView(await prisma.$transaction((tx) => cookLotIn(tx, site, actorId, input)));
}

/** A new number makes the Lot; a number of this batch still cooking takes one more row. Never past a silo's stock. */
export async function cookLotIn(tx: Tx, site: string, actorId: string, input: CookRunInput): Promise<LotRow> {
  const batchCode = (input.batchCode ?? "").trim().toUpperCase();
  if (!batchCode) throw new ValidationError("Choose the batch the Lot is for.");
  const batch = await tx.productionBatch.findFirst({ where: { code: batchCode, warehouse: site }, select: { code: true } });
  if (!batch) throw new ValidationError(`Batch ${batchCode} doesn't exist at ${site}.`);
  const code = (input.code ?? "").trim().toUpperCase();
  const date = asDate(input.date);
  const problem = cookRunError({ date, code, sizes: input.sizes }, await siloStockBySize(tx, site));
  if (problem) throw new ValidationError(problem);

  const existing = await tx.factoryLot.findUnique({ where: { code } });
  if (existing) {
    if (existing.batchCode !== batchCode) throw new ValidationError(`Lot ${code} belongs to batch ${existing.batchCode}.`);
    if (existing.coolingAt) throw new ValidationError(`Lot ${code} has gone to its cooling silo; nothing more can be cooked into it.`);
  } else {
    await tx.factoryLot.create({ data: { code, batchCode, createdById: actorId } });
  }
  await tx.lotCookRun.create({ data: { lotCode: code, date, ...kgColumns(input.sizes), createdById: actorId } });
  return lotAt(tx, site, code);
}

/**
 * A wrong row is removed and typed again, until the Lot goes to cooling. Its kg return to the silos. Removing a Lot's
 * last row removes the Lot and whatever was recorded against it, as nothing was then cooked.
 */
export async function deleteCookRun(site: string, runId: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const run = await tx.lotCookRun.findFirst({ where: { id: runId, lot: { batch: { warehouse: site } } }, include: { lot: { include: { runs: { select: { id: true } } } } } });
    if (!run) throw new ValidationError(`Cooking row ${runId} doesn't exist at ${site}.`);
    if (run.lot.coolingAt) throw new ValidationError(`Lot ${run.lotCode} has gone to its cooling silo; its cooking can't be changed.`);
    await tx.lotCookRun.delete({ where: { id: run.id } });
    if (run.lot.runs.length === 1) {
      await tx.lotEntry.deleteMany({ where: { lotCode: run.lotCode } });
      await tx.factoryLot.delete({ where: { code: run.lotCode } });
    }
    await assertStoresNotShort(tx, site);
  });
}

// ── Phase 3, step 3 · To the cooling silo ───────────────────────────────────────────────────────

export async function moveToCooling(site: string, code: string, input: CoolingInput): Promise<LotView> {
  return lotView(await prisma.$transaction((tx) => moveToCoolingIn(tx, site, code, input)));
}

/** Only with every cooked size past QC-3: "a failed check does not move forward". Correctable until QC-4 has looked at it. */
export async function moveToCoolingIn(tx: Tx, site: string, code: string, input: CoolingInput): Promise<LotRow> {
  const lot = await lotAt(tx, site, code);
  const date = asDate(input.date);
  const problem = coolingError({ ...input, date });
  if (problem) throw new ValidationError(problem);
  const view = lotView(lot);
  const held = view.cookedSizes.filter((s) => view.cookChecks[s] !== "ok");
  if (held.length) throw new ValidationError(`Size ${held.map(siloLabel).join(", ")} of ${lot.code} has not passed its cooking check (QC-3).`);
  if (view.entries.some((e) => e.kind === "qc4" && e.status !== "rejected")) throw new ValidationError(`${lot.code} already has its moisture and temperature check; its cooling silo can't change now.`);
  await tx.factoryLot.update({ where: { code: lot.code }, data: { coolingSilo: input.silo!.trim(), coolingAt: `${date}T${input.time!.trim()}` } });
  return lotAt(tx, site, lot.code);
}

// ── A Lot's small records ───────────────────────────────────────────────────────────────────────

export async function addLotEntry(site: string, actor: Actor, code: string, input: LotEntryInput): Promise<LotView> {
  return lotView(await prisma.$transaction((tx) => addLotEntryIn(tx, site, actor, code, input)));
}

/** A QFS Officer's check waits for the Incharge; an Incharge's or Admin's, and the floor's own records, are approved as saved. */
export async function addLotEntryIn(tx: Tx, site: string, actor: Actor, code: string, input: LotEntryInput): Promise<LotRow> {
  if (!isEntryKind(input.kind)) throw new ValidationError("Choose what is being recorded.");
  const kind = input.kind;
  const def = ENTRY_DEFS[kind];
  const direct = canWriteStageDirectly(actor.role);
  if (def.who === "floor" && !direct) throw new ForbiddenError(`${def.title} is the Warehouse Incharge's to record.`);
  const lot = await lotAt(tx, site, code);
  const view = lotView(lot);
  const date = asDate(input.date);
  const problem = entryError(kind, { date, values: input.values, decision: input.decision }, view.cookedSizes);
  if (problem) throw new ValidationError(problem);
  if (kind === "qc4" && !lot.coolingAt) throw new ValidationError(`${lot.code} has not gone to its cooling silo yet.`);
  if (AFTER_SHELLING.includes(kind) && !canColourSort(view.status)) throw new ValidationError(`${lot.code} has no shelling day record yet; the sorter has nothing of it to sort.`);
  if (kind === "qc7_after" && !view.sorterStreams.includes(input.values?.stream as never)) throw new ValidationError(`Shelling gave ${lot.code} no ${input.values?.stream ?? ""} to sort.`);
  if (AFTER_COOLING.includes(kind) && !canShell(view.status)) throw new ValidationError(`${lot.code} has not passed its moisture and temperature check (QC-4); shelling can't start on it.`);
  await tx.lotEntry.create({
    data: {
      lotCode: lot.code, kind, date, values: normalizeEntryValues(kind, input.values ?? {}), decision: def.decision ? input.decision! : null,
      status: direct ? "approved" : "submitted", submittedById: actor.id, ...(direct ? { reviewedById: actor.id, reviewedAt: new Date() } : {}),
    },
  });
  return lotAt(tx, site, lot.code);
}

/** The Incharge's answer to a submitted check. A reject needs a reason and applies nothing. */
export async function reviewLotEntry(site: string, actorId: string, entryId: number, approve: boolean, reason?: string): Promise<LotView> {
  const rejectReason = (reason ?? "").trim();
  if (!approve && !rejectReason) throw new ValidationError("Give a reason for rejecting the check.");
  return lotView(await prisma.$transaction(async (tx) => {
    const e = await tx.lotEntry.findFirst({ where: { id: entryId, lot: { batch: { warehouse: site } } } });
    if (!e) throw new ValidationError(`Check ${entryId} doesn't exist at ${site}.`);
    if (e.status !== "submitted") throw new ValidationError(`This check was already ${e.status}.`);
    await tx.lotEntry.update({ where: { id: e.id }, data: { status: approve ? "approved" : "rejected", reviewedById: actorId, reviewedAt: new Date(), rejectReason: approve ? null : rejectReason } });
    return lotAt(tx, site, e.lotCode);
  }));
}

/** One button for many: a shift's machine samples run to hundreds of rows, and each still shows on screen before this is pressed. */
export async function approveAllOfKind(site: string, actorId: string, code: string, kind: string): Promise<LotView> {
  if (!isEntryKind(kind)) throw new ValidationError("Choose what is being approved.");
  return lotView(await prisma.$transaction(async (tx) => {
    const lot = await lotAt(tx, site, code);
    await tx.lotEntry.updateMany({ where: { lotCode: lot.code, kind, status: "submitted" }, data: { status: "approved", reviewedById: actorId, reviewedAt: new Date() } });
    return lotAt(tx, site, lot.code);
  }));
}

/** Only the floor's own records: a quality check stays on record and a new one is added instead. */
export async function deleteLotEntry(site: string, entryId: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const e = await tx.lotEntry.findFirst({ where: { id: entryId, lot: { batch: { warehouse: site } } } });
    if (!e) throw new ValidationError(`Record ${entryId} doesn't exist at ${site}.`);
    if (ENTRY_DEFS[e.kind as EntryKind].who !== "floor") throw new ValidationError("A quality check stays on record: add a new one instead.");
    await tx.lotEntry.delete({ where: { id: e.id } });
    await assertStoresNotShort(tx, site);
  });
}

// ── Phase 4, step 1 · Shelling's day record ─────────────────────────────────────────────────────

export async function addShellingDay(site: string, actorId: string, code: string, input: ShellingDayInput): Promise<LotView> {
  return lotView(await prisma.$transaction((tx) => addShellingDayIn(tx, site, actorId, code, input)));
}

/** "Shelling cannot start" before QC-4 says OK. */
export async function addShellingDayIn(tx: Tx, site: string, actorId: string, code: string, input: ShellingDayInput): Promise<LotRow> {
  const lot = await lotAt(tx, site, code);
  if (!canShell(lotView(lot).status)) throw new ValidationError(`${lot.code} has not passed its moisture and temperature check (QC-4); shelling can't start on it.`);
  const date = asDate(input.date);
  const problem = shellingDayError({ ...input, date });
  if (problem) throw new ValidationError(problem);
  await tx.shellingDay.create({
    data: {
      lotCode: lot.code, date, inputKg: input.inputKg!.trim(), createdById: actorId,
      ...Object.fromEntries(SHELLING_KG_FIELDS.map(([k]) => [k, blankToNull(input[k])])),
    },
  });
  return lotAt(tx, site, lot.code);
}

/** A wrong day is removed and typed again, unless its shell or dust has since left the store. */
export async function deleteShellingDay(site: string, dayId: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const d = await tx.shellingDay.findFirst({ where: { id: dayId, lot: { batch: { warehouse: site } } } });
    if (!d) throw new ValidationError(`Day record ${dayId} doesn't exist at ${site}.`);
    await tx.shellingDay.delete({ where: { id: d.id } });
    await assertStoresNotShort(tx, site);
  });
}
