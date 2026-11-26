/**
 * Drying Batch (consolidated, both sites) — read-only, the Drying page's primary source. Replaces
 * DryingJob (whose only source, "FINAL DRY RCN-YAKRO-2026", is retired — see truckReception.ts's
 * sibling importers for the same reasoning). DryingJob's own rows are kept, unread, as a
 * provenance trail rather than deleted — see drying_batch_vs_drying_job_drift's own comment for
 * why the two were never merged: 33 of 81 central rows disagree on date/status/destination.
 */
import { prisma } from "../db.js";

export async function listDryingBatches(site?: string[]) {
  return prisma.dryingBatch.findMany({
    where: site ? { warehouseSite: { in: site } } : {},
    orderBy: [{ dryingDate: "asc" }, { sn: "asc" }],
  });
}

// ── Sun drying done in the app (client, Oct 2026: a Sun Drying phase with weights and quality before and after, re-drying and status) ──
//
// A Lot is dried in rounds (contract domain/sunDrying.ts). startDrying issues round 1: what goes out and its quality before.
// returnDrying records what came back. checkDrying records the quality after and either passes the Lot or sends it back, which
// opens the next round starting from what came back. The QFS reception sample is never written here, and never copied: the
// quality before drying is measured on the drying sample.

import type { ReceiptRecord } from "@anagroci/contract/types/receipt";
import { deriveStatus } from "@anagroci/contract/domain/receiptStatus";
import { dryingLoss, dryingReturnProblem } from "@anagroci/contract/domain/dryingLoss";
import { DECISION_BRANCHES } from "@anagroci/contract/domain/decisions";
import { binDryingProblem, binDryingStockProblem, canSendDryingToProduction, DRYING_TO_PRODUCTION_UNIT_MESSAGE, DRYING_STATUS, dryingKor, dryingPhase, dryingQualityProblem, isOpenRound, truckDryingBlocker, type DryingQuality } from "@anagroci/contract/domain/sunDrying";
import { binSiteProblem, siteBinStock } from "./binStock.js";
import { Prisma } from "@prisma/client";
import { ValidationError, assertDryingJobHasLot } from "../domain/validation.js";
import { applyBranch, applyStageFields, loadReceiptRow } from "./receipts.js";
import { toReceiptRecord } from "../serialize.js";
import { assembleStageData } from "../stageStore.js";
import { siteOf } from "./ids.js";
import { resolveSite } from "../domain/site.js";
import { formatDate } from "@anagroci/contract/domain/dateFormat";

type Actor = { id: string; displayName?: string };
type Tx = Prisma.TransactionClient;
const DECISION_LABEL = "Decision (Direct to drying / Warehouse → Drying)";
const GRAMS = ["GoodKernelG", "ImmatureG", "SpottedG", "RejectionG", "VoidG", "OilG", "ShellG"] as const;
const GRAM_LABEL: Record<(typeof GRAMS)[number], string> = {
  GoodKernelG: "good kernel", ImmatureG: "immature", SpottedG: "spotted", RejectionG: "rejection", VoidG: "void", OilG: "oil", ShellG: "shell",
};

/** Quality fields arrive flat, prefixed by when they were measured: inputMoisture, inputGoodKernelG … / outputMoisture … */
type QualityFields<P extends string> = Partial<Record<`${P}${"Moisture" | "NutCount" | "Kor" | (typeof GRAMS)[number]}`, number | string | null>>;

