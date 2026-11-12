import type { SiteSlug } from "../config/sites";
import { useSites } from "../state/SiteContext";

interface Props {
  value: SiteSlug | "";
  onChange: (value: SiteSlug | "") => void;
  /** Pass both to list each site's stores (the warehouses of Masters › Warehouses) under it: the page filters by
   * `store` ("" = the whole site) and `onPickStore` gets the site and the store picked. */
  store?: string;
  onPickStore?: (site: SiteSlug, store: string) => void;
}

const SEP = "|";

/**
 * The site-switching control on a page under `/:site/*`, where `onChange` navigates to the other site's URL. Lists
 * the warehouses of the master this person may open (useSites): only an admin has more than one, so for everyone
 * else it renders nothing. The jute pages filter by a warehouse of the master instead (components/jute/WarehouseFilter).
 */
export function SiteSwitcher({ value, onChange, store, onPickStore }: Props) {
  const sites = useSites();
  if (sites.length < 2) return null;
  const withStores = Boolean(onPickStore);
  return (
    <select
      aria-label="Warehouse"
      value={withStores && store ? `${value}${SEP}${store}` : value}
      onChange={(e) => {
        const [slug, picked = ""] = e.target.value.split(SEP);
        if (withStores) onPickStore!(slug!, picked);
        else onChange(slug!);
      }}
      className="px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] font-semibold text-warmstone-800 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700"
    >
      {withStores
        ? sites.map((s) => (
            <optgroup key={s.slug} label={`${s.sublabel} · ${s.label}`}>
              <option value={s.slug}>All of {s.sublabel}</option>
              {s.stores.map((st) => <option key={st} value={`${s.slug}${SEP}${st}`}>{st}</option>)}
            </optgroup>
          ))
        : sites.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.sublabel} · {s.label}
            </option>
          ))}
    </select>
  );
}
