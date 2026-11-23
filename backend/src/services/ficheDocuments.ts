/**
 * A truck's CCA fiche: the uploaded photo or scan, kept on its receipt, and what the reader made of it (services/ficheReader.ts).
 * On upload (or a new read) the fiche's values fill the Verify supplier documents step, over what was there, as the uploader's
 * own edit through the same write every form uses; what each field held before is kept with the fiche (contract ficheFill).
 */
import {
  FICHE_FILE_TYPES, FICHE_MAX_BYTES, FICHE_STAGE, ficheBytesMatchType, ficheFill, ficheOriginHint, ficheSuggestions, normalizeBuyerCode, supplierForBuyerCode,
  type FicheReading, type FicheView,
} from "@anagroci/contract/domain/fiche";
import { Prisma } from "@prisma/client";
import { LOCKED_MESSAGE } from "@anagroci/contract/domain/recordLock";
import { prisma } from "../db.js";
import { ValidationError } from "../domain/validation.js";
import { FicheReadError, readFicheWithClaude, type FicheReader } from "./ficheReader.js";
import { getReceipt, setStageFields } from "./receipts.js";
import type { Role } from "@anagroci/contract/data/roles";

/** Who uploaded: the fields the fiche fills are saved as their edit (logged against them, like typing). */
export interface FicheActor { id: string; role?: Role }

/**
 * Puts the fiche's values into the step and says which, keeping what each changed field held before. A new upload starts
 * that record afresh; a new read of the same fiche adds to it, so a value replaced by the first read isn't lost. A save the
 * step refuses (it isn't open yet, say) leaves the fields as they were: the fiche is still kept and its values still offered
 * beside each field.
 */
async function fillFromFiche(receiptId: string, view: FicheView, actor: FicheActor, earlier: Record<string, string> = {}): Promise<FicheView> {
  const current = (await getReceipt(receiptId))?.stageData[FICHE_STAGE];
  const { fill, replaced } = ficheFill(view.suggestions, view.originHint, current);
  if (!Object.keys(fill).length) return { ...view, filled: [] };
  try {
    await setStageFields(receiptId, FICHE_STAGE, fill, { actor: { id: actor.id, via: "direct", role: actor.role } });
  } catch (e) {
    if (e instanceof ValidationError) return { ...view, filled: [] };
    throw e;
  }
  const kept = { ...earlier, ...replaced };
  await prisma.ficheDocument.update({ where: { receiptId }, data: { replaced: Object.keys(kept).length ? kept : Prisma.DbNull } });
  return { ...view, filled: Object.keys(fill), replaced: kept };
}

const asReplaced = (v: unknown): Record<string, string> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {});

const META = {
  receiptId: true, fileName: true, mimeType: true, sizeBytes: true, uploadedAt: true, reading: true, readAt: true, readError: true, replaced: true,
  uploadedBy: { select: { displayName: true } },
} as const;

type MetaRow = Awaited<ReturnType<typeof prisma.ficheDocument.findFirstOrThrow<{ select: typeof META }>>>;

/** The supplier the fiche's buyer code belongs to, from the trucks already recorded with that code (never this one). */
async function supplierForCode(receiptId: string, reading: FicheReading | null): Promise<string | undefined> {
  const code = normalizeBuyerCode(reading?.buyerCode);
  if (!code || !reading?.isCcaTransferFiche) return undefined;
  const [pastTrucks, suppliers] = await Promise.all([
    prisma.stageVerifyDocs.findMany({ where: { ficheCode: code, receiptId: { not: receiptId } }, select: { lbaCode: true } }),
    prisma.supplier.findMany({ select: { code: true, name: true, status: true } }),
  ]);
  return supplierForBuyerCode(pastTrucks, suppliers);
}

async function toView(receiptId: string, row: MetaRow | null): Promise<FicheView> {
  if (!row) return { document: null, suggestions: {}, originHint: null, replaced: {} };
  const reading = (row.reading ?? null) as FicheReading | null;
  const origins = reading?.isCcaTransferFiche ? (await prisma.origin.findMany({ select: { name: true } })).map((o) => o.name) : [];
  return {
    document: {
      fileName: row.fileName, mimeType: row.mimeType, sizeBytes: row.sizeBytes, uploadedAt: row.uploadedAt.toISOString(),
      uploadedBy: row.uploadedBy?.displayName ?? null, reading, readAt: row.readAt?.toISOString() ?? null, readError: row.readError,
    },
    suggestions: ficheSuggestions(reading, await supplierForCode(receiptId, reading)),
    // Beside Origin: a town in Masters › Origins is filled in; a place that isn't is only added there by the person.
    originHint: ficheOriginHint(reading, origins),
    replaced: asReplaced(row.replaced),
  };
}