export interface StartDryingInput extends QualityFields<"input"> {
  /** "direct" (straight to the drying yard) or "indirect" (via the warehouse): the decision this form answers Yes to. */
  route?: string;
  date?: string;
  sourceBin?: string;
  destinationBin?: string;
  dryType?: string;
  issuedBags?: number | string | null;
  issuedNetKg?: number | string | null;
}
/** Drying from a Bin: the Bin is the one in the URL, so there is no route and no source to give. */
export type StartBinDryingInput = Omit<StartDryingInput, "route" | "sourceBin">;
export interface ReturnDryingInput {
  receivedBags?: number | string | null;
  receivedNetKg?: number | string | null;
  destinationBin?: string;
}
export interface CheckDryingInput extends QualityFields<"output"> {
  /**
   * "pass": dry enough, into its new Bin. "redry": it goes back out, as the next round. "production": the exception — dry,
   * and sent straight to production from the yard with no new Bin (Sameer, 18 Nov 2026).
   */
  decision?: string;
  /** The new Bin, when it wasn't named with what came back. */
  destinationBin?: string;
  /** With "production": the BTM it went to production on, when known. */
  btmNo?: string;
}

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
function number(v: unknown, what: string, { required = false, min = 0, max = Infinity }: { required?: boolean; min?: number; max?: number } = {}): number | null {
  if (blank(v)) { if (required) throw new ValidationError(`${what} is required.`); return null; }
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  if (Number.isNaN(n) || n < min || n > max) throw new ValidationError(`${what} must be a number${max !== Infinity ? ` between ${min} and ${max}` : min > 0 ? ` of at least ${min}` : ""}.`);
  return n;
}
const dec = (n: number | null) => (n === null ? null : new Prisma.Decimal(n));
const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));
const today = () => new Date().toISOString().slice(0, 10);

/** No reading at all was given for `prefix`: every quality field blank. */
const noQuality = (input: Record<string, unknown>, prefix: "input" | "output") =>
  ["Moisture", "NutCount", "Kor", ...GRAMS].every((k) => blank(input[`${prefix}${k}`]));

/** A quality reading from the request, validated the same way before and after (contract dryingQualityProblem). */
export function readQuality(input: Record<string, unknown>, prefix: "input" | "output"): DryingQuality {
  const when = prefix === "input" ? "before" : "after";
  const q: DryingQuality = {
    moisture: number(input[`${prefix}Moisture`], `Moisture ${when} drying`, { max: 100 }),
    nutCount: number(input[`${prefix}NutCount`], `Nut count ${when} drying`),
    kor: number(input[`${prefix}Kor`], `KOR ${when} drying`, { max: 80 }),
    goodKernelG: null, immatureG: null, spottedG: null, rejectionG: null, voidG: null, oilG: null, shellG: null,
  };
  for (const g of GRAMS) (q as unknown as Record<string, number | null>)[g[0]!.toLowerCase() + g.slice(1)] = number(input[`${prefix}${g}`], `Cut-test ${GRAM_LABEL[g]} grams ${when} drying`);
  const problem = dryingQualityProblem(q, when);
  if (problem) throw new ValidationError(problem);
  return q;
}
/** The quality as DryingBatch columns. KOR is calculated from the grams when they are all there, as at QFS. */
function qualityColumns(q: DryingQuality, prefix: "input" | "output") {
  return {
    [`${prefix}MoisturePct`]: dec(q.moisture), [`${prefix}NutCount`]: dec(q.nutCount), [`${prefix}Kor`]: dec(dryingKor(q)),
    [`${prefix}GoodKernelG`]: dec(q.goodKernelG), [`${prefix}ImmatureG`]: dec(q.immatureG), [`${prefix}SpottedG`]: dec(q.spottedG),
    [`${prefix}RejectionG`]: dec(q.rejectionG), [`${prefix}VoidG`]: dec(q.voidG), [`${prefix}OilG`]: dec(q.oilG), [`${prefix}ShellG`]: dec(q.shellG),
  };
}

/**
 * A Bin named on a drying is in the Bin master and, given the warehouse's names (resolveSite: the site, its stores and
 * aliases), one of that warehouse's Bins (26 Nov 2026, user: dried RCN goes into a Bin of its own warehouse, never another's).
 */
async function assertBinExists(tx: Tx | typeof prisma, code: string | undefined, what: string, siteNames?: readonly string[]) {
  if (blank(code)) return;
  const bin = await tx.bin.findUnique({ where: { code: code!.trim().toUpperCase() }, select: { code: true, warehouseName: true } })
    ?? await tx.bin.findUnique({ where: { code: code!.trim() }, select: { code: true, warehouseName: true } });
  if (!bin) throw new ValidationError(`${what} "${code}" isn't in the Bin master — add it in Masters › Bins first.`);
  if (siteNames && !(bin.warehouseName && siteNames.includes(bin.warehouseName))) {
    throw new ValidationError(`${what} ${bin.code} isn't a Bin of this warehouse. Choose one of its own Bins.`);
  }
}

