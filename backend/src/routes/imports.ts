/**
 * Excel upload: preview (parse + detect + dedup-check, cached under a token) then commit (the
 * bulk write). All real work is in services/imports.ts — see that file's header and
 * docs/UPLOAD_GUIDE.md for the rules being enforced. Errors (ImportRejectedError,
 * ImportTokenError) are mapped to HTTP codes in app.ts's central error handler, not here.
 */
import type { FastifyInstance } from "fastify";
import type { ImporterId } from "../domain/imports/types.js";
import { IMPORTERS } from "../domain/imports/registry.js";
import { listImporterTypes, previewImport, commitImport, ImportRejectedError } from "../services/imports.js";

const KNOWN_IMPORTER_IDS = new Set(IMPORTERS.map((i) => i.id));

export async function importRoutes(app: FastifyInstance) {
  app.get("/api/imports/types", async () => listImporterTypes());

  app.post("/api/imports/preview", async (req) => {
    const file = await req.file();
    if (!file) throw new ImportRejectedError("No file uploaded — expected multipart field \"file\".", null);

    const buffer = await file.toBuffer();
    const importerIdField = file.fields.importerId;
    const importerIdRaw =
      importerIdField && !Array.isArray(importerIdField) && importerIdField.type === "field"
        ? String(importerIdField.value)
        : undefined;
    if (importerIdRaw && !KNOWN_IMPORTER_IDS.has(importerIdRaw as ImporterId)) {
      throw new ImportRejectedError(`Unknown importer type "${importerIdRaw}".`, { known: [...KNOWN_IMPORTER_IDS] });
    }

    return previewImport(buffer, file.filename, importerIdRaw as ImporterId | undefined);
  });

  app.post("/api/imports/:token/commit", async (req) => {
    const { token } = req.params as { token: string };
    const { skipFlagged } = (req.body ?? {}) as { skipFlagged?: boolean };
    return commitImport(token, { skipFlagged: skipFlagged !== false });
  });
}
