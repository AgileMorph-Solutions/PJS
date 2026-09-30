// New — the frontend's Drying Jobs page (frontend/src/pages/procurement/DryingJobsPage.tsx)
// currently only reads the static seed (frontend/src/repository/dryingRepo.ts loads
// dryingJobs.json read-only; there's no "create a drying job" flow client-side yet). This adds
// the persistence + the one rule the clarification is explicit about: a drying job always names
// a specific Lot, never just a Bin.
import type { FastifyInstance } from "fastify";
import { listDryingJobs, createDryingJob, type NewDryingJob } from "../services/drying.js";
import { ValidationError } from "../domain/validation.js";
import { scopedSite } from "../auth/scope.js";

export async function dryingRoutes(app: FastifyInstance) {
  app.get("/api/drying-jobs", async (req) => {
    const { warehouse } = req.query as { warehouse?: string };
    return listDryingJobs(await scopedSite(req, warehouse));
  });

  app.post("/api/drying-jobs", async (req, reply) => {
    try {
      return reply.code(201).send(await createDryingJob(req.body as NewDryingJob));
    } catch (e) {
      if (e instanceof ValidationError) return reply.code(422).send({ error: e.message });
      throw e;
    }
  });
}
