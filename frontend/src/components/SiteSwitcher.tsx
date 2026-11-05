import { SITE_LIST, isSiteSlug, type SiteSlug } from "../config/sites";
import { useMe } from "../state/AuthContext";

interface Props {
  value: SiteSlug | "";
  onChange: (value: SiteSlug | "") => void;
}

/**
 * The site-switching control on a page under `/:site/*`, where `onChange` navigates to the other site's URL. The jute pages
 * filter by a warehouse of the master instead (components/jute/WarehouseFilter).
 */
export function SiteSwitcher({ value, onChange }: Props) {
  // Only admin can look across warehouses; everyone else is pinned to theirs by the API.
  if (useMe().role !== "admin") return null;
  return (
    <select
      value={value}
      onChange={(e) => onChange(isSiteSlug(e.target.value) ? e.target.value : "")}
      className="px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] font-semibold text-warmstone-800 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700"
    >
      {SITE_LIST.map((s) => (
        <option key={s.slug} value={s.slug}>
          {s.label}
        </option>
      ))}
    </select>
  );
}
