/**
 * Read hooks for production batches. Plain fetch-and-hold, like userManagement.ts:
 * each screen refetches after its own write.
 */
import { api } from "../repository/api";
import type { AvailableBin, BatchDetail, BatchSummary } from "@anagroci/contract/types/productionBatch";
import type { BatchCalibration } from "@anagroci/contract/types/calibration";
import type { BatchLots } from "@anagroci/contract/types/lots";
import { useLoaded, type Loaded } from "./useLoaded";
import { useProductionFactory } from "./productionFactory";

// Each read names the factory in its deps: an admin switching factory re-reads (api.ts sends the choice).
export const useBatches = (): Loaded<BatchSummary> => useLoaded(() => api.listBatches(), [useProductionFactory().factory]);

export const useBatchBins = (): Loaded<AvailableBin> => useLoaded(() => api.listBatchBins(), [useProductionFactory().factory]);

/** One batch, held as a one-row list so it gets useLoaded's stale-response guard. */
export function useBatch(code: string | undefined): { batch: BatchDetail | null; loading: boolean; error: string | null; refetch: () => Promise<void> } {
  const { factory } = useProductionFactory();
  const { rows, loading, error, refetch } = useLoaded(() => (code ? api.getBatch(code).then((b) => [b]) : Promise.resolve([])), [code, factory]);
  return { batch: rows[0] ?? null, loading, error, refetch };
}

/** Phase 2 for one batch: the factory's silos and the batch's QC-2 checks. One-row list, like useBatch. */
export function useBatchCalibration(code: string | undefined): { calibration: BatchCalibration | null; error: string | null; refetch: () => Promise<void> } {
  const { factory } = useProductionFactory();
  const { rows, error, refetch } = useLoaded(() => (code ? api.getBatchCalibration(code).then((c) => [c]) : Promise.resolve([])), [code, factory]);
  return { calibration: rows[0] ?? null, error, refetch };
}

/** Phases 3–4 for one batch: its Lots, and the factory's by-product stores, trucks and boiler. One-row list, like useBatch. */
export function useBatchLots(code: string | undefined): { data: BatchLots | null; error: string | null; refetch: () => Promise<void> } {
  const { factory } = useProductionFactory();
  const { rows, error, refetch } = useLoaded(() => (code ? api.getBatchLots(code).then((d) => [d]) : Promise.resolve([])), [code, factory]);
  return { data: rows[0] ?? null, error, refetch };
}
