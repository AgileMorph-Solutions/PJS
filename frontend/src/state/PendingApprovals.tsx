import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../repository/api";
import { useHasRole } from "./AuthContext";

interface PendingApprovals {
  /** Form submissions + supplier requests waiting on this reviewer; null until the first read (or for a non-reviewer). */
  count: number | null;
  /** Read again now — for right after an approve/reject, so the sidebar doesn't wait for the next poll. */
  refresh: () => void;
}

const Ctx = createContext<PendingApprovals>({ count: null, refresh: () => {} });

const POLL_MS = 60_000;

/**
 * The sidebar's "waiting for you" number. Same two queues ApprovalsPage shows, read from the same endpoints, which
 * already scope to the reviewer's own warehouse (admin: all). There is no push channel, so it re-reads on a slow poll,
 * when the tab comes back into focus, and on each navigation; a failed read keeps the last number rather than showing 0.
 */
export function PendingApprovalsProvider({ children }: { children: ReactNode }) {
  const isReviewer = useHasRole("admin", "warehouse_incharge");
  const { pathname } = useLocation();
  const [count, setCount] = useState<number | null>(null);

  const refresh = useCallback(() => {
    if (!isReviewer) return;
    void Promise.all([api.listSubmissions({ status: "submitted" }), api.listSupplierRequests("pending")])
      .then(([subs, reqs]) => setCount(subs.length + reqs.length))
      .catch(() => {});
  }, [isReviewer]);

  useEffect(refresh, [refresh, pathname]);

  useEffect(() => {
    if (!isReviewer) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [isReviewer, refresh]);

  return <Ctx.Provider value={{ count: isReviewer ? count : null, refresh }}>{children}</Ctx.Provider>;
}

export const usePendingApprovals = () => useContext(Ctx);
