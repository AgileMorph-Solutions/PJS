// New — the frontend's Drying Jobs page (frontend/src/pages/procurement/DryingJobsPage.tsx)
// currently only reads the static seed (frontend/src/repository/dryingRepo.ts loads
// dryingJobs.json read-only; there's no "create a drying job" flow client-side yet). This adds
// the persistence + the one rule the clarification is explicit about: a drying job always names
// a specific Lot, never just a Bin.
import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { assertDryingJobHasLot, ValidationError } from "../domain/validation.js";

export async function dryingRoutes(app: FastifyInstance) {
  app.get("/api/drying-jobs", async () => {
    return prisma.dryingJob.findMany({ orderBy: { date: "asc" } });
  });

  app.post("/api/drying-jobs", async (req, reply) => {
    const body = req.body as {
      id: string;
      date: string;
      warehouse: string;
      bin: string;
      lotNo: string;
      ficheNo: string;
      status: string;
      dryType: string;
      destination: string;
    };

    try {
      assertDryingJobHasLot(body);
    } catch (e) {
      if (e instanceof ValidationError) return reply.code(422).send({ error: e.message });
      throw e;
    }

    const job = await prisma.dryingJob.create({ data: body });
    return reply.code(201).send(job);
  });
}
