/**
 * The ANAGROCI workbook: ONE .xlsx in our own table format, used for both Export and Upload (see
 * domain/workbook/). Warehouse Incharge / admin only — auth/policy.ts is default-deny for the other
 * roles. The section is one warehouse: a Warehouse Incharge's own, an admin names one.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { currentUser } from "../auth/plugin.js";
import { scopedWarehouse } from "../auth/scope.js";
import { ValidationError } from "../domain/validation.js";
import { parseDateRange } from "../domain/workbook/dateFilter.js";
import { sheetsFor } from "../domain/workbook/sheets.js";
import { commitWorkbook, downloadWorkbook, previewWorkbook, sectionFor } from "../services/workbook.js";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function sectionOf(req: FastifyRequest, warehouse?: string) {
  const wh = scopedWarehouse(req, warehouse) ?? warehouse;
  // An admin has no warehouse of their own, so they say which section the workbook is for.
  if (!wh) throw new ValidationError("Choose a warehouse — an admin's workbook is for one warehouse at a time.");
  return sectionFor(wh);
}

export async function workbookRoutes(app: FastifyInstance) {
  /** Which sheets this section's workbook carries — what differs between Unit and Central — and the
   * date each dated sheet filters on, for the dialog to list. */
  app.get("/api/workbook/info", async (req) => {
    const { warehouse } = req.query as { warehouse?: string };
    const section = await sectionOf(req, warehouse);
    return {
      warehouse: section.warehouse,
      type: section.type,
      sheets: sheetsFor(section.type).map((s) => ({ name: s.title, master: Boolean(s.master), dateLabel: s.dateField?.label ?? null })),
    };
  });

  /** `?from=&to=` (inclusive, either optional) narrows each dated sheet to its own date column; rows
   * with no usable date are left out under a range and counted in `X-Rows-Without-Date`. */
  app.get("/api/workbook", async (req, reply) => {
    const { warehouse, from, to } = req.query as { warehouse?: string; from?: string; to?: string };
    const range = parseDateRange(from, to);
    const built = await downloadWorkbook(await sectionOf(req, warehouse), range, false, currentUser(req).role);
    return reply
      .header("Content-Type", XLSX)
      .header("Content-Disposition", `attachment; filename="${built.filename}"`)
      .header("X-Rows-Exported", String(built.exported))
      .header("X-Rows-Without-Date", String(built.withoutDate))
      .send(built.buffer);
  });

  /** The same workbook with headers only — what Upload offers as its blank template. */
  app.get("/api/workbook/template", async (req, reply) => {
    const { warehouse } = req.query as { warehouse?: string };
    const built = await downloadWorkbook(await sectionOf(req, warehouse), {}, true, currentUser(req).role);
    return reply
      .header("Content-Type", XLSX)
      .header("Content-Disposition", `attachment; filename="${built.filename}"`)
      .send(built.buffer);
  });

  /** Multipart `file` (+ optional `warehouse` field for an admin). Writes nothing: returns what
   * would be created / changed / left alone, and any problems, under a token to commit. */
  app.post("/api/workbook/preview", async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'No file uploaded — expected multipart field "file".' });
    const buffer = await file.toBuffer();
    const field = file.fields.warehouse;
    const warehouse = field && !Array.isArray(field) && field.type === "field" ? String(field.value) : undefined;
    const user = currentUser(req);
    return previewWorkbook(user, await sectionOf(req, warehouse), buffer, file.filename);
  });

  /** All or nothing: re-checked and written in one transaction. */
  app.post("/api/workbook/:token/commit", async (req) => {
    const { token } = req.params as { token: string };
    return commitWorkbook(currentUser(req), token);
  });
}
