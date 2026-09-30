import type { FastifyInstance } from "fastify";
import { listDryingSortingReports } from "../services/dryingSortingReports.js";
import { scopedSite } from "../auth/scope.js";

export async function dryingSortingReportRoutes(app: FastifyInstance) {
  app.get("/api/drying-sorting-reports", async (req) => {
    const { warehouse } = req.query as { warehouse?: string };
    return listDryingSortingReports(await scopedSite(req, warehouse));
  });
}
