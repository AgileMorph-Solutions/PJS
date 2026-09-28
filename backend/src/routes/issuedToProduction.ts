import type { FastifyInstance } from "fastify";
import { listIssuedToProduction } from "../services/issuedToProduction.js";

export async function issuedToProductionRoutes(app: FastifyInstance) {
  app.get("/api/issued-to-production", async () => listIssuedToProduction());
}