/** The names a drying's warehouse goes by, for checking its Bins; undefined for an old round that recorded none. */
const namesOf = async (site: string | null | undefined) => (site ? resolveSite(site) : undefined);

/** One line on the truck's timeline for a drying event, found through the Lot the round belongs to. */
async function noteOnTimeline(tx: Tx, lotNo: string | null, warehouseSite: string | null, actorId: string, note: string) {
  if (!lotNo) return;
  const rows = await tx.stageLotAssignment.findMany({ where: { lotNumber: lotNo }, select: { receiptId: true } });
  for (const { receiptId } of rows) {
    const row = await loadReceiptRow(receiptId, tx);
    if (!row || (warehouseSite && row.warehouse !== warehouseSite)) continue;
    await tx.timelineEntry.create({ data: { receiptId, status: deriveStatus(toReceiptRecord(row) as ReceiptRecord), at: new Date().toISOString(), actorId, note } });
  }
}

/**
 * Starts sun drying for an accepted truck's Lot: answers the drying decision Yes (direct or via the warehouse) and issues round 1
 * with what goes out (bags, net kg) and its quality before (moisture required; nut count and the cut test). One open round per
 * Lot; a drying is per Lot, never per Bin, as everywhere else. A Lot whose drying passed can be dried again later: a new round 1.
 */
/** What every round 1 needs, wherever it is issued from: a drying type, the net kg that goes out, its quality before, a date. */
function readStart(input: StartBinDryingInput) {
  if (blank(input.dryType)) throw new ValidationError("Drying type is required.");
  const issuedKg = number(input.issuedNetKg, "Net kg issued for drying", { required: true, min: 0.001 })!;
  const bags = number(input.issuedBags, "Bags issued", { min: 0 });
  // The quality going onto the yard is the QFS Officer's to measure (26 Nov 2026): left blank here, it is sent by them and
  // written on the Incharge's approval (setDryingInputQuality). Given here, it is checked as before.
  const before = noQuality(input as Record<string, unknown>, "input") ? null : readQuality(input as Record<string, unknown>, "input");
  const date = blank(input.date) ? today() : String(input.date).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) throw new ValidationError("The drying date must be a real date, YYYY-MM-DD.");
  // RCN can't go onto the yard tomorrow (26 Nov 2026, user); the form's calendar stops at today too.
  if (date > today()) throw new ValidationError(`The drying date ${formatDate(date)} is in the future. Use today or an earlier day.`);
  return { issuedKg, bags, before, date };
}

/**
 * Starts sun drying from a Bin (Sameer, 18 Nov 2026): RCN goes from the Bin to the drying yard, and once dry is re-bagged
 * into a new Bin. The Bin is required — it is the one drying is started from — and must be a Bin of this warehouse; a new
 * Bin named now can't be that same Bin (contract binDryingProblem). No Lot: the Lots in a Bin can't be told apart. Several
 * dryings may be out from one Bin at once, each its own quantity.
 */
