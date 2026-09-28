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
  /** `warehouse` scopes the new receipt to a site (e.g. "BOUAKE") — still genuinely about receipts,
   * so this stays on TrackingApi rather than becoming a separate hook (see frontend/CLAUDE.md's
   * "extend, don't reshape" rule: only receipts/ledgers/masters capabilities belong here). */
  createReceipt: (warehouse?: string) => Promise<string>;
  updateReceiptField: (id: string, patch: Partial<ReceiptRecord>) => void;
  setStageField: (id: string, stageId: string, fieldName: string, value: string) => void;
  setBranch: (id: string, stageId: string, branchId: string, reason?: string) => void;

  ledgerEntries: LedgerEntries;
  addLedgerEntry: (ledgerId: string, row: LedgerRow) => void;

  masters: Masters;
  addSupplier: (s: Supplier) => void;
  /** `classification` is either `{ kind }` (a new SITE) or `{ site }` (a STORE under an existing
   * site) — never both, matching Warehouse's Site -> Store hierarchy. Omitted entirely, the
   * warehouse is added unclassified, same as this method's original behavior. */
  addWarehouse: (name: string, classification?: { kind?: string; site?: string }) => void;
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

      createReceipt: async (warehouse) => {
        const created = await api.createReceipt(warehouse);
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
      addWarehouse: (name, classification) => {
        const kind = classification?.kind ?? null;
        const site = classification?.site ?? null;
        setMasters((prev) => ({ ...prev, warehouses: [...prev.warehouses, { name, kind, site }] }));
        api.addWarehouse(name, classification).catch((e) => { fail(e); void refresh(); });
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
 *
 * `warehouse` (a real site name, e.g. "BOUAKE") scopes the read server-side via resolveSite() —
 * passed by the site-scoped Drying page (pages/warehouse/DryingJobsPage.tsx) so each section only
 * ever fetches its own site's jobs, not both plus a client-side filter.
 */
export function useDryingJobs(warehouse?: string) {
  const [jobs, setJobs] = useState<import("@anagroci/contract/types/receipt").DryingJob[]>([]);
  const [loading, setLoading] = useState(true);
  const refetch = useCallback(() => {
    return api.dryingJobs(warehouse)
      .then(setJobs)
      .catch(() => { /* page renders empty; the provider surfaces connection errors */ });
  }, [warehouse]);
  useEffect(() => {
    setLoading(true);
    void refetch().finally(() => setLoading(false));
  }, [refetch]);
  return { jobs, loading, refetch };
}

/**
 * CHARGEMENT-derived unit dispatch lines — its own hook for the same reason as useDryingJobs: a
 * brand-new table, never part of TrackingApi. Currently unused by any page — dispatch status
 * shows via Reception's Downstream column instead (see DownstreamStatusChips) — kept as a working
 * hook rather than deleted, same precedent as useDryingJobs.
 */
export function useWarehouseDispatches(warehouse?: string) {
  const [lines, setLines] = useState<import("../repository/api").WarehouseDispatchLine[]>([]);
  const [loading, setLoading] = useState(true);
  const refetch = useCallback(() => {
    return api.listWarehouseDispatches(warehouse).then(setLines).catch(() => {});
  }, [warehouse]);
  useEffect(() => {
    setLoading(true);
    void refetch().finally(() => setLoading(false));
  }, [refetch]);
  return { lines, loading, refetch };
}

/** Drying Batch (consolidated, both sites) — the Drying page's primary source, replacing
 * DryingJob (see services/dryingBatches.ts's header comment for why). */
export function useDryingBatches(warehouse?: string) {
  const [batches, setBatches] = useState<import("../repository/api").DryingBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const refetch = useCallback(() => {
    return api.listDryingBatches(warehouse).then(setBatches).catch(() => {});
  }, [warehouse]);
  useEffect(() => {
    setLoading(true);
    void refetch().finally(() => setLoading(false));
  }, [refetch]);
  return { batches, loading, refetch };
}

/** Drying & Sorting Report (Bouaké detail) — the Drying page's secondary source. */
export function useDryingSortingReports(warehouse?: string) {
  const [reports, setReports] = useState<import("../repository/api").DryingSortingReport[]>([]);
  const [loading, setLoading] = useState(true);
  const refetch = useCallback(() => {
    return api.listDryingSortingReports(warehouse).then(setReports).catch(() => {});
  }, [warehouse]);
  useEffect(() => {
    setLoading(true);
    void refetch().finally(() => setLoading(false));
  }, [refetch]);
  return { reports, loading, refetch };
}

/**
 * Per-receipt dispatched/received/dried/issued flags for Reception's status column (backend's
 * services/receiptsDownstream.ts) — replaces Dispatch to Central / Receiving from Unit / Issue to
 * Production as separate sidebar pages. Returned as a Map for O(1) lookup per row in the list.
 */
export function useDownstreamStatus(warehouse?: string) {
  const [status, setStatus] = useState<Map<string, import("../repository/api").DownstreamStatus>>(new Map());
  const [loading, setLoading] = useState(true);
  const refetch = useCallback(() => {
    return api.listDownstreamStatus(warehouse)
      .then((rows) => setStatus(new Map(rows.map((r) => [r.receiptId, r]))))
      .catch(() => {});
  }, [warehouse]);
  useEffect(() => {
    setLoading(true);
    void refetch().finally(() => setLoading(false));
  }, [refetch]);
  return { status, loading, refetch };
}

/**
 * One ledger's rows, scoped to a site — deliberately NOT a replacement for TrackingApi's
 * `ledgerEntries` (the unfiltered, globally-loaded set stays the zero-latency "All sites" default);
 * this is only reached when a jute page's own site filter is active. Ledger 4 rows can match on
 * EITHER side of a transfer, which resolveSite() on the backend is what actually knows how to do —
 * see api.ts's listLedgerEntries comment for why this can't just filter the already-loaded rows.
 */
export function useJuteLedgerEntries(ledgerId: string, warehouse: string | undefined) {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const refetch = useCallback(() => {
    return api.listLedgerEntries(ledgerId, warehouse).then(setRows).catch(() => {});
  }, [ledgerId, warehouse]);
  useEffect(() => {
    setLoading(true);
    void refetch().finally(() => setLoading(false));
  }, [refetch]);
  return { rows, loading, refetch };
}

/**
 * A receipt's cross-references to drying jobs / transfer receipts about the same physical batch
 * (joined server-side on Lot Number — see backend/src/services/receiptLinks.ts for the accuracy
 * tradeoff this accepts). Same shape as useDryingJobs, but keyed on receiptId so navigating
 * between receipts refetches instead of showing the previous receipt's links.
 */
export function useReceiptLinks(receiptId: string | undefined) {
  const [links, setLinks] = useState<import("../repository/api").ReceiptLinks | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!receiptId) { setLinks(null); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    api.receiptLinks(receiptId)
      .then((l) => { if (alive) setLinks(l); })
      .catch(() => { if (alive) setLinks(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [receiptId]);
  return { links, loading };
}

/**
 * Production — its own hooks, same reasoning as useDryingJobs: a new capability stays out of
 * TrackingApi so existing consumers never need to change. List hooks expose `refetch` for after a
 * write (no optimistic/coalesced-write machinery yet — production writes are infrequent,
 * per-record submissions, not per-keystroke stage edits, so a refetch-on-success is enough).
 */
export function useBtmIntakes() {
  const [rows, setRows] = useState<import("../repository/api").BtmIntake[]>([]);
  const [loading, setLoading] = useState(true);
  const refetch = useCallback(() => api.listBtmIntakes().then(setRows).catch(() => {}), []);
  useEffect(() => { setLoading(true); void refetch().finally(() => setLoading(false)); }, [refetch]);
  return { rows, loading, refetch };
}

export function useBtmIntake(btmNo: string | undefined) {
  const [row, setRow] = useState<import("../repository/api").BtmIntakeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const refetch = useCallback(() => {
    if (!btmNo) { setRow(null); return Promise.resolve(); }
    return api.getBtmIntake(btmNo).then(setRow).catch(() => setRow(null));
  }, [btmNo]);
  useEffect(() => { setLoading(true); void refetch().finally(() => setLoading(false)); }, [refetch]);
  return { row, loading, refetch };
}

export function useProductionBins() {
  const [rows, setRows] = useState<import("../repository/api").ProductionBinSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const refetch = useCallback(() => api.listProductionBins().then(setRows).catch(() => {}), []);
  useEffect(() => { setLoading(true); void refetch().finally(() => setLoading(false)); }, [refetch]);
  return { rows, loading, refetch };
}

export function useProductionBin(binNo: string | undefined) {
  const [row, setRow] = useState<import("../repository/api").ProductionBinDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const refetch = useCallback(() => {
    if (!binNo) { setRow(null); return Promise.resolve(); }
    return api.getProductionBin(binNo).then(setRow).catch(() => setRow(null));
  }, [binNo]);
  useEffect(() => { setLoading(true); void refetch().finally(() => setLoading(false)); }, [refetch]);
  return { row, loading, refetch };
}

/** The Bin page's Phase 1-2 accordion data — separate from useProductionBin since it's a distinct
 * endpoint (aggregate fractions across a Bin's BTMs), not part of the plain Bin row. */
export function useBinPhaseProgress(binNo: string | undefined) {
  const [steps, setSteps] = useState<import("../repository/api").BinPhaseStep[]>([]);
  const [loading, setLoading] = useState(true);
  const refetch = useCallback(() => {
    if (!binNo) { setSteps([]); return Promise.resolve(); }
    return api.getBinPhaseProgress(binNo).then(setSteps).catch(() => setSteps([]));
  }, [binNo]);
  useEffect(() => { setLoading(true); void refetch().finally(() => setLoading(false)); }, [refetch]);
  return { steps, loading, refetch };
}

export function useProductionLots() {
  const [rows, setRows] = useState<import("../repository/api").ProductionLot[]>([]);
  const [loading, setLoading] = useState(true);
  const refetch = useCallback(() => api.listLots().then(setRows).catch(() => {}), []);
  useEffect(() => { setLoading(true); void refetch().finally(() => setLoading(false)); }, [refetch]);
  return { rows, loading, refetch };
}

export function useLot(lotNo: string | undefined) {
  const [row, setRow] = useState<import("../repository/api").LotDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const refetch = useCallback(() => {
    if (!lotNo) { setRow(null); return Promise.resolve(); }
    return api.getLot(lotNo).then(setRow).catch(() => setRow(null));
  }, [lotNo]);
  useEffect(() => { setLoading(true); void refetch().finally(() => setLoading(false)); }, [refetch]);
  return { row, loading, refetch };
}
