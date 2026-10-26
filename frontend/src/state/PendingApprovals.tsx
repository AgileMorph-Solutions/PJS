import { createContext, useCallback, useContext, useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useHasRole } from "./AuthContext";
import { useSubmissions, useSupplierRequests, type Loaded } from "./userManagement";
import type { SubmissionView, SupplierRequestView } from "../types/user";

interface PendingApprovals {
  /** Form submissions waiting on this reviewer — the same list ApprovalsPage renders. */
  submissions: Loaded<SubmissionView>;
  /** Supplier requests waiting on this reviewer — the same list ApprovalsPage renders. */
  supplierRequests: Loaded<SupplierRequestView>;
  /** Derived from the two lists above; null until the first read (or for a non-reviewer). */
  count: number | null;
  /** Read again now — for right after an approve/reject, so the sidebar doesn't wait for the next poll. */
  refresh: () => void;
}

const empty = { rows: [], loading: false, error: null, refetch: async () => {} };
const Ctx = createContext<PendingApprovals>({ submissions: empty, supplierRequests: empty, count: null, refresh: () => {} });

const POLL_MS = 60_000;

/**
 * The reviewer's two queues, held once so the sidebar badge and ApprovalsPage can never disagree: the count is
 * derived from the very rows the page lists. The endpoints already scope to the reviewer's own warehouse (admin:
 * all). There is no push channel, so it re-reads on a slow poll, when the tab comes back into focus, and on each
 * navigation; a failed read keeps the last rows rather than emptying them.
 */
export function PendingApprovalsProvider({ children }: { children: ReactNode }) {
  const isReviewer = useHasRole("admin", "warehouse_incharge");
  const { pathname } = useLocation();
  // Re-read on each navigation, so the count is fresh whichever page the reviewer lands on.
  const load = { enabled: isReviewer, reloadOn: pathname };
  const submissions = useSubmissions({ status: "submitted" }, load);
  const supplierRequests = useSupplierRequests("pending", load);
  const { refetch: refetchSubs } = submissions;
  const { refetch: refetchReqs } = supplierRequests;

  const refresh = useCallback(() => {
    if (!isReviewer) return;
    void Promise.all([refetchSubs(), refetchReqs()]);
  }, [isReviewer, refetchSubs, refetchReqs]);

  useEffect(() => {
    if (!isReviewer) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [isReviewer, refresh]);

  const settled = !submissions.loading && !supplierRequests.loading;
  const count = isReviewer && settled ? submissions.rows.length + supplierRequests.rows.length : null;

  return <Ctx.Provider value={{ submissions, supplierRequests, count, refresh }}>{children}</Ctx.Provider>;
}

export const usePendingApprovals = () => useContext(Ctx);
