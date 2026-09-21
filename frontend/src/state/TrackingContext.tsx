import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ReceiptRecord } from "../types/receipt";
import { deriveStatus } from "../domain/receiptStatus";
import { loadJSON, saveJSON } from "../repository/storage";
import { loadSeedReceipts, nextReceiptId, blankReceipt } from "../repository/receiptsRepo";
import { loadSeedLedgerEntries, type LedgerEntries, type LedgerRow } from "../repository/juteRepo";
import { loadSeedMasters, type Masters, type Supplier } from "../repository/mastersRepo";

const STORAGE_KEY = "anagroci-tracking-v2";

interface PersistedState {
  receipts: ReceiptRecord[];
  ledgerEntries: LedgerEntries;
  masterOverrides: { suppliers: Supplier[]; warehouses: string[]; bins: string[] };
}

function loadInitial(): PersistedState {
  return loadJSON<PersistedState>(STORAGE_KEY, {
    receipts: loadSeedReceipts(),
    ledgerEntries: loadSeedLedgerEntries(),
    masterOverrides: { suppliers: [], warehouses: [], bins: [] },
  });
}

interface TrackingApi {
  receipts: ReceiptRecord[];
  getReceipt: (id: string) => ReceiptRecord | undefined;
  createReceipt: () => string;
  updateReceiptField: (id: string, patch: Partial<ReceiptRecord>) => void;
  setStageField: (id: string, stageId: string, fieldName: string, value: string) => void;
  setBranch: (id: string, stageId: string, branchId: string) => void;

  ledgerEntries: LedgerEntries;
  addLedgerEntry: (ledgerId: string, row: LedgerRow) => void;

  masters: Masters;
  addSupplier: (s: Supplier) => void;
  addWarehouse: (name: string) => void;
  addBin: (name: string) => void;

  resetAll: () => void;
}

const TrackingCtx = createContext<TrackingApi | null>(null);

export function TrackingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistedState>(loadInitial);
  const seedMasters = useMemo(() => loadSeedMasters(), []);

  useEffect(() => saveJSON(STORAGE_KEY, state), [state]);

  const masters: Masters = useMemo(
    () => ({
      suppliers: [...seedMasters.suppliers, ...state.masterOverrides.suppliers],
      warehouses: [...seedMasters.warehouses, ...state.masterOverrides.warehouses],
      bins: [...seedMasters.bins, ...state.masterOverrides.bins],
      origins: seedMasters.origins,
    }),
    [seedMasters, state.masterOverrides]
  );

  const api = useMemo<TrackingApi>(
    () => ({
      receipts: state.receipts,
      getReceipt: (id) => state.receipts.find((r) => r.id === id),
      createReceipt: () => {
        const id = nextReceiptId(state.receipts);
        setState((prev) => ({ ...prev, receipts: [...prev.receipts, blankReceipt(id)] }));
        return id;
      },
      updateReceiptField: (id, patch) =>
        setState((prev) => ({
          ...prev,
          receipts: prev.receipts.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        })),
      setStageField: (id, stageId, fieldName, value) =>
        setState((prev) => ({
          ...prev,
          receipts: prev.receipts.map((r) =>
            r.id === id
              ? {
                  ...r,
                  stageData: {
                    ...r.stageData,
                    [stageId]: { ...r.stageData[stageId], [fieldName]: value },
                  },
                }
              : r
          ),
        })),
      setBranch: (id, stageId, branchId) =>
        setState((prev) => ({
          ...prev,
          receipts: prev.receipts.map((r) => {
            if (r.id !== id) return r;
            const branches = { ...r.branches, [stageId]: branchId };
            const updated = { ...r, branches };
            const status = deriveStatus(updated);
            return { ...updated, timeline: [...r.timeline, { status, at: new Date().toISOString() }] };
          }),
        })),

      ledgerEntries: state.ledgerEntries,
      addLedgerEntry: (ledgerId, row) =>
        setState((prev) => ({
          ...prev,
          ledgerEntries: {
            ...prev.ledgerEntries,
            [ledgerId]: [...(prev.ledgerEntries[ledgerId] ?? []), row],
          },
        })),

      masters,
      addSupplier: (s) =>
        setState((prev) => ({
          ...prev,
          masterOverrides: { ...prev.masterOverrides, suppliers: [...prev.masterOverrides.suppliers, s] },
        })),
      addWarehouse: (name) =>
        setState((prev) => ({
          ...prev,
          masterOverrides: { ...prev.masterOverrides, warehouses: [...prev.masterOverrides.warehouses, name] },
        })),
      addBin: (name) =>
        setState((prev) => ({
          ...prev,
          masterOverrides: { ...prev.masterOverrides, bins: [...prev.masterOverrides.bins, name] },
        })),

      resetAll: () =>
        setState({
          receipts: loadSeedReceipts(),
          ledgerEntries: loadSeedLedgerEntries(),
          masterOverrides: { suppliers: [], warehouses: [], bins: [] },
        }),
    }),
    [state, masters]
  );

  return <TrackingCtx.Provider value={api}>{children}</TrackingCtx.Provider>;
}

export function useTracking(): TrackingApi {
  const ctx = useContext(TrackingCtx);
  if (!ctx) throw new Error("useTracking must be used within a TrackingProvider");
  return ctx;
}
