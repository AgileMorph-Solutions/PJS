import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useTracking } from "../state/TrackingContext";
import { SITES, type SiteSlug } from "../config/sites";

/**
 * The pre-split app had one flat `/procurement/*` tree; every page there is now under `/:site/*`
 * (see App.tsx). Old links/bookmarks need to land somewhere real rather than 404 — this file is
 * every rule for "somewhere real".
 *
 * `receipt.warehouse` is always exactly "BOUAKE" or "YAKRO FACTORY" (verified against the live DB —
 * see backend/src/domain/imports/offloadings.ts, which sets it straight from the sheet's own
 * "WH LOCATION" column with no store-level granularity), so this is a plain lookup table, not a
 * guess dressed up as one.
 */
const SITE_BY_WAREHOUSE: Record<string, SiteSlug> = {
  [SITES.unit.warehouseName]: "unit",
  [SITES.central.warehouseName]: "central",
};

/** Bouaké is the default for a legacy URL with nothing to resolve by — it's the larger of the two
 * sites (685 vs 301 receipts, measured against the live DB), so it's the section a stale bookmark
 * is more likely to have meant. Not a guarantee, just the least-wrong default. */
const DEFAULT_SITE: SiteSlug = "unit";

/** `/procurement/receipts`, `/procurement/stock`, `/procurement/drying` had an in-page
 * "?warehouse=" filter (Receipts only) — if the old URL still carries one that resolves to a real
 * site, honor it; otherwise fall back to DEFAULT_SITE. `leaf` is "receipts" | "stock" | "drying".
 *
 * Every OTHER query param is forwarded as-is (Dashboard's KPI tiles still link here with
 * `?status=...` — see pages/DashboardPage.tsx, which has no single site to point at since it
 * aggregates both) — only `warehouse` itself is consumed, since the destination section is now the
 * warehouse filter and re-adding it as a query param on e.g. /unit/receipts would be redundant. */
export function LegacyListRedirect({ leaf }: { leaf: string }) {
  const [params] = useSearchParams();
  const rawWarehouse = params.get("warehouse");
  const site = (rawWarehouse && SITE_BY_WAREHOUSE[rawWarehouse]) || DEFAULT_SITE;
  const rest = new URLSearchParams(params);
  rest.delete("warehouse");
  const qs = rest.toString();
  return <Navigate to={`/${site}/${leaf}${qs ? `?${qs}` : ""}`} replace />;
}

/** `/procurement/receipts/:id` — resolves via the receipt's OWN warehouse, not a default, since
 * this one has a real answer available (unlike the list pages above, which have no single record
 * to ask). Receipts are loaded at app boot (see App.tsx's LoadGate), so by the time this route can
 * even render, `receipts` is already populated except on a direct, fresh page load mid-fetch —
 * handled below rather than flashing the wrong site's URL. */
export function LegacyReceiptDetailRedirect() {
  const { id = "" } = useParams();
  const { receipts, loading } = useTracking();
  const receipt = receipts.find((r) => r.id === id);
  if (!receipt && loading) {
    return <div className="p-10 text-warmstone-400 text-sm">Loading…</div>;
  }
  const site = (receipt && SITE_BY_WAREHOUSE[receipt.warehouse]) || DEFAULT_SITE;
  return <Navigate to={`/${site}/receipts/${id}`} replace />;
}

/** `/procurement/receipts/new/:id/:stageId` — same resolution as the detail page above; a
 * newly-created receipt only ever existed post-split (created via the site-scoped "New RCN
 * receipt" button), so this path only matters for a genuinely old in-flight link. */
export function LegacyIntakeRedirect() {
  const { id = "", stageId = "" } = useParams();
  const { receipts, loading } = useTracking();
  const receipt = receipts.find((r) => r.id === id);
  if (!receipt && loading) {
    return <div className="p-10 text-warmstone-400 text-sm">Loading…</div>;
  }
  const site = (receipt && SITE_BY_WAREHOUSE[receipt.warehouse]) || DEFAULT_SITE;
  return <Navigate to={`/${site}/receipts/new/${id}/${stageId}`} replace />;
}
