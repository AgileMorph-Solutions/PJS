import { SITE_LIST, isSiteSlug, type SiteSlug } from "../config/sites";
import { useMe } from "../state/AuthContext";

interface Props {
  value: SiteSlug | "";
  onChange: (value: SiteSlug | "") => void;
  /**
   * Filter-mode pages (the jute ledger pages — a ledger-4 row can legitimately belong to both
   * sites at once) show an "All" option alongside the two sites. Navigate-mode pages (Receipts,
   * Stock, Drying, Dispatch, Issue-to-Production) never do — a URL under `/:site/*` is always
   * exactly one site, so there's nothing "All" would even navigate to.
   */
  allowAll?: boolean;
}

/**
 * The one site-switching control, used two ways (see this component's callers): on a page under
 * `/:site/*`, `onChange` navigates to the other site's URL; on a jute ledger page, it just sets a
 * local filter. This component only renders the dropdown and reports which was picked — it has no
 * opinion on what picking one *does*, which is what keeps both call sites simple.
 */
export function SiteSwitcher({ value, onChange, allowAll }: Props) {
  // Only admin can look across warehouses; everyone else is pinned to theirs by the API.
  if (useMe().role !== "admin") return null;
  return (
    <select
      value={value}
      onChange={(e) => onChange(isSiteSlug(e.target.value) ? e.target.value : "")}
      className="px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] font-semibold text-warmstone-800 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700"
    >
      {allowAll && <option value="">All warehouses</option>}
      {SITE_LIST.map((s) => (
        <option key={s.slug} value={s.slug}>
          {s.label}
        </option>
      ))}
    </select>
  );
}
