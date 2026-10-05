/**
 * Excel upload: preview (parse + detect + dedup-check, cached under a token) then commit (the
 * bulk write). All real work is in services/imports.ts — see that file's header and
 * docs/UPLOAD_GUIDE.md for the rules being enforced. Errors (ImportRejectedError,
 * ImportTokenError) are mapped to HTTP codes in app.ts's central error handler, not here.
 */
import type { FastifyInstance } from "fastify";
import type { ImporterId } from "../domain/imports/types.js";
import { IMPORTERS, getImporter } from "../domain/imports/registry.js";
import { listImporterTypes, previewImport, commitImport, ImportRejectedError } from "../services/imports.js";
import { buildTemplateWorkbook } from "../domain/imports/xlsxWriter.js";
import { scopedWarehouse } from "../auth/scope.js";

const KNOWN_IMPORTER_IDS = new Set(IMPORTERS.map((i) => i.id));

function requireKnownImporter(id: string): ImporterId {
  if (!KNOWN_IMPORTER_IDS.has(id as ImporterId)) {
    throw new ImportRejectedError(`Unknown importer type "${id}".`, { known: [...KNOWN_IMPORTER_IDS] });
  }
  return id as ImporterId;
}

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

    // The warehouse this file is for — a Warehouse Incharge's own, an admin's pick. It decides the
    // code printed into the IDs, and rows naming another warehouse are flagged in the preview.
    const warehouseField = file.fields.warehouse;
    const warehouseRaw =
      warehouseField && !Array.isArray(warehouseField) && warehouseField.type === "field" ? String(warehouseField.value) : undefined;
    const warehouse = scopedWarehouse(req, warehouseRaw);

    return previewImport(buffer, file.filename, importerIdRaw as ImporterId | undefined, warehouse);
  });

  app.post("/api/imports/:token/commit", async (req) => {
    const { token } = req.params as { token: string };
    const { skipFlagged } = (req.body ?? {}) as { skipFlagged?: boolean };
    return commitImport(token, { skipFlagged: skipFlagged !== false });
  });

  /** A blank workbook matching one importer's expected shape — same sheet name/header row/labels
   * it would itself accept back, so filling it in and re-uploading always works. */
  app.get("/api/imports/:id/template", async (req, reply) => {
    const { id } = req.params as { id: string };
    const importerId = requireKnownImporter(id);
    const def = getImporter(importerId);
    const buffer = await buildTemplateWorkbook(importerId);
    reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", `attachment; filename="${def.expectedSheet} template.xlsx"`)
      .send(buffer);
  });
  // Exporting current data is not here: it follows our tables, not the client's workbook shapes —
  // see routes/exports.ts.
}
