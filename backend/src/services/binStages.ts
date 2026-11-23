/**
 * A Bin's own forms on its Warehouse activities page (team, 23 Nov 2026): "Other warehouse activities" and "Activity ledger
 * (sequence of record)" — the truck's per-Lot steps n-otheract and n-ledger, filled in for the Bin since warehouse
 * activities moved to Bins. The two are independent: each is its own form, saved on its own. The fields are the stages.ts
 * fields, by label, so the page draws them with the same StageForm a truck's step uses.
 */
import { stages } from "@anagroci/contract/data/stages";
import { autoFill } from "@anagroci/contract/data/autoFields";
import { BIN_STAGE_IDS, isBinStage, type BinStageId, type BinStageView } from "@anagroci/contract/domain/warehouseActivityStages";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { ValidationError } from "../domain/validation.js";
import { siteOf } from "./ids.js";
import { binSiteProblem } from "./binStock.js";

type Actor = { id: string; displayName?: string };

const asValues = (v: unknown): Record<string, string> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {});

/** The Bin's two forms as they stand: null for one nobody has filled in yet. */
export async function binStages(binCode: string): Promise<Record<BinStageId, BinStageView | null>> {
  const rows = await prisma.binStageEntry.findMany({
    where: { binCode },
    include: { enteredBy: { select: { displayName: true } }, editedBy: { select: { displayName: true } } },
  });
  const out = Object.fromEntries(BIN_STAGE_IDS.map((id) => [id, null])) as Record<BinStageId, BinStageView | null>;
  for (const r of rows) {
    if (!isBinStage(r.stageId)) continue;
    out[r.stageId] = {
      values: asValues(r.values),
      enteredBy: r.enteredBy?.displayName ?? null, enteredAt: r.enteredAt.toISOString(),
      editedBy: r.editedBy?.displayName ?? null, editedAt: r.editedAt.toISOString(),
    };
  }
  return out;
}

/**
 * Saves fields of one of the Bin's forms. Only that form's own fields (stages.ts); a value is kept as typed (trimmed) — the
 * field rules only warn, in the form. The ledger's date, place, Bin and who fill themselves when left blank, as they do on a
 * truck (contract data/autoFields.ts).
 */
export async function setBinStageFields(names: readonly string[], binCode: string, stageId: string, fields: Record<string, unknown>, actor: Actor) {
  const code = binCode.trim().toUpperCase();
  if (!isBinStage(stageId)) throw new ValidationError(`"${stageId}" isn't one of a Bin's forms.`);
  const stage = stages.find((s) => s.id === stageId)!;
  const notHere = await binSiteProblem(names, code);
  if (notHere) throw new ValidationError(notHere);
  const bin = await prisma.bin.findUnique({ where: { code }, select: { warehouseName: true } });

  const given: Record<string, string> = {};
  for (const [label, value] of Object.entries(fields ?? {})) {
    if (!stage.fields.some((f) => f.n === label)) throw new ValidationError(`"${label}" isn't part of ${stage.title}.`);
    given[label] = String(value ?? "").trim();
  }
  if (!Object.keys(given).length) throw new ValidationError("Nothing to save.");

  return prisma.$transaction(async (tx) => {
    const row = await tx.binStageEntry.findUnique({ where: { binCode_stageId: { binCode: code, stageId } }, select: { values: true } });
    const existing = asValues(row?.values);
    const filled = autoFill(stageId, given, existing, {
      today: new Date().toISOString().slice(0, 10), arrivalDate: "",
      site: (await siteOf(tx, bin!.warehouseName!)) ?? bin!.warehouseName!, bin: code, actorName: actor.displayName,
    });
    const values = { ...existing, ...given, ...filled } as Prisma.InputJsonObject;
    await tx.binStageEntry.upsert({
      where: { binCode_stageId: { binCode: code, stageId } },
      create: { binCode: code, stageId, values, enteredById: actor.id, editedById: actor.id },
      update: { values, editedById: actor.id },
    });
  });
}
