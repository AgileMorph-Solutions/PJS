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
import { DRYING_STATUS, dryingKor, dryingPhase, dryingQualityProblem, isOpenRound, type DryingQuality } from "@anagroci/contract/domain/sunDrying";
import { Prisma } from "@prisma/client";
import { ValidationError, assertDryingJobHasLot } from "../domain/validation.js";
import { applyBranch, applyStageFields, loadReceiptRow } from "./receipts.js";
import { toReceiptRecord } from "../serialize.js";
import { assembleStageData } from "../stageStore.js";

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
export interface ReturnDryingInput {
  receivedBags?: number | string | null;
  receivedNetKg?: number | string | null;
  destinationBin?: string;
}
export interface CheckDryingInput extends QualityFields<"output"> {
  /** "pass": the Lot is dry enough. "redry": it goes back out, as the next round. */
  decision?: string;
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

/** A quality reading from the request, validated the same way before and after (contract dryingQualityProblem). */
function readQuality(input: Record<string, unknown>, prefix: "input" | "output"): DryingQuality {
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

async function assertBinExists(tx: Tx | typeof prisma, code: string | undefined, what: string) {
  if (blank(code)) return;
  if (!(await tx.bin.findUnique({ where: { code: code!.trim() }, select: { code: true } }))) {
    throw new ValidationError(`${what} "${code}" isn't in the Bin master — add it in Masters › Bins first.`);
  }
}

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
export async function startDrying(receiptId: string, input: StartDryingInput, actor: Actor) {
  const route = input.route ?? "";
  if (!DECISION_BRANCHES["n-drying"]!.some((b) => b.id === route && b.id !== "none")) throw new ValidationError("Choose how the Lot goes to drying: direct, or via the warehouse.");
  if (blank(input.dryType)) throw new ValidationError("Drying type is required.");
  const issuedKg = number(input.issuedNetKg, "Net kg issued for drying", { required: true, min: 0.001 })!;
  const bags = number(input.issuedBags, "Bags issued", { min: 0 });
  const before = readQuality(input as Record<string, unknown>, "input");
  const date = blank(input.date) ? today() : String(input.date).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) throw new ValidationError("The drying date must be a real date, YYYY-MM-DD.");

  await prisma.$transaction(async (tx) => {
    const row = await loadReceiptRow(receiptId, tx);
    if (!row) throw Object.assign(new Error("Receipt not found"), { code: "P2025" });
    const record = toReceiptRecord(row) as ReceiptRecord;
    const stages = assembleStageData(row as Record<string, unknown>);
    const lot = (stages["n-lot"]?.["Lot Number"] ?? "").trim();
    if (deriveStatus(record) === "rejected" || !lot) throw new ValidationError("Only an accepted truck that has a Lot can be dried.");
    assertDryingJobHasLot({ lotNo: lot });
    await assertBinExists(tx, input.sourceBin, "Source bin");
    await assertBinExists(tx, input.destinationBin, "Destination bin");
    const open = (await tx.dryingBatch.findMany({ where: { lotNo: lot, warehouseSite: row.warehouse }, select: { status: true } })).some((b) => isOpenRound(b.status));
    if (open) throw new ValidationError(`Lot ${lot} is already in drying. Finish that drying (its return and quality check) first.`);
    const sn = ((await tx.dryingBatch.aggregate({ where: { warehouseSite: row.warehouse }, _max: { sn: true } }))._max.sn ?? 0) + 1;
    await tx.dryingBatch.create({
      data: {
        sn, round: 1, dryingDate: new Date(`${date}T00:00:00Z`), dryingDateRaw: date, warehouseSite: row.warehouse,
        warehouse: (stages["n-gate"]?.["WH NO."] ?? "").trim() || null,
        sourceBinNo: blank(input.sourceBin) ? (stages["n-bin"]?.["Bin Number"] ?? null) : input.sourceBin!.trim(),
        destinationBinNo: blank(input.destinationBin) ? null : input.destinationBin!.trim(),
        lotNo: lot, ficheNoRaw: (stages["n-verify"]?.["FICHE"] ?? "").trim() || null,
        supplierNameRaw: row.supplierName || null, supplierCodeRaw: row.lbaCode || null,
        status: DRYING_STATUS.inDrying, dryType: input.dryType!.trim(),
        issuedBags: bags === null ? null : Math.round(bags), issuedNetWeightKg: dec(issuedKg),
        ...qualityColumns(before, "input"),
        startedBy: actor.displayName ?? null, source: "entered",
      },
    });
    // The decision, and the drying step existing: that existence is what makes the truck "in drying" (receiptStatus.ts).
    const a = { id: actor.id, via: "direct" as const };
    await applyBranch(tx, receiptId, "n-drying", route, undefined, { actor: a });
    await applyStageFields(tx, receiptId, "n-drying", { [DECISION_LABEL]: DECISION_BRANCHES["n-drying"]!.find((b) => b.id === route)!.label }, { actor: a });
    await noteOnTimeline(tx, lot, row.warehouse, actor.id, `Lot ${lot} issued for sun drying (round 1): ${issuedKg} kg at ${before.moisture}% moisture`);
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
    await assertBinExists(tx, input.destinationBin, "Destination bin");
    const loss = dryingLoss(issuedKg, returnedKg, null, null);
    const updated = await tx.dryingBatch.update({
      where: { id: batchId },
      data: {
        status: DRYING_STATUS.qualityCheck, returnedAt: new Date(), returnedBy: actor.displayName ?? null,
        receivedBags: bags === null ? null : Math.round(bags), receivedNetWeightKg: dec(returnedKg),
        ...(blank(input.destinationBin) ? {} : { destinationBinNo: input.destinationBin!.trim() }),
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
  const decision = input.decision ?? "";
  if (decision !== "pass" && decision !== "redry") throw new ValidationError("Choose the result of the check: passed, or dry it again.");
  const after = readQuality(input as Record<string, unknown>, "output");
  return prisma.$transaction(async (tx) => {
    const batch = await roundIn(tx, batchId, "quality_check");
    const moistureLoss = dryingLoss(0, 0, num(batch.inputMoisturePct), after.moisture).moistureLossPct;
    const checked = await tx.dryingBatch.update({
      where: { id: batchId },
      data: {
        ...qualityColumns(after, "output"), moistureLossPct: dec(moistureLoss),
        status: decision === "pass" ? DRYING_STATUS.passed : DRYING_STATUS.redry, checkedAt: new Date(), checkedBy: actor.displayName ?? null,
      },
    });
    const round = batch.round ?? 1;
    if (decision === "pass") {
      await noteOnTimeline(tx, batch.lotNo, batch.warehouseSite, actor.id, `Sun drying passed after round ${round}: moisture ${after.moisture}%`);
      return { checked, next: null };
    }
    const sn = ((await tx.dryingBatch.aggregate({ where: { warehouseSite: batch.warehouseSite }, _max: { sn: true } }))._max.sn ?? 0) + 1;
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
  });
}
