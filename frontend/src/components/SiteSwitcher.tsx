import type { SiteSlug } from "../config/sites";
import { useSites } from "../state/SiteContext";

interface Props {
  value: SiteSlug | "";
  onChange: (value: SiteSlug | "") => void;
}

/**
 * The site-switching control on a page under `/:site/*`, where `onChange` navigates to the other site's URL. Lists
 * the warehouses of the master this person may open (useSites): only an admin has more than one, so for everyone
 * else it renders nothing. The jute pages filter by a warehouse of the master instead (components/jute/WarehouseFilter).
 */
export function SiteSwitcher({ value, onChange }: Props) {
  const sites = useSites();
  if (sites.length < 2) return null;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] font-semibold text-warmstone-800 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700"
    >
      {sites.map((s) => (
        <option key={s.slug} value={s.slug}>
          {s.sublabel} · {s.label}
        </option>
      ))}
    </select>
  );
}
