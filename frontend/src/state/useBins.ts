import { api, type SiteBinDetail, type SiteBinSummary } from "../repository/api";
import { useLoaded } from "./useLoaded";

/** The Bins of a warehouse with their stock (Warehouse activities, and where a truck is loaded from); with `unassigned`,
 * the Bins of the master with no warehouse instead. */
export function useSiteBins(warehouse: string | undefined, enabled = true, unassigned = false) {
  const { rows, loading, error, refetch } = useLoaded<SiteBinSummary>(() => api.listBins(warehouse, unassigned), [warehouse, unassigned], { enabled: enabled && Boolean(warehouse) });
  return { bins: rows, loading, error, refetch };
}

/** One Bin of a warehouse, with what was done to it. */
export function useBin(code: string, warehouse: string | undefined) {
  const { rows, loading, error, refetch } = useLoaded<SiteBinDetail>(async () => [await api.getBin(code, warehouse)], [code, warehouse], { enabled: Boolean(code && warehouse) });
  return { bin: rows[0], loading, error, refetch };
}
