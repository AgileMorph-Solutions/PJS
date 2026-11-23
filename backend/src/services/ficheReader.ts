/**
 * Reads a CCA fiche (Fiche de Transfert) photo or scan with Claude and returns what it says, as read (contract
 * domain/fiche.ts FicheReading). The only place the app talks to the Claude API.
 *
 * Plain text recognition can't read the fiche: nearly every value on it is handwritten in capitals. A model that reads the
 * whole form knows which box is which and returns the values already split into fields, and is told to leave a value blank
 * rather than guess — the person checks every value before it is saved anyway.
 *
 * Needs ANTHROPIC_API_KEY in the backend's environment (docker-compose passes it from the root .env). Without it the file
 * is still kept on the receipt; only the reading is skipped.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaJSONSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import type { FicheReading } from "@anagroci/contract/domain/fiche";

/** The strongest reader of messy handwriting; one fiche is one image, so a read costs about a cent. */
export const FICHE_READER_MODEL = "claude-opus-5-5";

/** Why a fiche wasn't read, in words the warehouse can act on. Stored on the document and shown beside it. */
export class FicheReadError extends Error {}

const READING_SCHEMA = {
  type: "object",
  properties: {
    isCcaTransferFiche: { type: "boolean" },
    ficheNumber: { type: "string" },
    buyerCode: { type: "string" },
    storeName: { type: "string" },
    subPrefecture: { type: "string" },
    department: { type: "string" },
    village: { type: "string" },
    unclear: { type: "string" },
  },
  required: ["isCcaTransferFiche", "ficheNumber", "buyerCode", "storeName", "subPrefecture", "department", "village", "unclear"],
  additionalProperties: false,
} as const;

// Field positions are described the way they appear on the printed form (the client's sample, 00076601), so the model looks
// in the right box rather than at the first number it sees. The handwritten "Destination produit" half is filled in by
// ANAGROCI at unloading and is deliberately left out.
const INSTRUCTIONS = `This should be a "FICHE DE TRANSFERT" issued by "Le Conseil du Coton et de l'Anacarde" (Côte d'Ivoire), a printed form filled in by hand.

Return these values exactly as written on the document:
- isCcaTransferFiche: true only if the document is a Conseil du Coton et de l'Anacarde "Fiche de Transfert". Other forms (for example an ANAGROCI "Fiche de déchargement" or "Bordereau de déchargement") are false.
- ficheNumber: the serial number printed in red at the top right, under "CAMPAGNE", digits only, with any leading zeros.
- buyerCode: the code written in the "CODE DE L'ACHETEUR" box, in the section "INFORMATIONS SUR L'ACHETEUR" — usually two groups of four digits like 0201-0004. Only the code, not any text written after it.
- storeName: the value in "NOM DU MAGASIN" in the section "INFORMATIONS SUR L'ACHETEUR".
- subPrefecture, department, village: the values in "SOUS PREFECTURE", "DEPARTEMENT" and "VILLAGE", in the section "ORIGINE DU PRODUIT".
- unclear: a short note of anything you could not read with confidence; empty if everything was clear.

If a value is missing, crossed out or not clearly legible, return "" for it. Never guess a digit. If the document is not a Fiche de Transfert, return "" for every value.`;

export interface FicheFile { data: Buffer; mimeType: string }

export interface FicheReadResult { reading: FicheReading; model: string }

/** A reader the service can swap in tests; the real one calls Claude. */
export type FicheReader = (file: FicheFile) => Promise<FicheReadResult>;

// Claude takes an image of up to 5 MB; a PDF goes in as a document. Phone photos are shrunk in the browser well below this.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const readFicheWithClaude: FicheReader = async ({ data, mimeType }) => {
  if (!process.env.ANTHROPIC_API_KEY) throw new FicheReadError("Fiche reading isn't set up on this server (no ANTHROPIC_API_KEY). The file is kept; fill in the fields by hand.");
  if (mimeType !== "application/pdf" && data.length > MAX_IMAGE_BYTES) {
    throw new FicheReadError("This photo is too large to read (over 5 MB). The file is kept; upload a smaller photo to have it read.");
  }
  const base64 = data.toString("base64");
  const fileBlock = mimeType === "application/pdf"
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 } }
    : { type: "image" as const, source: { type: "base64" as const, media_type: mimeType as "image/jpeg" | "image/png" | "image/webp", data: base64 } };

  const client = new Anthropic();
  let response;
  try {
    response = await client.beta.messages.parse({
      model: FICHE_READER_MODEL,
      max_tokens: 16000,
      // If the model declines, the API re-runs the same request on a fallback model inside the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaJSONSchemaOutputFormat(READING_SCHEMA) },
      messages: [{ role: "user", content: [fileBlock, { type: "text", text: INSTRUCTIONS }] }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new FicheReadError("The fiche reader's API key was refused. The file is kept; fill in the fields by hand.");
    if (e instanceof Anthropic.RateLimitError) throw new FicheReadError("The fiche reader is busy. The file is kept; try reading it again in a minute.");
    if (e instanceof Anthropic.BadRequestError) throw new FicheReadError(`The fiche reader couldn't take this file (${e.message}). The file is kept.`);
    if (e instanceof Anthropic.APIError) throw new FicheReadError(`The fiche reader failed (${e.status ?? "no response"}). The file is kept; try reading it again.`);
    throw e;
  }
  if (response.stop_reason === "refusal") throw new FicheReadError("The fiche reader declined this file. The file is kept; fill in the fields by hand.");
  if (response.stop_reason === "max_tokens" || !response.parsed_output) throw new FicheReadError("The fiche reader gave no usable answer. The file is kept; try reading it again.");
  return { reading: response.parsed_output as FicheReading, model: response.model };
};
