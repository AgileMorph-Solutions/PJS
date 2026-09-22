import dryingJobs from "../data/seed/dryingJobs.json";
import type { DryingJob } from "@anagroci/contract/types/receipt";

export type { DryingJob };

/** Offline fallback only — DryingJobsPage reads the API through useDryingJobs(). */
export function loadSeedDryingJobs(): DryingJob[] {
  return dryingJobs as DryingJob[];
}
