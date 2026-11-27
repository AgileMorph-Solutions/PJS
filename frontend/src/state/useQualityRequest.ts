import { useCallback, useEffect, useRef, useState } from "react";
import { scopeKey, type QualityRequestKind, type QualityRequestScope, type QualityRequestView } from "@anagroci/contract/domain/qualityRequests";
import { api } from "../repository/api";
import { useLiveVersion } from "./LiveUpdates";

export interface QualityRequestState {
  request: QualityRequestView | null;
  error: string | null;
  /** The Incharge clicked Cancel: the only way the request ends without the form being saved. */
  cancel: () => Promise<void>;
}

/**
 * The live quality request of an open drying form (contract domain/qualityRequests.ts): asked for when the form opens (the
 * same request again if it is still open from before). Leaving the page doesn't end it (user, 27 Nov 2026): only `cancel`
 * does, or saving the form. It is read again on each live update, so an approval shows as soon as it is given.
 */
export function useQualityRequest(kind: QualityRequestKind, scope: QualityRequestScope | null): QualityRequestState {
  const [request, setRequest] = useState<QualityRequestView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef<number | null>(null);
  /** The ask in flight: Cancel clicked before it answered still cancels what it asked. */
  const asking = useRef<Promise<number | null>>(Promise.resolve(null));
  const key = scope ? scopeKey(scope) : null;
  const live = useLiveVersion();

  useEffect(() => {
    idRef.current = null;
    setRequest(null);
    setError(null);
    if (!scope) return;
    let active = true;
    asking.current = api.openQualityRequest(kind, scope).then(
      (r) => { if (active) { idRef.current = r.id; setRequest(r); } return r.id; },
      (e) => { if (active) setError(e instanceof Error ? e.message : String(e)); return null; },
    );
    return () => { active = false; };
    // `key` stands for `scope`: a new object for the same truck, Bin or round is the same form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, key]);

  // Something was saved at the warehouse: the reading may have been approved.
  useEffect(() => {
    const id = idRef.current;
    if (id === null || live === 0) return;
    let current = true;
    api.getQualityRequest(id).then((r) => { if (current && idRef.current === id) setRequest(r); }, () => {});
    return () => { current = false; };
  }, [live]);

  const cancel = useCallback(async () => {
    const id = idRef.current ?? await asking.current;
    if (id !== null) await api.cancelQualityRequest(id);
  }, []);

  return { request, error, cancel };
}
