import { createContext, useContext, useEffect, useMemo } from "react";
import { Link, Navigate, Outlet, matchPath, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { sitesFrom, warehouseSlug, type SiteConfig, type SiteSlug } from "../config/sites";
import { homePathFor, useMe } from "./AuthContext";
import { useTracking } from "./TrackingContext";
import { isWarehouseType } from "../data/warehouseTypes";
import type { UserView } from "../types/user";

const SiteCtx = createContext<SiteConfig | null>(null);

/**
 * The sections this person may open: every site in the Warehouses master for an admin, only their own warehouse for
 * everyone else. The API already scopes /api/masters to the viewer's warehouse; this filters again so a screen never
 * offers another site even if the master were to include one.
 */
export function useSites(): SiteConfig[] {
  const me = useMe();
  const { masters } = useTracking();
  return useMemo(() => {
    const all = sitesFrom(masters);
    if (me.role === "admin") return all;
    // A user works at a store (BKE-001); their section is the site it belongs to (BOUAKE). The API narrows the data to
    // their store — this only picks which section's pages they see.
    const own = all.find((s) => s.warehouseName === (me.site ?? me.warehouse)) ?? ownFallback(me);
    return own ? [own] : [];
  }, [masters, me]);
}

/** A non-admin's own section before (or without) its master row — from what the session itself says. */
function ownFallback(me: UserView): SiteConfig | undefined {
  const site = me.site ?? me.warehouse;
  if (!site) return undefined;
  const type = isWarehouseType(me.warehouseType) ? me.warehouseType : null;
  return { slug: warehouseSlug(site), label: "Warehouse", sublabel: site, warehouseName: site, aliases: [], stores: me.warehouse && me.warehouse !== site ? [me.warehouse] : [], type };
}

/** Reads the `:site` param a page is rendered under, resolved to its master row by SiteLayout below. */
export function useSite(): SiteConfig {
  const ctx = useContext(SiteCtx);
  if (!ctx) throw new Error("useSite must be used within the /:site route tree (SiteLayout)");
  return ctx;
}

/**
 * Navigate-mode for `components/SiteSwitcher.tsx`: swaps just the `:site` segment of the current URL, keeping the
 * leaf, any nested id and the query string. Only callable inside the `/:site/*` tree.
 */
export function useSwitchSite() {
  const navigate = useNavigate();
  const location = useLocation();
  const { site } = useParams<{ site: string }>();
  /** `params` sets (a string) or clears (null) query parameters on the way, e.g. the `store` filter, which names a
   * store of one site and would match nothing at another. */
  return (target: SiteSlug, params?: Record<string, string | null>) => {
    if (!site) return;
    const rest = location.pathname.slice(`/${site}`.length);
    const search = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(params ?? {})) if (v) search.set(k, v); else search.delete(k);
    const qs = search.toString();
    navigate(`/${target}${rest}${qs ? `?${qs}` : ""}`);
  };
}

/** The `?store=` value for Reception's view of a site's trucks that are at no store (contract's receiptStore is null). */
export const NO_STORE = "none";

/**
 * Which store Reception is showing: Reception works one store (BKE-001) at a time, and the site above it (BOUAKE) is
 * only the group it sits in. `?store=` when it names one of this site's stores (or NO_STORE), else the person's own
 * store, else the site's first. "" only when the site has no store at all, in which case the site is the one place.
 * Shared by the list and the batch grid, so the store a truck is entered at is the store being looked at.
 */
export function useReceptionStore(): { store: string; isNoStore: boolean } {
  const site = useSite();
  const me = useMe();
  const [params] = useSearchParams();
  const asked = params.get("store") ?? "";
  if (asked === NO_STORE && site.stores.length) return { store: NO_STORE, isNoStore: true };
  if (site.stores.includes(asked)) return { store: asked, isNoStore: false };
  const own = me.warehouse && site.stores.includes(me.warehouse) ? me.warehouse : undefined;
  return { store: own ?? site.stores[0] ?? "", isNoStore: false };
}

const LAST_SITE_KEY = "anagroci.lastSite";

function readLastSite(): string | null {
  try {
    return localStorage.getItem(LAST_SITE_KEY);
  } catch {
    return null; // Private window / blocked storage.
  }
}

/**
 * "Which section should the nav and site links point at right now": the URL's own `:site` when it names one of this
 * person's sections, else the last one they looked at, else the first. A non-admin only ever has their own. Null when
 * there is no section at all yet (no warehouse in the master) — callers leave site links out rather than invent one.
 */
export function useActiveSite(): SiteConfig | null {
  const sites = useSites();
  const location = useLocation();
  const match = matchPath("/:site/*", location.pathname);
  const fromUrl = sites.find((s) => s.slug === match?.params.site);

  useEffect(() => {
    if (!fromUrl) return;
    try {
      localStorage.setItem(LAST_SITE_KEY, fromUrl.slug);
    } catch {
      // A convenience, not a requirement.
    }
  }, [fromUrl]);

  if (fromUrl) return fromUrl;
  const last = readLastSite();
  return sites.find((s) => s.slug === last) ?? sites[0] ?? null;
}

/** Links from before sections came from the master used fixed `/unit/*` and `/central/*` URLs. */
const LEGACY_TYPE: Record<string, string> = { unit: "UNIT", central: "CENTRAL" };

/**
 * The `/:site/*` route's own element: resolves `:site` against this person's sections. A non-admin asking for any
 * section but their own goes home (the API would refuse it anyway). An old `/unit/*` or `/central/*` link goes to the
 * first section of that type; anything else unrecognized says so plainly, rather than landing somewhere plausible.
 */
export function SiteLayout() {
  const me = useMe();
  const sites = useSites();
  const location = useLocation();
  const { site } = useParams<{ site: string }>();
  const current = sites.find((s) => s.slug === site);

  if (!current) {
    const legacy = site && LEGACY_TYPE[site] ? sites.find((s) => s.type === LEGACY_TYPE[site]) : undefined;
    if (legacy) return <Navigate to={`/${legacy.slug}${location.pathname.slice(`/${site}`.length)}${location.search}`} replace />;
    if (me.role !== "admin") return <Navigate to={homePathFor(me)} replace />;
    return (
      <div className="p-10 max-w-md">
        <div className="w-11 h-11 rounded-2xl bg-danger-100 text-danger-700 flex items-center justify-center mb-4">
          <span className="material-symbols-outlined">signpost</span>
        </div>
        <h2 className="text-lg font-bold text-warmstone-900 mb-1.5">No such warehouse</h2>
        <p className="text-sm text-warmstone-500 leading-relaxed mb-4">
          "{site}" isn't a warehouse in Masters › Warehouses.{" "}
          {sites.length ? `Open one of: ${sites.map((s) => s.sublabel).join(", ")}.` : "No warehouse has been added yet."}
        </p>
        <Link to="/masters/warehouses" className="text-sm font-semibold text-brand-700 hover:text-brand-800">
          Go to Masters › Warehouses
        </Link>
      </div>
    );
  }
  return (
    <SiteCtx.Provider value={current}>
      <Outlet />
    </SiteCtx.Provider>
  );
}
