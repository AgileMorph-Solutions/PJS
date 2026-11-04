/**
 * The production workbook (services/productionWorkbook.ts): the same four routes as Reception's workbook
 * (routes/workbook.ts), for the factory site the caller works at. Admin and Warehouse Incharge only:
 * auth/policy.ts closes them to every other role by default, and a QFS Officer's moisture check keeps going
 * through the screen, where the Incharge approves it.
 */
import type { FastifyInstance } from "fastify";
import { currentUser } from "../auth/plugin.js";
import { scopedWarehouse } from "../auth/scope.js";
import { parseDateRange } from "../domain/workbook/dateFilter.js";
import { productionSite } from "../services/production/batches.js";
import {
  commitProductionWorkbook, downloadProductionWorkbook, previewProductionWorkbook, productionWorkbookInfo,
} from "../services/productionWorkbook.js";
import { siteFor } from "./productionBatches.js";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function productionWorkbookRoutes(app: FastifyInstance) {
  app.get("/api/production/workbook/info", async (req) => productionWorkbookInfo(await siteFor(req)));

  app.get("/api/production/workbook", async (req, reply) => {
    const { from, to, blank } = req.query as { from?: string; to?: string; blank?: string };
    const built = await downloadProductionWorkbook(await siteFor(req), blank === "1" ? {} : parseDateRange(from, to), blank === "1");
    return reply
      .header("Content-Type", XLSX)
      .header("Content-Disposition", `attachment; filename="${built.filename}"`)
      .header("X-Rows-Exported", String(built.exported))
      .header("X-Rows-Without-Date", String(built.withoutDate))
      .send(built.buffer);
  });

  /** Multipart `file` (+ optional `warehouse` field for an admin). Writes nothing; answers under a token to apply. */
  app.post("/api/production/workbook/preview", async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'No file uploaded — expected multipart field "file".' });
    const buffer = await file.toBuffer();
    const field = file.fields.warehouse;
    const warehouse = field && !Array.isArray(field) && field.type === "field" ? String(field.value) : undefined;
    const site = await productionSite(scopedWarehouse(req, warehouse) ?? warehouse);
    return previewProductionWorkbook(currentUser(req), site, buffer, file.filename);
  });

  app.post("/api/production/workbook/:token/commit", async (req) => {
    const { token } = req.params as { token: string };
    return commitProductionWorkbook(currentUser(req), token);
  });
}
