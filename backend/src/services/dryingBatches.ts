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

// ── Drying done in the app (client review, Oct 2026: "Drying Yes/No; if Yes a separate form captures the details") ──

import type { ReceiptRecord } from "@anagroci/contract/types/receipt";
import { deriveStatus } from "@anagroci/contract/domain/receiptStatus";
import { dryingLoss, dryingReturnProblem } from "@anagroci/contract/domain/dryingLoss";
import { DECISION_BRANCHES } from "@anagroci/contract/domain/decisions";
import { Prisma } from "@prisma/client";
import { ValidationError, assertDryingJobHasLot } from "../domain/validation.js";
import { applyBranch, applyStageFields, loadReceiptRow } from "./receipts.js";
import { toReceiptRecord } from "../serialize.js";
import { assembleStageData } from "../stageStore.js";

type Actor = { id: string; via: "direct" };
const IN_PROGRESS = "IN PROGRESS";
const COMPLETED = "COMPLETED";
const DECISION_LABEL = "Decision (Direct to drying / Warehouse → Drying)";

export interface StartDryingInput {
  /** "direct" (straight to the drying yard) or "indirect" (via the warehouse): the decision this form answers Yes to. */
  route?: string;
  date?: string;
  sourceBin?: string;
  destinationBin?: string;
  dryType?: string;
  issuedBags?: number | string | null;
  issuedNetKg?: number | string | null;
  inputMoisture?: number | string | null;
  inputKor?: number | string | null;
  inputNutCount?: number | string | null;
}
export interface CompleteDryingInput {
  receivedBags?: number | string | null;
  receivedNetKg?: number | string | null;
  outputMoisture?: number | string | null;
  outputKor?: number | string | null;
  outputNutCount?: number | string | null;
  destinationBin?: string;
}

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
function number(v: unknown, what: string, { required = false, min = 0, max = Infinity }: { required?: boolean; min?: number; max?: number } = {}): number | null {
  if (blank(v)) { if (required) throw new ValidationError(`${what} is required.`); return null; }
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  if (Number.isNaN(n) || n < min || n > max) throw new ValidationError(`${what} must be a number${max !== Infinity ? ` between ${min} and ${max}` : min > 0 ? ` of at least ${min}` : ""}.`);
  return n;
}
const dec = (n: number | null) => (n === null ? null : new Prisma.Decimal(n));

async function assertBinExists(tx: Prisma.TransactionClient, code: string | undefined, what: string) {
  if (blank(code)) return;
  if (!(await tx.bin.findUnique({ where: { code: code!.trim() }, select: { code: true } }))) {
    throw new ValidationError(`${what} "${code}" isn't in the Bin master — add it in Masters › Bins first.`);
  }
}

/**
 * Starts drying for an accepted truck's Lot: answers the drying decision Yes (direct or via the warehouse), writes the drying
 * batch with what is issued (bags, net kg, moisture before), and moves the truck to "in drying". One open batch per Lot: a
 * Lot can't be issued for drying twice at once. A drying is per Lot, never per Bin, as everywhere else.
 */