export async function startBinDrying(binCode: string, site: readonly string[], input: StartBinDryingInput, actor: Actor) {
  const code = binCode.trim().toUpperCase();
  const problem = binDryingProblem(code, input.destinationBin);
  if (problem) throw new ValidationError(problem);
  const { issuedKg, bags, before, date } = readStart(input);

  return prisma.$transaction(async (tx) => {
    const notHere = await binSiteProblem(site, code);
    if (notHere) throw new ValidationError(notHere);
    const bin = (await tx.bin.findUnique({ where: { code }, select: { code: true, warehouseName: true } }))!;
    await assertBinExists(tx, input.destinationBin, "New Bin", site);
    const warehouseSite = (await siteOf(tx, bin.warehouseName!)) ?? bin.warehouseName!;
    // The Bin's stock as the Warehouse activities page shows it: an empty Bin has nothing to dry, and none can take more out
    // than it holds (contract binDryingStockProblem).
    const held = (await siteBinStock(site)).get(code)?.kg ?? 0;
    const short = binDryingStockProblem(code, held, issuedKg);
    if (short) throw new ValidationError(short);
    const sn = await nextDryingSn(tx, warehouseSite, bin.warehouseName);
    return tx.dryingBatch.create({
      data: {
        sn, round: 1, dryingDate: new Date(`${date}T00:00:00Z`), dryingDateRaw: date, warehouseSite, warehouse: bin.warehouseName,
        sourceBinNo: code, destinationBinNo: blank(input.destinationBin) ? null : input.destinationBin!.trim().toUpperCase(),
        status: DRYING_STATUS.inDrying, dryType: input.dryType!.trim(),
        issuedBags: bags === null ? null : Math.round(bags), issuedNetWeightKg: dec(issuedKg),
        ...(before ? qualityColumns(before, "input") : {}),
        startedBy: actor.displayName ?? null, source: "entered",
      },
    });
  });
}

/**
 * The next drying S N. It counts up per site, as the client's sheets do, but the database keeps it unique per `warehouse`
 * (the store text, schema's @@unique([warehouse, sn])). A store typed the same at two sites ("123" at Bouaké and at Yakro,
 * 23 Nov 2026) made the site's next number one the other site had already used, and the drying was refused with "That
 * value is already taken". So the next number is past both: this site's rows and this store's.
 */
async function nextDryingSn(tx: Tx, warehouseSite: string | null, warehouse: string | null): Promise<number> {
  const or = [
    ...(warehouseSite ? [{ warehouseSite }] : []),
    ...(warehouse ? [{ warehouse }] : []),
  ];
  if (!or.length) return 1;
  return ((await tx.dryingBatch.aggregate({ where: { OR: or }, _max: { sn: true } }))._max.sn ?? 0) + 1;
}

/** The Bin a drying chain was taken from: round 1's source. Null for a truck dried straight off the truck (the yard). */
async function chainSource(tx: Tx, batch: { firstBatchId: string | null; sourceBinNo: string | null; lotNo: string | null }): Promise<string | null> {
  if (batch.lotNo) return null;
  if (!batch.firstBatchId) return batch.sourceBinNo;
  return (await tx.dryingBatch.findUnique({ where: { id: batch.firstBatchId }, select: { sourceBinNo: true } }))?.sourceBinNo ?? batch.sourceBinNo;
}

/**
 * Starts sun drying for a truck's Lot. Since 22 Nov 2026 that is the truck unloaded straight onto the drying yard (Sameer,
 * 18 Nov 2026): it has no Bin yet, so nothing is taken from one. Drying from a Bin is startBinDrying. An older "via the
 * warehouse" answer is still accepted here, as it was, from its Lot's Bin.
 */
