/**
 * Read hooks for the user-management screens (users, approvals, supplier assignment). Each is a
 * plain fetch-and-hold — no shared cache — because these lists are short and each screen wants
 * fresh data after its own approve/reject/assign, which it triggers via `refetch`.
 */
import { api } from "../repository/api";
import type { BranchManagerView, SubmissionView, SupplierRequestView, UserView } from "../types/user";
import type { Supplier } from "../types/receipt";
import { useLoaded, type Loaded, type LoadOptions } from "./useLoaded";

export type { Loaded };

export const useUsers = (): Loaded<UserView> => useLoaded(() => api.listUsers(), []);

export const useSubmissions = (q: { status?: string; receiptId?: string } = {}, opts?: LoadOptions): Loaded<SubmissionView> =>
  useLoaded(() => api.listSubmissions(q), [q.status, q.receiptId], opts);

export const useBranchManagers = (): Loaded<BranchManagerView> => useLoaded(() => api.listBranchManagers(), []);

export const useMySuppliers = (): Loaded<Supplier> => useLoaded(() => api.mySuppliers(), []);

export const useSupplierRequests = (status?: string, opts?: LoadOptions): Loaded<SupplierRequestView> =>
  useLoaded(() => api.listSupplierRequests(status), [status], opts);
