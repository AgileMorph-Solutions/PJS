import { createContext, useContext, useEffect, type ReactNode } from "react";
import { Link, Outlet, matchPath, useLocation, useNavigate, useParams } from "react-router-dom";
import { SITES, isSiteSlug, type SiteConfig, type SiteSlug } from "../config/sites";

const SiteCtx = createContext<SiteConfig | null>(null);

/** Reads the `:site` param a page is rendered under and resolves it to a real SiteConfig. Every
 * page inside the `/:site/*` route tree calls this instead of re-parsing useParams itself, so
 * there's exactly one place that decides what an unrecognized slug means (see SiteLayout below). */
export function useSite(): SiteConfig {
  const ctx = useContext(SiteCtx);
  if (!ctx) throw new Error("useSite must be used within the /:site route tree (SiteLayout)");
  return ctx;
}

/**
 * Navigate-mode for `components/SiteSwitcher.tsx`, used by every page under `/:site/*`: swaps just
 * the `:site` segment of the current URL, keeping the same leaf, any nested id, and the query
 * string — `/unit/receipts/REC-1?status=x` -> `/central/receipts/REC-1?status=x`. Only callable
 * from inside the `/:site/*` tree (same requirement as useSite()), since there's no current site
 * segment to swap otherwise.
 */
export function useSwitchSite() {
  const navigate = useNavigate();
  const location = useLocation();
  const { site } = useParams<{ site: string }>();
  return (target: SiteSlug) => {
    if (!site) return;
    const rest = location.pathname.slice(`/${site}`.length);
    navigate(`/${target}${rest}${location.search}`);
  };
}

const LAST_SITE_KEY = "anagroci.lastSite";

function readLastSite(): SiteSlug {
  try {
    const stored = localStorage.getItem(LAST_SITE_KEY);
    if (isSiteSlug(stored ?? undefined)) return stored as SiteSlug;
  } catch {
    // Private window / blocked storage — fall through to the default below.
  }
  return "unit";
}

/**
 * "Which site's data should the nav / a page's SiteSwitcher point at right now" — resolved from
 * the URL when we're already under `/:site/*` (the source of truth there), or the last site the
 * user was actually looking at otherwise (Dashboard, Masters, Jute pages have no `:site` of their
 * own), or "unit" if neither exists yet. Every resolution from a real URL is remembered, so
 * following "Truck Reception" from the Dashboard lands back wherever you last were, not always
 * back at Bouaké.
 */
export function useActiveSite(): SiteConfig {
  const location = useLocation();
  const match = matchPath("/:site/*", location.pathname);
  const fromUrl = isSiteSlug(match?.params.site) ? match.params.site : undefined;

  useEffect(() => {
    if (!fromUrl) return;
    try {
      localStorage.setItem(LAST_SITE_KEY, fromUrl);
    } catch {
      // Nothing to do if storage is unavailable — this is a convenience, not a requirement.
    }
  }, [fromUrl]);

  return SITES[fromUrl ?? readLastSite()];
}

/**
 * The `/:site/*` route's own element. `:site` is an unconstrained path segment — react-router will
 * happily match `/nonsense/receipts` — so this is the one place that turns an unrecognized slug
 * into a visible, honest "not found" rather than quietly resolving to `undefined` and letting every
 * downstream page guess. No redirect: a mistyped/stale link should tell the visitor it's wrong, not
 * silently land them somewhere else that looks plausible.
 */
export function SiteLayout() {
  const { site } = useParams<{ site: string }>();
  if (!isSiteSlug(site)) {
    return (
      <div className="p-10 max-w-md">
        <div className="w-11 h-11 rounded-2xl bg-danger-100 text-danger-700 flex items-center justify-center mb-4">
          <span className="material-symbols-outlined">signpost</span>
        </div>
        <h2 className="text-lg font-bold text-warmstone-900 mb-1.5">No such warehouse section</h2>
        <p className="text-sm text-warmstone-500 leading-relaxed mb-4">
          "{site}" isn't a recognized warehouse section — it must be one of{" "}
          {Object.keys(SITES).map((s, i) => (
            <span key={s}>
              {i > 0 && " or "}
              <code className="font-mono">{s}</code>
            </span>
          ))}
          .
        </p>
        <Link to="/" className="text-sm font-semibold text-brand-700 hover:text-brand-800">
          Back to Dashboard
        </Link>
      </div>
    );
  }
  return (
    <SiteCtx.Provider value={SITES[site]}>
      <Outlet />
    </SiteCtx.Provider>
  );
}

/** Guards a nav leaf that only makes sense at one site (Dispatch to Central / Issue to Production)
 * — visiting it from the other site's URL redirects to that site's Receipts page rather than
 * rendering a page whose data source doesn't exist there. */
export function RequireSite({ slug, children }: { slug: SiteSlug; children: ReactNode }) {
  const site = useSite();
  if (site.slug !== slug) {
    return <WrongSiteNotice thisSlug={site.slug} wantedSlug={slug} />;
  }
  return <>{children}</>;
}

function WrongSiteNotice({ thisSlug, wantedSlug }: { thisSlug: SiteSlug; wantedSlug: SiteSlug }) {
  return (
    <div className="p-10 max-w-md">
      <h2 className="text-lg font-bold text-warmstone-900 mb-1.5">Not available in this section</h2>
      <p className="text-sm text-warmstone-500 leading-relaxed mb-4">
        This page belongs to {SITES[wantedSlug].label} ({SITES[wantedSlug].sublabel}), not{" "}
        {SITES[thisSlug].label} ({SITES[thisSlug].sublabel}).
      </p>
      <Link to={`/${wantedSlug}/receipts`} className="text-sm font-semibold text-brand-700 hover:text-brand-800">
        Go to {SITES[wantedSlug].label} →
      </Link>
    </div>
  );
}
