import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import type { ReceiptRecord } from "../types/receipt";
import { deriveStatus } from "../domain/receiptStatus";
import { api, ApiError } from "../repository/api";
import { removeKey, LEGACY_STATE_KEY } from "../repository/storage";
import type { LedgerEntries, LedgerRow } from "../repository/juteRepo";
import type { Masters, Supplier } from "../repository/mastersRepo";

/**
 * The swap from localStorage to the API, kept to one layer.
 *
 * Shape: SYNCHRONOUS READS, ASYNC WRITES. The provider holds the whole dataset in state, so every
 * consumer keeps reading `receipts` / `masters` / `ledgerEntries` synchronously and none of the
 * pages had to change. Mutations apply optimistically and reconcile with the server's response —
 * which matters because the server owns the derived status and the timeline.
 *
 * Only `createReceipt` had to become async: it returns a server-assigned id that both call sites
 * immediately navigate to, and a provisional client-side id would 404 on reload.
 *
 * Stage writes are COALESCED. FieldInput is a controlled input firing per keystroke; issuing one
 * request per character would mean N writes to one row and out-of-order responses overwriting
 * newer text. Dirty fields are buffered per (receipt, stage) and flushed on a short debounce, on
 * blur, and on unload.
 */
interface TrackingApi {
  receipts: ReceiptRecord[];
  getReceipt: (id: string) => ReceiptRecord | undefined;
  createReceipt: () => Promise<string>;
  updateReceiptField: (id: string, patch: Partial<ReceiptRecord>) => void;
  setStageField: (id: string, stageId: string, fieldName: string, value: string) => void;
  setBranch: (id: string, stageId: string, branchId: string, reason?: string) => void;

  ledgerEntries: LedgerEntries;
  addLedgerEntry: (ledgerId: string, row: LedgerRow) => void;

  masters: Masters;
  addSupplier: (s: Supplier) => void;
  addWarehouse: (name: string) => void;
  addBin: (name: string) => void;

  /** Flush any buffered edits for a stage immediately — call on blur / before navigating away. */
  flushStage: (id: string, stageId: string) => void;
  loading: boolean;
  error: string | null;
  /** Data-quality warnings from the most recent write, if any. */
  warnings: string[];
  refresh: () => Promise<void>;
  resetAll: () => void;
}

const TrackingCtx = createContext<TrackingApi | null>(null);
const EMPTY_MASTERS: Masters = { suppliers: [], warehouses: [], bins: [], origins: [] };
const FLUSH_MS = 400;