export async function startDrying(receiptId: string, input: StartDryingInput, actor: Actor) {
  const route = input.route ?? "";
  if (!DECISION_BRANCHES["n-drying"]!.some((b) => b.id === route && b.id !== "none")) throw new ValidationError("Choose how the Lot goes to drying: direct, or via the warehouse.");
  const { issuedKg, bags, before, date } = readStart(input);

  await prisma.$transaction(async (tx) => {
    const row = await loadReceiptRow(receiptId, tx);
    if (!row) throw Object.assign(new Error("Receipt not found"), { code: "P2025" });
    const record = toReceiptRecord(row) as ReceiptRecord;
    const stages = assembleStageData(row as Record<string, unknown>);
    const lot = (stages["n-lot"]?.["Lot Number"] ?? "").trim();
    if (deriveStatus(record) === "rejected" || !lot) throw new ValidationError("Only an accepted truck that has a Lot can be dried.");
    assertDryingJobHasLot({ lotNo: lot });
    // A truck already in a Bin is dried from that Bin, not from the yard (contract truckDryingBlocker): the same RCN can't
    // go out twice, once as the truck's and once as the Bin's.
    const rounds = await tx.dryingBatch.findMany({ where: { lotNo: lot }, select: { sn: true, source: true, status: true } });
    const blocked = truckDryingBlocker(stages["n-bin"]?.["Bin Number"] || record.binNo, rounds);
    if (blocked) throw new ValidationError(blocked);
    await assertBinExists(tx, input.sourceBin, "Source bin");
    await assertBinExists(tx, input.destinationBin, "New Bin", await namesOf(row.warehouse));
    const open = (await tx.dryingBatch.findMany({ where: { lotNo: lot, warehouseSite: row.warehouse }, select: { status: true } })).some((b) => isOpenRound(b.status));
    if (open) throw new ValidationError(`Lot ${lot} is already in drying. Finish that drying (its return and quality check) first.`);
    const sn = await nextDryingSn(tx, row.warehouse, (stages["n-gate"]?.["WH NO."] ?? "").trim() || null);
    await tx.dryingBatch.create({
      data: {
        sn, round: 1, dryingDate: new Date(`${date}T00:00:00Z`), dryingDateRaw: date, warehouseSite: row.warehouse,
        warehouse: (stages["n-gate"]?.["WH NO."] ?? "").trim() || null,
        // Straight off the truck onto the yard: there is no Bin it was taken from.
        sourceBinNo: !blank(input.sourceBin) ? input.sourceBin!.trim() : route === "direct" ? null : (stages["n-bin"]?.["Bin Number"] ?? null),
        destinationBinNo: blank(input.destinationBin) ? null : input.destinationBin!.trim(),
        lotNo: lot, ficheNoRaw: (stages["n-verify"]?.["FICHE"] ?? "").trim() || null,
        supplierNameRaw: row.supplierName || null, supplierCodeRaw: row.lbaCode || null,
        status: DRYING_STATUS.inDrying, dryType: input.dryType!.trim(),
        issuedBags: bags === null ? null : Math.round(bags), issuedNetWeightKg: dec(issuedKg),
        ...(before ? qualityColumns(before, "input") : {}),
        startedBy: actor.displayName ?? null, source: "entered",
      },
    });
    // The decision, and the drying step existing: that existence is what makes the truck "in drying" (receiptStatus.ts).
    const a = { id: actor.id, via: "direct" as const };
    await applyBranch(tx, receiptId, "n-drying", route, undefined, { actor: a });
    await applyStageFields(tx, receiptId, "n-drying", { [DECISION_LABEL]: DECISION_BRANCHES["n-drying"]!.find((b) => b.id === route)!.label }, { actor: a });
    await noteOnTimeline(tx, lot, row.warehouse, actor.id, `Lot ${lot} issued for sun drying (round 1): ${issuedKg} kg${before ? ` at ${before.moisture}% moisture` : ", its quality to be measured by the QFS Officer"}`);
  });
  return toReceiptRecord((await loadReceiptRow(receiptId))!);
}

async function roundIn(tx: Tx, batchId: string, phase: "in_drying" | "quality_check") {
  const batch = await tx.dryingBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw Object.assign(new Error("Drying batch not found"), { code: "P2025" });
  if (batch.source !== "entered") throw new ValidationError("This drying row comes from a workbook; it is shown as it was recorded and can't be continued here.");
  const now = dryingPhase(batch.status);
  if (now !== phase) {
    throw new ValidationError(phase === "in_drying"
      ? (now === "quality_check" ? "What came back is already recorded: record the quality check next." : "This drying round is already finished.")
      : (now === "in_drying" ? "Record what came back from drying before its quality check." : "This drying round is already finished."));
  }
  return batch;
}

