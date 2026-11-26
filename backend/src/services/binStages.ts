/**
 * A Bin's own ledgers on its Warehouse activities page: "Other warehouse activities" and "Activity ledger (sequence of
 * record)" — the truck's per-Lot steps n-otheract and n-ledger, kept for the Bin since warehouse activities moved to Bins
 * (team, 23 Nov 2026). Each is a ledger of entries (26 Nov 2026, user: "multiple entries in a table"), independent of the other.
 * The fields are the stages.ts fields, by label, so the page draws them with the same StageForm a truck's step uses.
 */
import { stages } from "@anagroci/contract/data/stages";
import { autoFill } from "@anagroci/contract/data/autoFields";
import { BIN_DRYING_DECISION_KEY, BIN_STAGE_IDS, isBinStage, type BinActivityEntryView, type BinDryingAnswer, type BinDryingDecision, type BinStageId } from "@anagroci/contract/domain/warehouseActivityStages";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { ValidationError } from "../domain/validation.js";
import { siteOf } from "./ids.js";
import { binSiteProblem } from "./binStock.js";

type Actor = { id: string; displayName?: string };

const asValues = (v: unknown): Record<string, string> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {});

const include = { enteredBy: { select: { displayName: true } }, editedBy: { select: { displayName: true } } } as const;
type EntryRow = Prisma.BinActivityEntryGetPayload<{ include: typeof include }>;
const toView = (r: EntryRow): BinActivityEntryView => ({
  id: r.id, stageId: r.stageId as BinStageId, values: asValues(r.values),
  enteredBy: r.enteredBy?.displayName ?? null, enteredAt: r.enteredAt.toISOString(),
  editedBy: r.editedBy?.displayName ?? null, editedAt: r.editedAt.toISOString(),
});

/** The Bin's entries of each of its two ledgers, most recent first. */
export async function binActivityEntries(binCode: string): Promise<Record<BinStageId, BinActivityEntryView[]>> {
  const rows = await prisma.binActivityEntry.findMany({ where: { binCode }, include, orderBy: [{ enteredAt: "desc" }, { id: "desc" }] });
  const out = Object.fromEntries(BIN_STAGE_IDS.map((id) => [id, [] as BinActivityEntryView[]])) as Record<BinStageId, BinActivityEntryView[]>;
  for (const r of rows) if (isBinStage(r.stageId)) out[r.stageId].push(toView(r));
  return out;
}

/**
 * Only the form's own fields (stages.ts), each kept as typed (trimmed): the field rules only warn, in the form. A new entry
 * needs a value; a change may also empty a field.
 */
function readFields(stageId: string, fields: Record<string, unknown>, change = false) {
  if (!isBinStage(stageId)) throw new ValidationError(`"${stageId}" isn't one of a Bin's forms.`);
  const stage = stages.find((s) => s.id === stageId)!;
  const given: Record<string, string> = {};
  for (const [label, value] of Object.entries(fields ?? {})) {
    if (!stage.fields.some((f) => f.n === label)) throw new ValidationError(`"${label}" isn't part of ${stage.title}.`);
    given[label] = String(value ?? "").trim();
  }
  if (change ? !Object.keys(given).length : !Object.values(given).some((v) => v !== "")) throw new ValidationError("Nothing to save: fill in at least one field.");
  return given;
}

/** The Bin, when it is this warehouse's; refused otherwise (it has no warehouse yet, or another warehouse's). */
async function binHere(names: readonly string[], binCode: string) {
  const code = binCode.trim().toUpperCase();
  const notHere = await binSiteProblem(names, code);
  if (notHere) throw new ValidationError(notHere);
  const bin = await prisma.bin.findUnique({ where: { code }, select: { warehouseName: true } });
  return { code, warehouseName: bin!.warehouseName! };
}

/**
 * Adds an entry to one of the Bin's ledgers. The ledger's date, place, Bin and who fill themselves when left blank, as they do
 * on a truck (contract data/autoFields.ts).
 */
export async function addBinActivityEntry(names: readonly string[], binCode: string, stageId: string, fields: Record<string, unknown>, actor: Actor) {
  const given = readFields(stageId, fields);
  const bin = await binHere(names, binCode);
  const filled = autoFill(stageId, given, {}, {
    today: new Date().toISOString().slice(0, 10), arrivalDate: "",
    site: (await siteOf(prisma, bin.warehouseName)) ?? bin.warehouseName, bin: bin.code, actorName: actor.displayName,
  });
  const row = await prisma.binActivityEntry.create({
    data: { binCode: bin.code, stageId, values: { ...given, ...filled } as Prisma.InputJsonObject, enteredById: actor.id, editedById: actor.id },
    include,
  });
  return toView(row);
}

/** Changes the fields given of one of the Bin's entries; the rest stay as they were. */
export async function updateBinActivityEntry(names: readonly string[], binCode: string, entryId: number, fields: Record<string, unknown>, actor: Actor) {
  const bin = await binHere(names, binCode);
  const row = await prisma.binActivityEntry.findUnique({ where: { id: entryId } });
  if (!row || row.binCode !== bin.code) throw new ValidationError(`Entry ${entryId} isn't one of Bin ${bin.code}'s.`);
  const given = readFields(row.stageId, fields, true);
  const updated = await prisma.binActivityEntry.update({
    where: { id: entryId },
    data: { values: { ...asValues(row.values), ...given } as Prisma.InputJsonObject, editedById: actor.id },
    include,
  });
  return toView(updated);
}

/** The Bin's answer to "Does this Bin need drying?", or null while nobody has answered. */
export async function binDryingDecision(binCode: string): Promise<BinDryingDecision | null> {
  const row = await prisma.binStageEntry.findUnique({
    where: { binCode_stageId: { binCode, stageId: BIN_DRYING_DECISION_KEY } },
    include: { editedBy: { select: { displayName: true } } },
  });
  const answer = asValues(row?.values).answer;
  return row && (answer === "yes" || answer === "no") ? { answer, by: row.editedBy?.displayName ?? null, at: row.editedAt.toISOString() } : null;
}

/** Answer "Does this Bin need drying?" (or change the answer). The change log keeps every answer given. */
export async function setBinDryingDecision(names: readonly string[], binCode: string, answer: unknown, actor: Actor) {
  const code = binCode.trim().toUpperCase();
  if (answer !== "yes" && answer !== "no") throw new ValidationError('Answer "yes" or "no".');
  const notHere = await binSiteProblem(names, code);
  if (notHere) throw new ValidationError(notHere);
  const values = { answer: answer as BinDryingAnswer } as Prisma.InputJsonObject;
  await prisma.binStageEntry.upsert({
    where: { binCode_stageId: { binCode: code, stageId: BIN_DRYING_DECISION_KEY } },
    create: { binCode: code, stageId: BIN_DRYING_DECISION_KEY, values, enteredById: actor.id, editedById: actor.id },
    update: { values, editedById: actor.id },
  });
}
