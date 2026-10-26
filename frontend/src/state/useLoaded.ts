import { useCallback, useEffect, useRef, useState } from "react";

export interface Loaded<T> { rows: T[]; loading: boolean; error: string | null; refetch: () => Promise<void> }

export interface LoadOptions {
  /** false skips the request entirely and holds an empty, settled list — for a caller whose role the endpoint would refuse. */
  enabled?: boolean;
  /** Re-read whenever this changes (a route, a save counter), without going back to `loading` — the rows on screen are
   * swapped in place rather than blanked behind a skeleton. */
  reloadOn?: unknown;
}

/**
 * Fetch-and-hold for a list: no shared cache, each caller gets its own copy and calls `refetch` after its own writes.
 * A failed read keeps the last rows and reports `error`, rather than emptying the list. When `deps` change (another
 * record), the old rows are dropped first so a page never shows one record's rows under another's heading.
 */
export function useLoaded<T>(fetcher: () => Promise<T[]>, deps: unknown[], { enabled = true, reloadOn }: LoadOptions = {}): Loaded<T> {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Only the newest request may write: an older one answering late (the previous record's, or a reload overtaken by
  // the next save) would otherwise put stale rows on screen — another truck's change log under this one's heading.
  const latest = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const refetch = useCallback(async () => {
    const call = ++latest.current;
    if (!enabled) { setRows([]); setLoading(false); return; }
    try {
      const next = await fetcher();
      if (call !== latest.current) return;
      setRows(next);
      setError(null);
    } catch (e) {
      if (call !== latest.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (call === latest.current) setLoading(false);
    }
  }, [...deps, enabled]);

  useEffect(() => { setRows([]); setLoading(true); void refetch(); }, [refetch]);

  // The effect above already read on mount (and on every deps change), so this only acts on a later reloadOn change.
  const lastReloadOn = useRef(reloadOn);
  useEffect(() => {
    if (Object.is(lastReloadOn.current, reloadOn)) return;
    lastReloadOn.current = reloadOn;
    void refetch();
  }, [reloadOn, refetch]);

  return { rows, loading, error, refetch };
}