/** What came back from the yard: bags and net kg. The weight loss is worked out here (contract dryingLoss), never typed. */
export async function returnDrying(batchId: string, input: ReturnDryingInput, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const batch = await roundIn(tx, batchId, "in_drying");
    const returnedKg = number(input.receivedNetKg, "Dried net kg returned", { required: true })!;
    const issuedKg = Number(batch.issuedNetWeightKg ?? 0);
    const problem = dryingReturnProblem(issuedKg, returnedKg);
    if (problem) throw new ValidationError(problem);
    const bags = number(input.receivedBags, "Bags returned", { min: 0 });
    await assertBinExists(tx, input.destinationBin, "New Bin", await namesOf(batch.warehouseSite));
    const source = await chainSource(tx, batch);
    const toBin = blank(input.destinationBin) ? batch.destinationBinNo : input.destinationBin!.trim().toUpperCase();
    if (source) { const p = binDryingProblem(source, toBin); if (p) throw new ValidationError(p); }
    const loss = dryingLoss(issuedKg, returnedKg, null, null);
    const updated = await tx.dryingBatch.update({
      where: { id: batchId },
      data: {
        status: DRYING_STATUS.qualityCheck, returnedAt: new Date(), returnedBy: actor.displayName ?? null,
        receivedBags: bags === null ? null : Math.round(bags), receivedNetWeightKg: dec(returnedKg),
        ...(blank(input.destinationBin) ? {} : { destinationBinNo: input.destinationBin!.trim().toUpperCase() }),
        dryingLossKg: dec(loss.lossKg), dryingLossPct: dec(loss.lossPct),
      },
    });
    await noteOnTimeline(tx, batch.lotNo, batch.warehouseSite, actor.id, `Sun drying round ${batch.round ?? 1}: ${returnedKg} kg came back (${loss.lossKg} kg lost); quality check next`);
    return updated;
  });
}

/**
 * The quality check after a round: moisture (required), nut count and the cut test. "pass" finishes the drying; "redry" sends the
 * Lot back out as the next round, issued with what came back and starting from the quality just measured.
 */
export async function checkDrying(batchId: string, input: CheckDryingInput, actor: Actor) {
  return prisma.$transaction((tx) => checkDryingIn(tx, batchId, input, actor));
}

/** checkDrying inside the caller's transaction: a QFS Officer's check is applied with its approval, as one write. */
export async function checkDryingIn(tx: Tx, batchId: string, input: CheckDryingInput, actor: Actor) {
  const decision = input.decision ?? "";
  if (decision !== "pass" && decision !== "redry" && decision !== "production") throw new ValidationError("Choose the result of the check: passed into a new Bin, dry it again, or sent straight to production.");
  const after = readQuality(input as Record<string, unknown>, "output");
  {
    const batch = await roundIn(tx, batchId, "quality_check");
    if (decision === "production") {
      // Production runs at a Central warehouse; a Unit's RCN goes on to Central on a BKT first (contract canSendDryingToProduction).
      const site = batch.warehouseSite ? await tx.warehouse.findUnique({ where: { name: batch.warehouseSite }, select: { type: true } }) : null;
      if (!canSendDryingToProduction(site?.type)) throw new ValidationError(DRYING_TO_PRODUCTION_UNIT_MESSAGE);
    }
    const source = await chainSource(tx, batch);
    // Passed from a Bin, the dried RCN is re-bagged into a NEW Bin: without one it would be in no Bin's stock at all.
    let destination = batch.destinationBinNo;
    if (decision === "pass" && !blank(input.destinationBin)) {
      await assertBinExists(tx, input.destinationBin, "New Bin", await namesOf(batch.warehouseSite));
      destination = input.destinationBin!.trim().toUpperCase();
    }
    if (decision === "pass" && source) {
      if (!destination) throw new ValidationError("Choose the new Bin the dried RCN goes into.");
      const p = binDryingProblem(source, destination);
      if (p) throw new ValidationError(p);
    }
    const moistureLoss = dryingLoss(0, 0, num(batch.inputMoisturePct), after.moisture).moistureLossPct;
    const status = decision === "pass" ? DRYING_STATUS.passed : decision === "production" ? DRYING_STATUS.toProduction : DRYING_STATUS.redry;
    const checked = await tx.dryingBatch.update({
      where: { id: batchId },
      data: {
        ...qualityColumns(after, "output"), moistureLossPct: dec(moistureLoss),
        status, checkedAt: new Date(), checkedBy: actor.displayName ?? null,
        ...(decision === "pass" ? { destinationBinNo: destination } : {}),
        // Straight to production goes into no Bin; the workbook's own "Issued to production" column says when.
        ...(decision === "production" ? { destinationBinNo: null, issuedToProduction: today(), btmNo: blank(input.btmNo) ? null : input.btmNo!.trim() } : {}),
      },
    });
    const round = batch.round ?? 1;
    if (decision === "pass") {
      await noteOnTimeline(tx, batch.lotNo, batch.warehouseSite, actor.id, `Sun drying passed after round ${round}: moisture ${after.moisture}%`);
      return { checked, next: null };
    }
    if (decision === "production") {
      await noteOnTimeline(tx, batch.lotNo, batch.warehouseSite, actor.id, `Sun drying finished after round ${round} (moisture ${after.moisture}%): sent straight to production${blank(input.btmNo) ? "" : ` on BTM ${input.btmNo!.trim()}`}, no new Bin`);
      return { checked, next: null };
    }
    const sn = await nextDryingSn(tx, batch.warehouseSite, batch.warehouse);
    const next = await tx.dryingBatch.create({
      data: {
        sn, round: round + 1, firstBatchId: batch.firstBatchId ?? batch.id,
        dryingDate: new Date(`${today()}T00:00:00Z`), dryingDateRaw: today(), warehouseSite: batch.warehouseSite, warehouse: batch.warehouse,
        sourceBinNo: batch.destinationBinNo ?? batch.sourceBinNo, destinationBinNo: batch.destinationBinNo,
        lotNo: batch.lotNo, ficheNoRaw: batch.ficheNoRaw, supplierNameRaw: batch.supplierNameRaw, supplierCodeRaw: batch.supplierCodeRaw,
        status: DRYING_STATUS.inDrying, dryType: batch.dryType,
        issuedBags: batch.receivedBags, issuedNetWeightKg: batch.receivedNetWeightKg,
        ...qualityColumns(after, "input"),
        startedBy: actor.displayName ?? null, source: "entered",
      },
    });
    await noteOnTimeline(tx, batch.lotNo, batch.warehouseSite, actor.id, `Sun drying round ${round} needs re-drying (moisture ${after.moisture}%): round ${round + 1} issued with ${Number(batch.receivedNetWeightKg)} kg`);
    return { checked, next };
  }
}