export function TrackingProvider({ children }: { children: ReactNode }) {
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntries>({});
  const [masters, setMasters] = useState<Masters>(EMPTY_MASTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Buffered stage edits, keyed "receiptId\u0000stageId".
  const dirty = useRef(new Map<string, Record<string, string>>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Monotonic per-key counter: a response older than the latest local edit is discarded, so a slow
  // reply can't clobber text the user has typed since.
  const seq = useRef(new Map<string, number>());

  const mergeReceipt = useCallback((r: ReceiptRecord) => {
    setReceipts((prev) => (prev.some((x) => x.id === r.id) ? prev.map((x) => (x.id === r.id ? r : x)) : [...prev, r]));
  }, []);

  const fail = useCallback((e: unknown) => {
    const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
    setError(msg);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [rs, ls, ms] = await Promise.all([api.listReceipts(), api.listLedgers(), api.masters()]);
      setReceipts(rs);
      setLedgerEntries(ls);
      setMasters(ms);
      setError(null);
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }, [fail]);

  useEffect(() => {
    // The pre-API blob held a full copy of the receipts; leaving it would let stale data shadow
    // the server on first load, silently.
    removeKey(LEGACY_STATE_KEY);
    void refresh();
  }, [refresh]);

  const flushKey = useCallback(
    async (key: string) => {
      const pending = dirty.current.get(key);
      if (!pending || !Object.keys(pending).length) return;
      dirty.current.delete(key);
      const t = timers.current.get(key);
      if (t) { clearTimeout(t); timers.current.delete(key); }

      const [id, stageId] = key.split("\u0000");
      const at = seq.current.get(key) ?? 0;
      try {
        const { data, warnings: w } = await api.patchStage(id, stageId, pending);
        // Only accept the server's copy if nothing was typed while the request was in flight.
        if ((seq.current.get(key) ?? 0) === at) mergeReceipt(data);
        setWarnings(w);
        setError(null);
      } catch (e) {
        fail(e);
        void refresh(); // the optimistic edit was rejected — resync rather than keep a lie on screen
      }
    },
    [mergeReceipt, fail, refresh]
  );

  const flushAll = useCallback(() => {
    for (const key of [...dirty.current.keys()]) void flushKey(key);
  }, [flushKey]);

  useEffect(() => {
    const onHide = () => flushAll();
    window.addEventListener("beforeunload", onHide);
    return () => {
      window.removeEventListener("beforeunload", onHide);
      flushAll();
    };
  }, [flushAll]);

  const api_: TrackingApi = useMemo(
    () => ({
      receipts,
      getReceipt: (id) => receipts.find((r) => r.id === id),

      createReceipt: async () => {
        const created = await api.createReceipt();
        mergeReceipt(created);
        return created.id;
      },

      updateReceiptField: (id, patch) => {
        setReceipts((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
        api.patchReceipt(id, patch)
          .then(({ data, warnings: w }) => { mergeReceipt(data); setWarnings(w); })
          .catch((e) => { fail(e); void refresh(); });
      },

      setStageField: (id, stageId, fieldName, value) => {
        // Optimistic: the input stays responsive and the status pill updates immediately.
        setReceipts((prev) =>
          prev.map((r) =>
            r.id === id
              ? { ...r, stageData: { ...r.stageData, [stageId]: { ...r.stageData[stageId], [fieldName]: value } } }
              : r
          )
        );
        const key = `${id}\u0000${stageId}`;
        dirty.current.set(key, { ...(dirty.current.get(key) ?? {}), [fieldName]: value });
        seq.current.set(key, (seq.current.get(key) ?? 0) + 1);
        const existing = timers.current.get(key);
        if (existing) clearTimeout(existing);
        timers.current.set(key, setTimeout(() => void flushKey(key), FLUSH_MS));
      },

      setBranch: (id, stageId, branchId, reason) => {
        // Optimistic status + timeline, mirroring what the server will do, so the UI doesn't lag.
        setReceipts((prev) =>
          prev.map((r) => {
            if (r.id !== id) return r;
            const branches = { ...r.branches, [stageId]: branchId };
            const updated = { ...r, branches };
            return { ...updated, timeline: [...r.timeline, { status: deriveStatus(updated), at: new Date().toISOString() }] };
          })
        );
        api.setBranch(id, stageId, branchId, reason)
          .then(({ data, warnings: w }) => { mergeReceipt(data); setWarnings(w); setError(null); })
          .catch((e) => { fail(e); void refresh(); });
      },

      ledgerEntries,
      addLedgerEntry: (ledgerId, row) => {
        api.addLedgerEntry(ledgerId, row)
          .then(({ data, warnings: w }) => {
            // The server assigns the serial number and computes the running balance, so the row it
            // returns — not the submitted draft — is what goes into the table.
            setLedgerEntries((prev) => ({ ...prev, [ledgerId]: [...(prev[ledgerId] ?? []), data] }));
            setWarnings(w);
          })
          .catch((e) => { fail(e); void refresh(); });
      },

      masters,
      addSupplier: (s) => {
        setMasters((prev) => ({ ...prev, suppliers: [...prev.suppliers, s] }));
        api.addSupplier(s).catch((e) => { fail(e); void refresh(); });
      },
      addWarehouse: (name) => {
        setMasters((prev) => ({ ...prev, warehouses: [...prev.warehouses, name] }));
        api.addWarehouse(name).catch((e) => { fail(e); void refresh(); });
      },
      addBin: (name) => {
        setMasters((prev) => ({ ...prev, bins: [...prev.bins, name] }));
        api.addBin(name).catch((e) => { fail(e); void refresh(); });
      },

      flushStage: (id, stageId) => void flushKey(`${id}\u0000${stageId}`),
      loading,
      error,
      warnings,
      refresh,
      resetAll: () => void refresh(),
    }),
    [receipts, ledgerEntries, masters, loading, error, warnings, mergeReceipt, fail, refresh, flushKey]
  );

  return <TrackingCtx.Provider value={api_}>{children}</TrackingCtx.Provider>;
}

export function useTracking(): TrackingApi {
  const ctx = useContext(TrackingCtx);
  if (!ctx) throw new Error("useTracking must be used within a TrackingProvider");
  return ctx;
}

/**
 * Drying jobs come from the API but aren't part of TrackingApi — DryingJobsPage used to read the
 * seed JSON directly, and keeping it out of the context keeps that interface unchanged.
 */
export function useDryingJobs() {
  const [jobs, setJobs] = useState<import("@anagroci/contract/types/receipt").DryingJob[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    api.dryingJobs()
      .then((j) => { if (alive) setJobs(j); })
      .catch(() => { /* page renders empty; the provider surfaces connection errors */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  return { jobs, loading };
}
