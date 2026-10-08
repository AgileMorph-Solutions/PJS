/**
 * The HTTP client. Everything the app persists goes through here.
 *
 * Same-origin /api in both dev and prod — vite proxies it, nginx proxies it — so the browser never
 * needs CORS and there is no API base URL to configure per environment.
 */
import type {
  ReceiptRecord, LedgerRow, LedgerEntries, Masters, Supplier, DryingJob, DeliveryPlan, ReceiptPlanInfo, TransferRequest,
} from "@anagroci/contract/types/receipt";
import type {
  UserView, SubmissionView, BranchManagerView, SupplierRequestView,
} from "@anagroci/contract/types/user";
import type { BatchTruckRow } from "@anagroci/contract/data/batchEntry";

export const BASE = import.meta.env.VITE_API_BASE ?? "/api";

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

/** Fired when any call comes back 401 (session expired or revoked), so AuthContext can drop back to
 * the login screen without every caller handling it. Login itself is exempt — a wrong password is a
 * 401 the login form shows inline, not an expired session. */
export const UNAUTHORIZED_EVENT = "anagroci:unauthorized";

function checkUnauthorized(res: Response, path: string) {
  if (res.status === 401 && path !== "/auth/login") window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    // The session is an httpOnly cookie; same-origin sends it by default, this covers `vite dev`
    // against a backend on another port.
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  checkUnauthorized(res, path);
  if (!res.ok) throw await errorFromResponse(res);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const unwrap = <T>(r: Written<T> | T): Written<T> =>
  r && typeof r === "object" && "data" in (r as any)
    ? (r as Written<T>)
    : { data: r as T, warnings: [] };

const withWarehouse = (path: string, warehouse?: string) =>
  warehouse ? `${path}${path.includes("?") ? "&" : "?"}warehouse=${encodeURIComponent(warehouse)}` : path;

export const api = {
  // ── Identity, users, approvals — their own capability, not part of TrackingApi (see
  // state/AuthContext.tsx and the hooks in state/userManagement.ts). ────────────────────────────
  login: (username: string, password: string) =>
    request<UserView>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  me: () => request<UserView>("/auth/me"),

  listUsers: () => request<UserView[]>("/users"),
  createUser: (u: { username: string; password: string; displayName?: string; role: string; warehouse?: string | null }) =>
    request<UserView>("/users", { method: "POST", body: JSON.stringify(u) }),
  updateUser: (id: string, patch: { displayName?: string; role?: string; warehouse?: string | null; active?: boolean; password?: string }) =>
    request<UserView>(`/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),

  submitForm: (receiptId: string, values: Record<string, Record<string, string>>) =>
    request<{ id: string }>(`/receipts/${encodeURIComponent(receiptId)}/submissions`, { method: "POST", body: JSON.stringify({ values }) }),
  listSubmissions: (q: { status?: string; receiptId?: string } = {}) => {
    const p = new URLSearchParams();
    if (q.status) p.set("status", q.status);
    if (q.receiptId) p.set("receiptId", q.receiptId);
    return request<SubmissionView[]>(`/submissions${p.toString() ? `?${p}` : ""}`);
  },
  approveSubmission: (id: string) => request<{ ok: boolean }>(`/submissions/${encodeURIComponent(id)}/approve`, { method: "POST" }),
  rejectSubmission: (id: string, reason: string) =>
    request<{ ok: boolean }>(`/submissions/${encodeURIComponent(id)}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),

  listBranchManagers: () => request<BranchManagerView[]>("/branch-managers"),
  setBranchManagerSuppliers: (id: string, codes: string[]) =>
    request<{ ok: boolean }>(`/branch-managers/${encodeURIComponent(id)}/suppliers`, { method: "PUT", body: JSON.stringify({ codes }) }),
  mySuppliers: () => request<Supplier[]>("/my-suppliers"),
  requestSupplier: (name: string, code?: string) =>
    request<{ id: string }>("/supplier-requests", { method: "POST", body: JSON.stringify({ name, code }) }),
  listSupplierRequests: (status?: string) =>
    request<SupplierRequestView[]>(`/supplier-requests${status ? `?status=${status}` : ""}`),
  approveSupplierRequest: (id: string, code?: string) =>
    request<{ ok: boolean }>(`/supplier-requests/${encodeURIComponent(id)}/approve`, { method: "POST", body: JSON.stringify({ code }) }),
  rejectSupplierRequest: (id: string, reason: string) =>
    request<{ ok: boolean }>(`/supplier-requests/${encodeURIComponent(id)}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),

  listReceipts: () => request<ReceiptRecord[]>("/receipts"),
  getReceipt: (id: string) => request<ReceiptRecord>(`/receipts/${encodeURIComponent(id)}`),

  /** `warehouse` scopes the new receipt to a site (e.g. "BOUAKE") — see createReceipt in
   * services/receipts.ts. Recording the arrival is what issues the Receipt ID, so the server also
   * takes the arrival date (the year in the ID) and, optionally, the Delivery Plan the truck is
   * arriving against — which copies its supplier and warehouse onto the receipt. */
  createReceipt: (warehouse?: string, opts: { arrivalDate?: string; deliveryPlanId?: string } = {}) =>
    request<ReceiptRecord>("/receipts", {
      method: "POST",
      body: JSON.stringify({ ...(warehouse ? { warehouse } : {}), ...opts }),
    }),

  /** Several trucks at once — all or nothing; a rejected row's message names it ("Row 3: …") and
   * nothing is created. Returns the new receipt ids in row order. */
  createReceiptsBatch: (warehouse: string, rows: BatchTruckRow[]) =>
    request<{ ids: string[] }>("/receipts/batch", { method: "POST", body: JSON.stringify({ warehouse, rows }) }),

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
  addWarehouse: (name: string, classification?: { kind?: string; site?: string; type?: string }) =>
    request<unknown>("/masters/warehouses", { method: "POST", body: JSON.stringify({ name, ...classification }) }),
  /** Admin only: assign (or clear, with null) a site's Unit/Central type. */
  setWarehouseType: (name: string, type: string | null) =>
    request<unknown>(`/masters/warehouses/${encodeURIComponent(name)}`, { method: "PATCH", body: JSON.stringify({ type }) }),
  /** The code printed into every ID issued at a site (REC-<code>-2027-001). Admin only. */
  setWarehouseCode: (name: string, code: string | null) =>
    request<unknown>(`/masters/warehouses/${encodeURIComponent(name)}`, { method: "PATCH", body: JSON.stringify({ code }) }),

  listDeliveryPlans: (warehouse?: string) => request<DeliveryPlan[]>(withWarehouse("/delivery-plans", warehouse)),
  createDeliveryPlan: (plan: DeliveryPlanPayload) =>
    request<DeliveryPlan>("/delivery-plans", { method: "POST", body: JSON.stringify(plan) }),
  updateDeliveryPlan: (id: string, patch: DeliveryPlanPayload) =>
    request<DeliveryPlan>(`/delivery-plans/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),

  /** Reception Type, exception flags, plan link and approval for every receipt at a site. Warehouse Incharge / admin only. */
  listReceiptPlanInfo: (warehouse?: string) => request<ReceiptPlanInfo[]>(withWarehouse("/receipts/plan-info", warehouse)),
  getReceiptPlanInfo: (receiptId: string) => request<ReceiptPlanInfo>(`/receipts/${encodeURIComponent(receiptId)}/plan-info`),
  approveReceiptException: (receiptId: string, note?: string) =>
    request<ReceiptPlanInfo>(`/receipts/${encodeURIComponent(receiptId)}/exception-approval`, { method: "POST", body: JSON.stringify({ note }) }),
  linkReceiptToPlan: (receiptId: string, deliveryPlanId: string) =>
    request<ReceiptPlanInfo>(`/receipts/${encodeURIComponent(receiptId)}/delivery-plan`, { method: "POST", body: JSON.stringify({ deliveryPlanId }) }),

  listTransfers: (warehouse?: string) => request<TransferRequest[]>(withWarehouse("/transfers", warehouse)),
  createTransfer: (t: {
    transferDate: string; fromWarehouse: string; toWarehouse: string; remarks?: string;
    lines: { receiptId: string; bags?: number | null; netWeightKg?: number | string | null }[];
  }) => request<TransferRequest>("/transfers", { method: "POST", body: JSON.stringify(t) }),
  addTransferLines: (id: string, lines: { receiptId: string; bags?: number | null; netWeightKg?: number | string | null }[]) =>
    request<TransferRequest>(`/transfers/${encodeURIComponent(id)}/lines`, { method: "POST", body: JSON.stringify({ lines }) }),
  /** The SENDING warehouse sends the truck: one BKT is one truck, so the truck number is required. */
  dispatchTransfer: (id: string, p: DispatchPayload) =>
    request<TransferRequest>(`/transfers/${encodeURIComponent(id)}/dispatch`, { method: "POST", body: JSON.stringify(p) }),
  /** The DESTINATION warehouse records what actually arrived; the variance is worked out from it. */
  receiveTransfer: (id: string, p: ReceivePayload) =>
    request<TransferRequest>(`/transfers/${encodeURIComponent(id)}/receive`, { method: "POST", body: JSON.stringify(p) }),
  addBin: (code: string) => request<unknown>("/masters/bins", { method: "POST", body: JSON.stringify({ code }) }),

  /** `warehouse` scopes to a site via the backend's resolveSite() (site name -> itself + its
   * stores + aliases) — see backend/src/domain/site.ts. Omitted = every site, unfiltered. */
  dryingJobs: (warehouse?: string) => request<DryingJob[]>(withWarehouse("/drying-jobs", warehouse)),
  receiptLinks: (id: string) => request<ReceiptLinks>(`/receipts/${encodeURIComponent(id)}/links`),
  listDownstreamStatus: (warehouse?: string) =>
    request<DownstreamStatus[]>(withWarehouse("/receipts/downstream", warehouse)),

  /** Site-scoped read of one ledger's rows — used when a jute page's own site filter is active
   * (see WarehouseStockPage/WarehouseTransfersPage); the unfiltered TrackingApi.ledgerEntries stays
   * the default, zero-latency view. Ledger 4 rows can match on EITHER side of a transfer (source or
   * destination warehouse), which only the backend can resolve — not reproducible client-side from
   * the flat LedgerRow shape alone. */
  listLedgerEntries: (ledgerId: string, warehouse?: string) =>
    request<LedgerRow[]>(withWarehouse(`/jute-ledgers/${encodeURIComponent(ledgerId)}/entries`, warehouse)),

  /** CHARGEMENT-derived unit dispatch lines (see backend/src/services/warehouseDispatches.ts) —
   * read-only, powers pages/warehouse/DispatchesPage.tsx (linked from Reception's Downstream chips
   * and a receipt's "Linked records" card, not a sidebar item — see config/nav.ts's own comment on
   * why). */
  listWarehouseDispatches: (warehouse?: string) =>
    request<WarehouseDispatchLine[]>(withWarehouse("/warehouse-dispatches", warehouse)),

  /** Drying Batch (consolidated, both sites) — read-only, the Drying page's primary source. */
  listDryingBatches: (warehouse?: string) =>
    request<DryingBatch[]>(withWarehouse("/drying-batches", warehouse)),
  /** Drying & Sorting Report (Bouaké detail) — read-only, the Drying page's secondary source. */
  listDryingSortingReports: (warehouse?: string) =>
    request<DryingSortingReport[]>(withWarehouse("/drying-sorting-reports", warehouse)),
  /** Issued to Production Section — read-only, no site scoping (the table has no site column at
   * all — see services/issuedToProduction.ts). Powers pages/warehouse/IssuedToProductionPage.tsx. */
  listIssuedToProduction: () => request<IssuedToProductionRow[]>("/issued-to-production"),
  /** Warehouse activity Ledger — read-only, no site scoping (same reason as above). Powers
   * pages/jute/WarehouseActivityLedgerPage.tsx. */
  listWarehouseActivityLedger: () => request<WarehouseActivityLedgerEntry[]>("/warehouse-activity-ledger"),
  /** WarehouseDischarge — the raw rows behind both DISCHARGEMENT and Warehouse Receiving, shown on
   * Lots & Bins alongside the derived Receipt.stageData view that page already had. */
  listWarehouseDischarges: (warehouse?: string) =>
    request<WarehouseDischargeRow[]>(withWarehouse("/warehouse-discharges", warehouse)),
  dashboard: (from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    const s = q.toString();
    return request<Record<string, unknown>>(`/dashboard${s ? `?${s}` : ""}`);
  },
  dataQuality: () => request<{ generatedAt: string; checks: unknown[] }>("/data-quality"),

  // ── The ANAGROCI workbook: ONE .xlsx in our own table format, for both Export and Upload. ────────
  workbookInfo: (warehouse: string) =>
    request<WorkbookInfo>(`/workbook/info?warehouse=${encodeURIComponent(warehouse)}`),

  /** Downloads the workbook (or, with `blank`, the headers-only template). Returns the file for the
   * caller to save rather than pointing a link at the URL, so a 401/403 shows as a message instead
   * of JSON in a new tab. */
  downloadWorkbook: async (
    warehouse: string,
    opts: { from?: string; to?: string; blank?: boolean } = {}
  ): Promise<{ blob: Blob; filename: string; exported: number; withoutDate: number }> => {
    const q = new URLSearchParams({ warehouse });
    // Inclusive, either end optional — the backend validates and reports what it left out.
    if (opts.from) q.set("from", opts.from);
    if (opts.to) q.set("to", opts.to);
    const path = `/workbook${opts.blank ? "/template" : ""}?${q}`;
    const res = await fetch(`${BASE}${path}`, { credentials: "include" });
    checkUnauthorized(res, path);
    if (!res.ok) throw await errorFromResponse(res);
    const filename = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "ANAGROCI workbook.xlsx";
    return {
      blob: await res.blob(),
      filename,
      exported: Number(res.headers.get("x-rows-exported") ?? 0),
      withoutDate: Number(res.headers.get("x-rows-without-date") ?? 0),
    };
  },

  /** Multipart upload — the one call in this file that isn't JSON, so it can't go through
   * request(): a FormData body needs the browser's own multipart Content-Type (with boundary),
   * never the hardcoded "application/json" header every other call sends. Writes nothing. */
  previewWorkbook: async (file: File, warehouse: string): Promise<WorkbookPreview> => {
    const form = new FormData();
    form.append("warehouse", warehouse); // fields before the file, so the server has it when it reads the file
    form.append("file", file);
    const res = await fetch(`${BASE}/workbook/preview`, { method: "POST", body: form, credentials: "include" });
    checkUnauthorized(res, "/workbook/preview");
    if (!res.ok) throw await errorFromResponse(res);
    return res.json();
  },

  commitWorkbook: (token: string) =>
    request<WorkbookCommitResult>(`/workbook/${encodeURIComponent(token)}/commit`, { method: "POST" }),

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

export interface WorkbookSheetInfo {
  name: string;
  /** Master data (suppliers, bins, …): always complete, never date-filtered. */
  master: boolean;
  /** The date a from/to range filters this sheet on, or null when it isn't date-filterable. */
  dateLabel: string | null;
}
export interface WorkbookInfo { warehouse: string; type: "UNIT" | "CENTRAL"; sheets: WorkbookSheetInfo[] }

export interface WorkbookRowError { row: number; column?: string; message: string }
export interface WorkbookSample { row: number; key: string; changes: { column: string; from: string; to: string }[] }
export interface WorkbookSheetPlan {
  name: string;
  rows: number;
  created: number;
  changed: number;
  unchanged: number;
  errorCount: number;
  /** The first few only; `errorCount` is the full number. */
  errors: WorkbookRowError[];
  samples: WorkbookSample[];
}
export interface WorkbookPreview {
  token: string;
  filename: string;
  warehouse: string;
  type: "UNIT" | "CENTRAL";
  sheets: WorkbookSheetPlan[];
  notices: string[];
  errorCount: number;
  totalCreated: number;
  totalChanged: number;
}
export interface WorkbookCommitResult {
  applied: { name: string; created: number; updated: number }[];
  totalCreated: number;
  totalUpdated: number;
}

/** Cross-referenced by the receipt's own Lot Number — see backend/src/services/receiptLinks.ts's
 * header for the accuracy tradeoff this accepts: each warehouse runs its own 1..N lot sequence, so
 * most Lot matches are a coincidental collision, not the same physical batch (measured: only 5 of
 * 365 lot-matched transfers and 0 of 40 lot-matched drying rows also share the receipt's FICHE). */
export interface LinkedDryingJob {
  id: string;
  date: string;
  warehouse: string;
  bin: string;
  lotNo: string;
  status: string;
  dryType: string;
  /** Whether this row's FICHE also matches the receipt's own (ReceiptLinks.fiche) — true means a
   * genuinely-confirmed match; false (the norm) means the Lot match is likely coincidental. */
  ficheAgrees: boolean;
  destination: string;
}

export interface LinkedTransfer {
  sn: number;
  receivedDate: string | null;
  lotNo: string | null;
  binNo: string | null;
  truckRegistration: string | null;
  bagsReceived: number | null;
  bagsDispatched: number | null;
  netWeightDispatched: number | null;
  idTransfer: string | null;
  sourceWarehouse: string;
  destinationWarehouse: string | null;
  ficheAgrees: boolean;
}

export interface LinkedBtmIntake {
  btmNo: string;
  binNo: string;
}

/** CHARGEMENT dispatch line matched on this receipt's own FICHE directly — every row here is a
 * confirmed match (no `ficheAgrees`), unlike the Lot-joined arrays above. */
export interface LinkedDispatch {
  id: string;
  chargeDate: string | null;
  warehouseSite: string | null;
  bin: string | null;
  truckNo: string | null;
  totalBags: number | null;
  vyogeNumber: string | null;
  transporter: string | null;
  driver: string | null;
  netWeight: number | null;
}

/** WarehouseDischarge row sharing this receipt's Lot Number — includes both the unit-warehouse row
 * that assigned the Lot and, when one exists, the central "Warehouse Receiving" row for the same
 * Lot at the other site. */
export interface LinkedWarehouseReceiving {
  id: string;
  sn: number;
  warehouseSite: string;
  lotNo: string;
  arrivalDate: string | null;
  totalRecd: number | null;
  truckNo: string | null;
  netWeight: number | null;
  ficheAgrees: boolean;
}

/** DryingBatch row sharing this receipt's Lot Number — the replacement drying source (see
 * repository's DryingBatch type below); kept separate from `dryingJobs` since the two are known to
 * disagree (drying_batch_vs_drying_job_drift). */
export interface LinkedDryingBatchRow {
  id: string;
  sn: number;
  dryingDate: string | null;
  warehouseSite: string | null;
  status: string | null;
  dryType: string | null;
  sourceBinNo: string | null;
  destinationBinNo: string | null;
  destinationRaw: string | null;
  inputBags: number | null;
  outputBags: number | null;
  inputMoisturePct: number | null;
  outputMoisturePct: number | null;
  inputKor: number | null;
  outputKor: number | null;
  issuedNetWeightKg: number | null;
  receivedNetWeightKg: number | null;
  dryingLossKg: number | null;
  remarks: string | null;
  ficheAgrees: boolean;
}

/** IssuedToProduction row reached via the same idTransfer -> BtmIntake.btmNo hop as `btmIntakes`. */
export interface LinkedIssuedToProduction {
  id: string;
  btmNo: string;
  date: string | null;
  sourceBin: string | null;
  dryBin: string | null;
  binStatus: string | null;
}

export interface ReceiptLinks {
  /** The receipt's OWN Lot, assigned at its unit warehouse — now the join key. Null until a
   * discharge sheet covers it. */
  lotNo: string | null;
  lotWarehouse: string | null;
  /** This receipt's own FICHE, shown only so each row's `ficheAgrees` is checkable. */
  fiche: string | null;
  dryingJobs: LinkedDryingJob[];
  transfers: LinkedTransfer[];
  btmIntakes: LinkedBtmIntake[];
  dispatches: LinkedDispatch[];
  warehouseReceiving: LinkedWarehouseReceiving[];
  dryingBatches: LinkedDryingBatchRow[];
  issuedToProduction: LinkedIssuedToProduction[];
}

export interface DispatchPayload {
  truckNo: string; transporter?: string | null; driver?: string | null; driverPhone?: string | null; dispatchedGrossKg?: number | string | null;
}
export interface ReceivePayload {
  bagsReceived: number | string; receivedGrossKg: number | string; damagedBags?: number | string | null;
  korReceived?: number | string | null; moistureReceived?: number | string | null; nutCountReceived?: number | string | null;
  receivedComment?: string | null; receivedLotNoRaw?: string | null;
}

/** What a plan can be created or corrected with — the writable subset of DeliveryPlan; everything else is derived. */
export interface DeliveryPlanPayload {
  supplierName?: string; supplierCode?: string | null;
  expectedQuantityKg?: number | string | null; expectedTruckType?: string | null; expectedTrucks?: number | string | null;
  expectedOrigin?: string | null; expectedArrivalDate?: string; expectedDeliveryEnd?: string | null; plannedDeliveryDate?: string | null;
  destinationWarehouse?: string; destinationStore?: string | null; fundingReference?: string | null; planningBasis?: string | null;
  remarks?: string | null; cancelled?: boolean; cancelReason?: string | null;
}

/** Per-receipt downstream flags for Reception's status column (backend's
 * services/receiptsDownstream.ts) — replaces the separate Dispatch to Central / Receiving from
 * Unit / Issue to Production sidebar pages with one status chip per receipt. */
export interface DownstreamStatus {
  receiptId: string;
  dispatched: boolean;
  received: boolean;
  dried: boolean;
  issued: boolean;
}

/** One CHARGEMENT line (backend/prisma/schema.prisma's WarehouseDispatchLine) — one row per sheet
 * LINE, not per dispatch; group by vyogeNumber for a document-level view. Numeric/date fields come
 * back as strings on the wire like every other stage field — never coerced client-side, per this
 * repo's "never silently fix" rule. */
export interface WarehouseDispatchLine {
  id: string;
  sn: number | null;
  chargeDate: string | null;
  chargeDateRaw: string | null;
  warehouseSite: string | null;
  vyogeNumber: string | null;
  remark: string | null;
  scaleLocation: string | null;
  warehouse: string | null;
  whOrDirect: string | null;
  bin: string | null;
  origin: string | null;
  truckNo: string | null;
  transporter: string | null;
  driver: string | null;
  phone: string | null;
  whReceiptNo: string | null;
  ficheCca: string | null;
  binwiseLoadedBags: number | null;
  totalBags: number | null;
  grossWt: string | null;
  netWeight: string | null;
  status: string | null;
  unloadingStatus: string | null;
  browns: string | null;
  voids: string | null;
  oil: string | null;
  totDefect: string | null;
  goodKernel: string | null;
  immature: string | null;
  spotted: string | null;
  totKernels: string | null;
  kor: string | null;
  shot: string | null;
  fot: string | null;
  usefulKernelsYield: string | null;
  totalYield: string | null;
  moisture: string | null;
  nc: string | null;
  shell: string | null;
  bagsYakro: number | null;
  grossYakro: string | null;
  differenceWeight: string | null;
  sheetRow: number | null;
  source: string | null;
  createdAt: string;
}

/** Drying Batch (backend/prisma/schema.prisma's DryingBatch) — both sites, consolidated. `lotNo`
 * is populated only when `lotNoRaw` is unambiguous (see the model's own comment) — a comma-joined
 * or numerically-concatenated value is never split, so `lotNo` stays null and `lotNoRaw` carries
 * the real cell text verbatim. Every real column on the model is declared below (not just the ones
 * DryingJobsPage's at-a-glance table renders — see RecordDetailModal's "View all fields" for the
 * rest); every value arrives as a string on the wire except `sn`/int columns (plain numbers). */
export interface DryingBatch {
  id: string;
  sn: number;
  dryingDate: string | null;
  dryingDateRaw: string | null;
  warehouseSite: string | null;
  warehouse: string | null;
  sourceBinNo: string | null;
  destinationBinNo: string | null;
  lotNoRaw: string | null;
  lotNo: string | null;
  whReceiptNoRaw: string | null;
  ficheNoRaw: string | null;
  originRaw: string | null;
  supplierNameRaw: string | null;
  supplierCodeRaw: string | null;
  ccakSupplierCodeRaw: string | null;
  status: string | null;
  dryType: string | null;
  destinationRaw: string | null;
  issuedGrossWithBagsPalletsKg: string | null;
  issuedPalletWeightKg: string | null;
  issuedGrossWithBagsKg: string | null;
  issuedBags: number | null;
  issuedNetWeightKg: string | null;
  receivedGrossWithBagsPalletsKg: string | null;
  receivedPalletWeightKg: string | null;
  receivedGrossWithBagsKg: string | null;
  receivedBags: number | null;
  receivedNetWeightKg: string | null;
  inputMoisturePct: string | null;
  inputNutCount: string | null;
  inputKor: string | null;
  outputMoisturePct: string | null;
  outputNutCount: string | null;
  outputKor: string | null;
  oil: string | null;
  rejection: string | null;
  goodKernel: string | null;
  immature: string | null;
  spotted: string | null;
  shell: string | null;
  void: string | null;
  moistureLossPct: string | null;
  dryingLossKg: string | null;
  dryingLossPct: string | null;
  triageLossKg: string | null;
  triageLossPct: string | null;
  damagedNutsKg: string | null;
  inputBagsForDrying: number | null;
  outputBagsAfterDrying: number | null;
  dryingOrPicking: string | null;
  remarks: string | null;
  issuedToProduction: string | null;
  reDryingDate: string | null;
  reDryingDateRaw: string | null;
  moistureFirstRedryPct: string | null;
  moistureSecondDryPct: string | null;
  issuedToProduction3: string | null;
  remarks4: string | null;
  needsLotAllocationClarificationRaw: string | null;
  sheetRow: number | null;
  source: string | null;
  createdAt: string;
}

/** Drying & Sorting Report (backend/prisma/schema.prisma's DryingSortingReport) — Bouaké-side
 * detail, 57 real rows. Same lotNo/lotNoRaw discipline as DryingBatch, and same "every real column
 * declared" discipline. */
export interface DryingSortingReport {
  id: string;
  sn: number | null;
  dryingDate: string | null;
  dryingDateRaw: string | null;
  warehouseSite: string | null;
  warehouse: string | null;
  unloadingBin: string | null;
  afterDryingBin: string | null;
  lotNoRaw: string | null;
  lotNo: string | null;
  whReceiptNoRaw: string | null;
  origin: string | null;
  supplierName: string | null;
  supplierCodeAnagroci: string | null;
  supplierCodeCcak: string | null;
  issuedNetWeightGrn: string | null;
  receivedNetWeightAfterDrying: string | null;
  inputMoisture: string | null;
  inputNutCount: string | null;
  inputKor: string | null;
  outputMoisture: string | null;
  outputNutCount: string | null;
  outputKor: string | null;
  drainageLossKg: string | null;
  lossPct: string | null;
  drainageLossKg2: string | null;
  drainageLossPct: string | null;
  goodOrDriedSacs: string | null;
  damagedNutsKgTriage: string | null;
  totalSacReceived: string | null;
  inputBagsForDrying: number | null;
  outputBagsAfterDrying: number | null;
  dryingPicking: string | null;
  remarks: string | null;
  sheetRow: number | null;
  source: string | null;
  createdAt: string;
}

/** Issued to Production Section (backend/prisma/schema.prisma's IssuedToProduction) — every field
 * is a plain string on both the sheet and the wire (no Decimal/Int columns on this model at all).
 * No site column exists on this table (see services/issuedToProduction.ts's header). */
export interface IssuedToProductionRow {
  id: string;
  btmNo: string | null;
  sNo: string | null;
  date: string | null;
  rcn: string | null;
  sourceBin: string | null;
  dryBin: string | null;
  binStatus: string | null;
  korIssued: string | null;
  nutCount: string | null;
  gk: string | null;
  moisture: string | null;
  immature: string | null;
  spotted: string | null;
  rejection: string | null;
  oilGram: string | null;
  voidGram: string | null;
  shellGram: string | null;
  ficheNo: string | null;
  bagInStockAfterDry: string | null;
  noOfBagIssuedToProduction: string | null;
  avgBagWtEmptyBag: string | null;
  bagWtEmptyBag: string | null;
  noOfPallet: string | null;
  avgPalletWt: string | null;
  palletWeightKg: string | null;
  grossWtBeforeDry: string | null;
  grossWtAfterDryingWithJuteBag: string | null;
  netWtWithoutJuteBag: string | null;
  dateOfIssueToCalibration: string | null;
  receivedByProductionNetWt: string | null;
  issuedFrom: string | null;
  diffInIssue: string | null;
  remarks: string | null;
  checkValue: string | null;
  sheetRow: number | null;
  source: string | null;
  createdAt: string;
}

/** Warehouse activity Ledger (backend/prisma/schema.prisma's WarehouseActivityLedgerEntry) — no
 * site column at all (the sheet itself has none, confirmed) — every field is a plain string. */
export interface WarehouseActivityLedgerEntry {
  id: string;
  activityDate: string | null;
  activityDateRaw: string | null;
  activityType: string | null;
  particulars: string | null;
  offloaded: string | null;
  bags: string | null;
  quantityMt: string | null;
  ficheNo: string | null;
  lotNo: string | null;
  vendor: string | null;
  rate: string | null;
  total: string | null;
  referenceNo: string | null;
  remarks: string | null;
  grossWeightWithPalletKg: string | null;
  palletCount: string | null;
  grossWeightKg: string | null;
  grossWeightWithoutPalletKg: string | null;
  netWeightKg: string | null;
  sheetRow: number | null;
  source: string | null;
  createdAt: string;
}

/** WarehouseDischarge (backend/prisma/schema.prisma) — shared by the unit-side DISCHARGEMENT
 * import and the both-sites Warehouse Receiving import, ~110 real columns (two quality panels,
 * plus a second "q1"/"q2" pair from the richer Warehouse Receiving source). Only the columns the
 * list page actually renders as table columns are declared explicitly; the index signature covers
 * every other real column so RecordDetailModal's "View all fields" still shows all of them — a
 * full hand-enumeration of ~110 fields here would be far more likely to drift from schema.prisma
 * than to help, unlike DryingBatch/DryingSortingReport's much smaller models above. */
export interface WarehouseDischargeRow {
  id: string;
  sn: number;
  warehouseSite: string;
  warehouse: string | null;
  lotNo: string;
  ficheCca: string;
  truckNo: string | null;
  arrivalDate: string | null;
  arrivalDateRaw: string | null;
  dischargeDate: string | null;
  dischargeDateRaw: string | null;
  origin: string | null;
  supplierName: string | null;
  totalRecd: number | null;
  netWeight: string | null;
  [key: string]: unknown;
}