/**
 * The quality of a round going onto the yard, recorded after it was started (26 Nov 2026): the QFS Officer's reading,
 * written on the Incharge's approval. Only on an in-app round with no reading yet — a reading already there is the Incharge's
 * to correct, never overwritten by a form. A round 2+ starts from its previous check's reading, so it never asks for one.
 */
export async function setDryingInputQuality(tx: Tx, batchId: string, input: Record<string, unknown>, actor: Actor) {
  const before = readQuality(input, "input");
  const batch = await tx.dryingBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw Object.assign(new Error("Drying batch not found"), { code: "P2025" });
  if (batch.source !== "entered") throw new ValidationError("This drying row comes from a workbook; it is shown as it was recorded.");
  if (batch.inputMoisturePct !== null) throw new ValidationError(`The quality going onto the yard is already recorded for this round (moisture ${Number(batch.inputMoisturePct)}%). The Warehouse Incharge or an Admin changes it.`);
  const updated = await tx.dryingBatch.update({ where: { id: batchId }, data: qualityColumns(before, "input") });
  await noteOnTimeline(tx, batch.lotNo, batch.warehouseSite, actor.id, `Sun drying round ${batch.round ?? 1}: quality going onto the yard recorded, ${before.moisture}% moisture`);
  return updated;
}

/** A drying round as the QFS list and the approval name it: "round 2 of Lot LOT-…" or "round 1 from Bin BKE-BIN-08". */
export function dryingRoundName(b: { round: number | null; sn: number; lotNo: string | null; sourceBinNo: string | null }): string {
  const what = b.lotNo ? `Lot ${b.lotNo}` : b.sourceBinNo ? `Bin ${b.sourceBinNo}` : `drying #${b.sn}`;
  return `Drying round ${b.round ?? 1} of ${what}`;
}
