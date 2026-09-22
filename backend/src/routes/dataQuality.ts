/**
 * The data-quality audit. Ground rule §4: surface what's wrong with the real data, don't quietly
 * normalise it away. Findings are aggregate and never block anything.
 */
import type { FastifyInstance } from "fastify";
import { scanAll } from "../domain/dataQuality/index.js";

export async function dataQualityRoutes(app: FastifyInstance) {
  app.get("/api/data-quality", async () => scanAll());
}
