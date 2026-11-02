/**
 * Read hooks for production batches. Plain fetch-and-hold, like userManagement.ts:
 * each screen refetches after its own write.
 */
import { api } from "../repository/api";
import type { AvailableBin, BatchDetail, BatchSummary } from "@anagroci/contract/types/productionBatch";
import { useLoaded, type Loaded } from "./useLoaded";

export const useBatches = (): Loaded<BatchSummary> => useLoaded(() => api.listBatches(), []);

export const useBatchBins = (): Loaded<AvailableBin> => useLoaded(() => api.listBatchBins(), []);

/** One batch, held as a one-row list so it gets useLoaded's stale-response guard. */
export function useBatch(code: string | undefined): { batch: BatchDetail | null; loading: boolean; error: string | null; refetch: () => Promise<void> } {
  const { rows, loading, error, refetch } = useLoaded(() => (code ? api.getBatch(code).then((b) => [b]) : Promise.resolve([])), [code]);
  return { batch: rows[0] ?? null, loading, error, refetch };
}
