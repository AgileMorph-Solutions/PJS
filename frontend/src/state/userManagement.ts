/**
 * Read hooks for the user-management screens (users, approvals, supplier assignment). Each is a
 * plain fetch-and-hold — no shared cache — because these lists are short and each screen wants
 * fresh data after its own approve/reject/assign, which it triggers via `refetch`.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "../repository/api";
import type { BranchManagerView, SubmissionView, SupplierRequestView, UserView } from "../types/user";
import type { Supplier } from "../types/receipt";

interface Loaded<T> { rows: T[]; loading: boolean; error: string | null; refetch: () => Promise<void> }

function useLoaded<T>(fetcher: () => Promise<T[]>, deps: unknown[]): Loaded<T> {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const refetch = useCallback(async () => {
    try {
      setRows(await fetcher());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, deps);

  useEffect(() => { setLoading(true); void refetch(); }, [refetch]);
  return { rows, loading, error, refetch };
}

export const useUsers = (): Loaded<UserView> => useLoaded(() => api.listUsers(), []);

export const useSubmissions = (q: { status?: string; receiptId?: string } = {}): Loaded<SubmissionView> =>
  useLoaded(() => api.listSubmissions(q), [q.status, q.receiptId]);

export const useBranchManagers = (): Loaded<BranchManagerView> => useLoaded(() => api.listBranchManagers(), []);

export const useMySuppliers = (): Loaded<Supplier> => useLoaded(() => api.mySuppliers(), []);

export const useSupplierRequests = (status?: string): Loaded<SupplierRequestView> =>
  useLoaded(() => api.listSupplierRequests(status), [status]);
