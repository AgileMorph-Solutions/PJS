/**
 * Drying jobs: scoped to a specific Lot/quantity, never a whole Bin (confirmed rule — a Bin can
 * mix several Lots). assertDryingJobHasLot is the enforcement; this is just the persistence.
 */
import { prisma } from "../db.js";
import { assertDryingJobHasLot } from "../domain/validation.js";

export interface NewDryingJob {
  id: string; date: string; warehouse: string; bin: string;
  lotNo: string; ficheNo: string; status: string; dryType: string; destination: string;
}

export async function listDryingJobs(site?: string[]) {
  return prisma.dryingJob.findMany({
    where: site ? { warehouse: { in: site } } : {},
    orderBy: { date: "asc" },
  });
}

export async function createDryingJob(job: NewDryingJob) {
  assertDryingJobHasLot(job);
  return prisma.dryingJob.create({ data: job });
}
