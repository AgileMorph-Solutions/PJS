/**
 * The HTTP client. Everything the app persists goes through here.
 *
 * Same-origin /api in both dev and prod — vite proxies it, nginx proxies it — so the browser never
 * needs CORS and there is no API base URL to configure per environment.
 */
import type {
  ReceiptRecord, LedgerRow, LedgerEntries, Masters, Supplier, DryingJob,
} from "@anagroci/contract/types/receipt";

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

export class ApiError extends Error {
  // Written out longhand rather than as a parameter property: the app's tsconfig sets
  // erasableSyntaxOnly, which disallows that shorthand.
  status: number;
  /** The `detail` field a rejected import carries (e.g. expected-vs-actual header on a shape
   * mismatch) — undefined for every other endpoint, which never sends one. */
  detail?: unknown;
  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

/** Reads a fetch Response's {error, detail?} body, falling back to the status line for a
 * non-JSON error — shared by the JSON request() path and the raw multipart upload below. */
async function errorFromResponse(res: Response): Promise<ApiError> {
  let message = `${res.status} ${res.statusText}`;
  let detail: unknown;
  try {
    const body = await res.json();
    if (body?.error) message = body.error;
    detail = body?.detail;
  } catch { /* non-JSON error body */ }
  return new ApiError(message, res.status, detail);
}

/** Writes answer { data, warnings } so a data-quality problem can surface at the point of capture. */
export interface Written<T> { data: T; warnings: string[] }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw await errorFromResponse(res);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const unwrap = <T>(r: Written<T> | T): Written<T> =>
  r && typeof r === "object" && "data" in (r as any)
    ? (r as Written<T>)
    : { data: r as T, warnings: [] };

export const api = {
  listReceipts: () => request<ReceiptRecord[]>("/receipts"),
  getReceipt: (id: string) => request<ReceiptRecord>(`/receipts/${encodeURIComponent(id)}`),

  createReceipt: () => request<ReceiptRecord>("/receipts", { method: "POST", body: "{}" }),

  patchReceipt: async (id: string, patch: Partial<ReceiptRecord>) =>
    unwrap(await request<Written<ReceiptRecord>>(`/receipts/${encodeURIComponent(id)}`, {
      method: "PATCH", body: JSON.stringify(patch),
    })),

  /** Batched: one request per stage flush, not one per keystroke. */
  patchStage: async (id: string, stageId: string, fields: Record<string, string>) =>
    unwrap(await request<Written<ReceiptRecord>>(
      `/receipts/${encodeURIComponent(id)}/stages/${encodeURIComponent(stageId)}`,
      { method: "PATCH", body: JSON.stringify({ fields }) }
    )),

  setBranch: async (id: string, stageId: string, branchId: string, reason?: string) =>
    unwrap(await request<Written<ReceiptRecord>>(`/receipts/${encodeURIComponent(id)}/branch`, {
      method: "POST", body: JSON.stringify({ stageId, branchId, reason }),
    })),

  listLedgers: () => request<LedgerEntries>("/jute-ledgers"),
  addLedgerEntry: async (ledgerId: string, row: LedgerRow) =>
    unwrap(await request<Written<LedgerRow>>(`/jute-ledgers/${encodeURIComponent(ledgerId)}/entries`, {
      method: "POST", body: JSON.stringify({ row }),
    })),

  masters: () => request<Masters>("/masters"),
  addSupplier: (s: Supplier) => request<Supplier>("/masters/suppliers", { method: "POST", body: JSON.stringify(s) }),
  addWarehouse: (name: string) => request<unknown>("/masters/warehouses", { method: "POST", body: JSON.stringify({ name }) }),
  addBin: (code: string) => request<unknown>("/masters/bins", { method: "POST", body: JSON.stringify({ code }) }),

  dryingJobs: () => request<DryingJob[]>("/drying-jobs"),
  receiptLinks: (id: string) => request<ReceiptLinks>(`/receipts/${encodeURIComponent(id)}/links`),
  dashboard: (from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    const s = q.toString();
    return request<Record<string, unknown>>(`/dashboard${s ? `?${s}` : ""}`);
  },
  dataQuality: () => request<{ generatedAt: string; checks: unknown[] }>("/data-quality"),

  listImporterTypes: () => request<ImporterTypeInfo[]>("/imports/types"),

  /** Multipart upload — the one call in this file that isn't JSON, so it can't go through
   * request(): a FormData body needs the browser's own multipart Content-Type (with boundary),
   * never the hardcoded "application/json" header every other call sends. */
  previewImport: async (file: File, importerId?: string): Promise<PreviewImportResponse> => {
    const form = new FormData();
    form.append("file", file);
    if (importerId) form.append("importerId", importerId);
    const res = await fetch(`${BASE}/imports/preview`, { method: "POST", body: form });
    if (!res.ok) throw await errorFromResponse(res);
    return res.json();
  },

  commitImport: (token: string, skipFlagged: boolean) =>
    request<CommitImportResponse>(`/imports/${encodeURIComponent(token)}/commit`, {
      method: "POST", body: JSON.stringify({ skipFlagged }),
    }),

  // ── Production — its own capability, not part of TrackingApi (see repository/api.ts's header:
  // same reasoning as dryingJobs/receiptLinks — a new hook, not a reshaped context). ─────────────
  listBtmIntakes: () => request<BtmIntake[]>("/production/btm"),
  getBtmIntake: (btmNo: string) => request<BtmIntakeDetail>(`/production/btm/${encodeURIComponent(btmNo)}`),
  addBtmRow: async (btmNo: string, kind: "receipt-lines" | "quality" | "calibration", binNo: string, fields: Record<string, string>) =>
    unwrap(await request<Written<unknown>>(`/production/btm/${encodeURIComponent(btmNo)}/${kind}`, {
      method: "POST", body: JSON.stringify({ binNo, fields }),
    })),

  listProductionBins: () => request<ProductionBinSummary[]>("/production/bins"),
  getProductionBin: (binNo: string) => request<ProductionBinDetail>(`/production/bins/${encodeURIComponent(binNo)}`),
  getBinPhaseProgress: (binNo: string) => request<BinPhaseStep[]>(`/production/bins/${encodeURIComponent(binNo)}/phase-progress`),

  listLots: () => request<ProductionLot[]>("/production/lots"),
  getLot: (lotNo: string) => request<LotDetail>(`/production/lots/${encodeURIComponent(lotNo)}`),
  cookLot: async (lotNo: string, binNo: string, fields: Record<string, string>) =>
    unwrap(await request<Written<unknown>>(`/production/lots/${encodeURIComponent(lotNo)}/cooking`, {
      method: "POST", body: JSON.stringify({ binNo, fields }),
    })),
  addLotRow: async (lotNo: string, kind: "shelling" | "borma" | "packing", fields: Record<string, string>) =>
    unwrap(await request<Written<unknown>>(`/production/lots/${encodeURIComponent(lotNo)}/${kind}`, {
      method: "POST", body: JSON.stringify({ fields }),
    })),

  // Generic per-table access — covers every production table beyond the named endpoints above
  // (see backend/src/routes/production.ts's "Generic per-table access" section).
  listBtmTableRows: (btmNo: string, tableId: string) =>
    request<Record<string, unknown>[]>(`/production/btm/${encodeURIComponent(btmNo)}/tables/${encodeURIComponent(tableId)}`),
  addBtmTableRow: async (btmNo: string, tableId: string, binNo: string, fields: Record<string, string>) =>
    unwrap(await request<Written<unknown>>(`/production/btm/${encodeURIComponent(btmNo)}/tables/${encodeURIComponent(tableId)}`, {
      method: "POST", body: JSON.stringify({ binNo, fields }),
    })),
  listLotTableRows: (lotNo: string, tableId: string) =>
    request<Record<string, unknown>[]>(`/production/lots/${encodeURIComponent(lotNo)}/tables/${encodeURIComponent(tableId)}`),
  addLotTableRow: async (lotNo: string, tableId: string, fields: Record<string, string>) =>
    unwrap(await request<Written<unknown>>(`/production/lots/${encodeURIComponent(lotNo)}/tables/${encodeURIComponent(tableId)}`, {
      method: "POST", body: JSON.stringify({ fields }),
    })),
  listBinTableRows: (binNo: string, tableId: string, limit?: number) =>
    request<Record<string, unknown>[]>(`/production/bins/${encodeURIComponent(binNo)}/tables/${encodeURIComponent(tableId)}${limit ? `?limit=${limit}` : ""}`),
  addBinTableRow: async (binNo: string, tableId: string, fields: Record<string, string>) =>
    unwrap(await request<Written<unknown>>(`/production/bins/${encodeURIComponent(binNo)}/tables/${encodeURIComponent(tableId)}`, {
      method: "POST", body: JSON.stringify({ fields }),
    })),
  listStandaloneTable: (tableId: string, limit?: number) =>
    request<Record<string, unknown>[]>(`/production/standalone/${encodeURIComponent(tableId)}${limit ? `?limit=${limit}` : ""}`),
  addStandaloneRow: async (tableId: string, fields: Record<string, string>) =>
    unwrap(await request<Written<unknown>>(`/production/standalone/${encodeURIComponent(tableId)}`, {
      method: "POST", body: JSON.stringify({ fields }),
    })),
};

export interface BtmIntake {
  btmNo: string;
  binNo: string;
  source: string | null;
  createdAt: string;
}

export interface BtmIntakeDetail extends BtmIntake {
  tables: Record<string, boolean>;
  status: string;
}

export interface ProductionBinSummary {
  binNo: string;
  source: string | null;
  btmCount: number;
  lotCount: number;
}

export interface ProductionLot {
  lotNo: string;
  binNo: string;
  source: string | null;
  createdAt: string;
}

export interface BinStockRow {
  binNo: string;
  date: string;
  qty_in: string;
  qty_out: string;
  movement_type: string;
  running_balance: string;
}

export interface ProductionBinDetail extends ProductionBinSummary {
  btmIntakes: BtmIntake[];
  lots: ProductionLot[];
  stock: BinStockRow[];
  silo: unknown[];
}

export interface BinPhaseStep {
  tableId: string;
  label: string;
  phase: string;
  kind: "aggregate" | "direct";
  doneCount: number;
  totalCount: number;
}

export interface LotDetail extends ProductionLot {
  tables: Record<string, boolean>;
  status: string;
}

export interface ImporterTypeInfo {
  id: string;
  label: string;
  exampleFilename: string;
  expectedSheet: string;
}

export interface ImportFinding {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  entity: string;
  affectedCount: number;
  sampleIds: string[];
  evidence: string;
}

export interface PreviewImportResponse {
  token: string;
  importerId: string;
  label: string;
  rowCount: number;
  skippedCount: number;
  duplicateCount: number;
  findings: ImportFinding[];
  sampleRows: unknown[];
}

export interface CommitImportResponse {
  importerId: string;
  created: number;
  skippedDuplicates: number;
  skippedInvalid: number;
}

/** A batch's real FICHE (paper docket) linking it to other records about the same batch — see
 * backend/src/services/receiptLinks.ts's header for why FICHE, not the receipt's own Lot: each
 * warehouse runs its own 1..N lot sequence, so the same batch is a different Lot at each site
 * (measured: 334/339 transfers and 12/12 drying rows disagree with the receipt's own lot). */
export interface LinkedDryingJob {
  id: string;
  date: string;
  warehouse: string;
  bin: string;
  lotNo: string;
  status: string;
  dryType: string;
  /** Whether this row's lot matches the receipt's own (ReceiptLinks.lotNo). False is the norm. */
  lotAgrees: boolean;
  destination: string;
}

export interface LinkedTransfer {
  sn: number;
  receivedDate: string | null;
  lotNo: string | null;
  binNo: string | null;
  truckRegistration: string | null;
  bagsReceived: number | null;
  sourceWarehouse: string;
  lotAgrees: boolean;
}

export interface LinkedBtmIntake {
  btmNo: string;
  binNo: string;
}

export interface ReceiptLinks {
  fiche: string | null;
  /** The receipt's OWN Lot, assigned at its unit warehouse. Null until a discharge sheet covers it. */
  lotNo: string | null;
  lotWarehouse: string | null;
  dryingJobs: LinkedDryingJob[];
  transfers: LinkedTransfer[];
  btmIntakes: LinkedBtmIntake[];
}
