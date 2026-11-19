import { createContext, useCallback, useContext, useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useMe } from "./AuthContext";
import { useSubmissions, useSupplierRequests, type Loaded } from "./userManagement";
import { useLoaded } from "./useLoaded";
import { api } from "../repository/api";
import { canAccessProduction } from "../data/roles";
import { productionApprovalKinds, type ProductionApproval } from "@anagroci/contract/domain/productionApprovals";
import type { SubmissionView, SupplierRequestView } from "../types/user";

interface PendingApprovals {
  /** Form submissions waiting on this reviewer — the same list ApprovalsPage renders. */
  submissions: Loaded<SubmissionView>;
  /** Supplier requests waiting on this reviewer — the same list ApprovalsPage renders. */
  supplierRequests: Loaded<SupplierRequestView>;
  /** Production's queue for this person: loads to accept, checks to approve (contract domain/productionApprovals.ts). */
  production: Loaded<ProductionApproval>;
  /** Which queues this person has at all; a page shows only these. */
  reviews: { procurement: boolean; production: boolean };
  /** Derived from the lists above; null until the first read (or for someone who approves nothing). */
  count: number | null;
  /** Read again now — for right after an approve/reject, so the sidebar doesn't wait for the next poll. */
  refresh: () => void;
}

const empty = { rows: [], loading: false, error: null, refetch: async () => {} };
const Ctx = createContext<PendingApprovals>({
  submissions: empty, supplierRequests: empty, production: empty, reviews: { procurement: false, production: false }, count: null, refresh: () => {},
});

const POLL_MS = 60_000;

/**
 * Everything waiting for this person's decision, held once so the sidebar badge and ApprovalsPage can never disagree:
 * the count is derived from the very rows the page lists. Each step goes up to the role above it — a Branch Manager's or
 * QFS Officer's entry to the Warehouse Incharge, the warehouse's weighed load and the factory's QFS checks to the
 * Production Incharge. The endpoints already scope to the person's own warehouse (admin: all). There is no push
 * channel, so it re-reads on a slow poll, when the tab comes back into focus, and on each navigation; a failed read
 * keeps the last rows rather than emptying them.
 */
export function PendingApprovalsProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const reviews = {
    procurement: me.role === "admin" || me.role === "warehouse_incharge",
    // Only at the factory, where production runs: a Unit warehouse's Incharge has no production queue.
    production: productionApprovalKinds(me.role).length > 0 && canAccessProduction(me.role, me.warehouseType),
  };
  const { pathname } = useLocation();
  // Re-read on each navigation, so the count is fresh whichever page the reviewer lands on.
  const submissions = useSubmissions({ status: "submitted" }, { enabled: reviews.procurement, reloadOn: pathname });
  const supplierRequests = useSupplierRequests("pending", { enabled: reviews.procurement, reloadOn: pathname });
  const production = useLoaded(() => api.listProductionApprovals(), [], { enabled: reviews.production, reloadOn: pathname });
  const { refetch: refetchSubs } = submissions;
  const { refetch: refetchReqs } = supplierRequests;
  const { refetch: refetchProduction } = production;
  const any = reviews.procurement || reviews.production;

  const refresh = useCallback(() => {
    if (!any) return;
    void Promise.all([refetchSubs(), refetchReqs(), refetchProduction()]);
  }, [any, refetchSubs, refetchReqs, refetchProduction]);

  useEffect(() => {
    if (!any) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [any, refresh]);

  const settled = !submissions.loading && !supplierRequests.loading && !production.loading;
  const count = any && settled ? submissions.rows.length + supplierRequests.rows.length + production.rows.length : null;

  return <Ctx.Provider value={{ submissions, supplierRequests, production, reviews, count, refresh }}>{children}</Ctx.Provider>;
}

export const usePendingApprovals = () => useContext(Ctx);