export async function startDrying(receiptId: string, input: StartDryingInput, actor: { id: string }) {
  const route = input.route ?? "";
  if (!DECISION_BRANCHES["n-drying"]!.some((b) => b.id === route && b.id !== "none")) throw new ValidationError("Choose how the Lot goes to drying: direct, or via the warehouse.");
  if (blank(input.dryType)) throw new ValidationError("Drying type is required.");
  const issuedKg = number(input.issuedNetKg, "Net kg issued for drying", { required: true, min: 0.001 })!;
  const bags = number(input.issuedBags, "Bags issued", { min: 0 });
  const before = number(input.inputMoisture, "Moisture before drying", { required: true, max: 100 })!;
  const date = blank(input.date) ? new Date().toISOString().slice(0, 10) : String(input.date).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) throw new ValidationError("The drying date must be a real date, YYYY-MM-DD.");
  const a: Actor = { id: actor.id, via: "direct" };

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
    if (await tx.dryingBatch.findFirst({ where: { lotNo: lot, status: IN_PROGRESS }, select: { id: true } })) {
      throw new ValidationError(`Lot ${lot} is already in drying. Complete that drying first.`);
    }
    const sn = ((await tx.dryingBatch.aggregate({ where: { warehouseSite: row.warehouse }, _max: { sn: true } }))._max.sn ?? 0) + 1;
    await tx.dryingBatch.create({
      data: {
        sn, dryingDate: new Date(`${date}T00:00:00Z`), dryingDateRaw: date, warehouseSite: row.warehouse,
        warehouse: (stages["n-gate"]?.["WH NO."] ?? "").trim() || null,
        sourceBinNo: blank(input.sourceBin) ? (stages["n-bin"]?.["Bin Number"] ?? null) : input.sourceBin!.trim(),
        destinationBinNo: blank(input.destinationBin) ? null : input.destinationBin!.trim(),
        lotNo: lot, ficheNoRaw: (stages["n-verify"]?.["FICHE"] ?? "").trim() || null,
        supplierNameRaw: row.supplierName || null, supplierCodeRaw: row.lbaCode || null,
        status: IN_PROGRESS, dryType: input.dryType!.trim(),
        issuedBags: bags === null ? null : Math.round(bags), issuedNetWeightKg: dec(issuedKg),
        inputMoisturePct: dec(before), inputKor: dec(number(input.inputKor, "KOR before drying", { max: 80 })), inputNutCount: dec(number(input.inputNutCount, "Nut count before drying")),
        source: "entered",
      },
    });
    // The decision, and the drying step existing: that existence is what makes the truck "in drying" (receiptStatus.ts).
    await applyBranch(tx, receiptId, "n-drying", route, undefined, { actor: a });
    await applyStageFields(tx, receiptId, "n-drying", { [DECISION_LABEL]: DECISION_BRANCHES["n-drying"]!.find((b) => b.id === route)!.label }, { actor: a });
    const fresh = await loadReceiptRow(receiptId, tx);
    await tx.timelineEntry.create({
      data: { receiptId, status: deriveStatus(toReceiptRecord(fresh!) as ReceiptRecord), at: new Date().toISOString(), actorId: actor.id, note: `Lot ${lot} issued for drying: ${issuedKg} kg` },
    });
  });
  return toReceiptRecord((await loadReceiptRow(receiptId))!);
}

/**
 * Completes a drying: what came back (bags, net kg, moisture after). The loss in kg, in per cent and in moisture points is
 * worked out here from the issued and returned figures (contract domain/dryingLoss.ts), never typed.
 */
export async function completeDrying(batchId: string, input: CompleteDryingInput) {
  const batch = await prisma.dryingBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw Object.assign(new Error("Drying batch not found"), { code: "P2025" });
  if (!/progress/i.test(batch.status ?? "")) throw new ValidationError("This drying is already completed.");
  const returnedKg = number(input.receivedNetKg, "Dried quantity returned (kg)", { required: true })!;
  const after = number(input.outputMoisture, "Moisture after drying", { required: true, max: 100 })!;
  const issuedKg = Number(batch.issuedNetWeightKg ?? 0);
  const problem = dryingReturnProblem(issuedKg, returnedKg);
  if (problem) throw new ValidationError(problem);
  const bags = number(input.receivedBags, "Bags returned", { min: 0 });
  await assertBinExists(prisma, input.destinationBin, "Destination bin");
  const loss = dryingLoss(issuedKg, returnedKg, batch.inputMoisturePct === null ? null : Number(batch.inputMoisturePct), after);
  return prisma.dryingBatch.update({
    where: { id: batchId },
    data: {
      status: COMPLETED,
      receivedBags: bags === null ? null : Math.round(bags), receivedNetWeightKg: dec(returnedKg),
      outputMoisturePct: dec(after), outputKor: dec(number(input.outputKor, "KOR after drying", { max: 80 })), outputNutCount: dec(number(input.outputNutCount, "Nut count after drying")),
      ...(blank(input.destinationBin) ? {} : { destinationBinNo: input.destinationBin!.trim() }),
      dryingLossKg: dec(loss.lossKg), dryingLossPct: dec(loss.lossPct), moistureLossPct: dec(loss.moistureLossPct),
    },
  });
}
