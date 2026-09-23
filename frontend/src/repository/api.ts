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
};

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