export async function getFiche(receiptId: string): Promise<FicheView> {
  return toView(receiptId, await prisma.ficheDocument.findUnique({ where: { receiptId }, select: META }));
}

/** The file itself, for the browser to show. */
export async function getFicheFile(receiptId: string) {
  return prisma.ficheDocument.findUnique({ where: { receiptId }, select: { fileName: true, mimeType: true, data: true } });
}

/** Read the file; a failure becomes the message kept beside it, never a failed upload. */
async function read(reader: FicheReader, data: Buffer, mimeType: string) {
  try {
    const { reading, model } = await reader({ data, mimeType });
    return { reading: reading as unknown as Prisma.InputJsonObject, readModel: model, readError: null, readAt: new Date() };
  } catch (e) {
    if (!(e instanceof FicheReadError)) throw e;
    return { reading: undefined, readModel: null, readError: e.message, readAt: null };
  }
}

async function assertNotLocked(receiptId: string) {
  const r = await prisma.receipt.findUnique({ where: { id: receiptId }, select: { lockedAt: true } });
  // The fiche is part of the reception record the GRN locks (contract domain/recordLock.ts): no replacing it after.
  if (r?.lockedAt) throw new ValidationError(LOCKED_MESSAGE);
}

export interface FicheUpload { fileName: string; mimeType: string; data: Buffer }

/** Keeps the fiche on the receipt (replacing any earlier one) and reads it. */
export async function uploadFiche(receiptId: string, file: FicheUpload, actor: FicheActor, reader: FicheReader = readFicheWithClaude): Promise<FicheView> {
  if (!FICHE_FILE_TYPES[file.mimeType]) throw new ValidationError(`A fiche can be a ${Object.values(FICHE_FILE_TYPES).join(", ")} file, not ${file.mimeType || "this type"}.`);
  if (file.data.length === 0) throw new ValidationError("The file is empty.");
  if (file.data.length > FICHE_MAX_BYTES) throw new ValidationError(`The file is over ${FICHE_MAX_BYTES / 1024 / 1024} MB. Take the photo again at a lower size, or scan it as a PDF.`);
  if (!ficheBytesMatchType(file.data, file.mimeType)) throw new ValidationError(`The file isn't a real ${FICHE_FILE_TYPES[file.mimeType]}.`);
  await assertNotLocked(receiptId);

  const result = await read(reader, file.data, file.mimeType);
  // A new file replaces the old one whole: an upload that couldn't be read must not keep the previous file's reading.
  const data = {
    fileName: file.fileName.slice(0, 200) || "fiche", mimeType: file.mimeType, sizeBytes: file.data.length, data: new Uint8Array(file.data),
    uploadedAt: new Date(), uploadedById: actor.id,
    reading: result.reading ?? Prisma.DbNull, readModel: result.readModel, readError: result.readError, readAt: result.readAt,
    replaced: Prisma.DbNull,
  };
  const row = await prisma.ficheDocument.upsert({ where: { receiptId }, create: { receiptId, ...data }, update: data, select: META });
  return fillFromFiche(receiptId, await toView(receiptId, row), actor);
}

/** Reads the kept file again — after a failed read (no key yet, reader busy). */
export async function rereadFiche(receiptId: string, actor: FicheActor, reader: FicheReader = readFicheWithClaude): Promise<FicheView | null> {
  const file = await prisma.ficheDocument.findUnique({ where: { receiptId }, select: { data: true, mimeType: true } });
  if (!file) return null;
  await assertNotLocked(receiptId);
  const result = await read(reader, Buffer.from(file.data), file.mimeType);
  // A failed read keeps what an earlier read found and only says why this one failed.
  const data = result.reading
    ? { reading: result.reading, readModel: result.readModel, readError: null, readAt: result.readAt }
    : { readError: result.readError };
  const view = await toView(receiptId, await prisma.ficheDocument.update({ where: { receiptId }, data, select: META }));
  return result.reading ? fillFromFiche(receiptId, view, actor, view.replaced) : view;
}
