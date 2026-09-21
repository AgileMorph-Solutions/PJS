import dryingJobsSeed from "../data/seed/dryingJobs.json";

export interface DryingJob {
  id: string;
  date: string;
  warehouse: string;
  bin: string;
  lotNo: string;
  ficheNo: string;
  status: string;
  dryType: string;
  destination: string;
}

export function loadSeedDryingJobs(): DryingJob[] {
  return dryingJobsSeed as DryingJob[];
}
