import type { SiteSlug } from "../config/sites";
import { useSites } from "../state/SiteContext";

interface Props {
  value: SiteSlug | "";
  onChange: (value: SiteSlug | "") => void;
  /** Pass both to pick a STORE instead of a site (Reception works one store at a time): each site is only a heading
   * over its stores, and `onPickStore` gets the site and the store picked. A site with no store yet is offered
   * itself, with store "". */
  store?: string;
  onPickStore?: (site: SiteSlug, store: string) => void;
  /** One more option under the current site in store mode, e.g. Reception's "No store" view. */
  extraOption?: { store: string; label: string };
}

const SEP = "|";

const selectCls =
  "px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] font-semibold text-warmstone-800 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";

/**
 * The site- or store-switching control on a page under `/:site/*`. Lists what this person may open (useSites): only
 * an admin has more than one site, and only someone over a whole site has more than one store, so for everyone else
 * it renders nothing. The jute pages filter by a warehouse of the master instead (components/jute/WarehouseFilter).
 */
export function SiteSwitcher({ value, onChange, store, onPickStore, extraOption }: Props) {
  const sites = useSites();

  if (!onPickStore) {
    if (sites.length < 2) return null;
    return (
      <select aria-label="Warehouse" value={value} onChange={(e) => onChange(e.target.value)} className={selectCls}>
        {sites.map((s) => (
          <option key={s.slug} value={s.slug}>
            {s.sublabel} · {s.label}
          </option>
        ))}
      </select>
    );
  }

  const choices = sites.reduce((n, s) => n + Math.max(s.stores.length, 1), 0) + (extraOption ? 1 : 0);
  if (choices < 2) return null;
  return (
    <select
      aria-label="Warehouse"
      value={`${value}${SEP}${store ?? ""}`}
      onChange={(e) => {
        const [slug, picked = ""] = e.target.value.split(SEP);
        onPickStore(slug!, picked);
      }}
      className={selectCls}
    >
      {sites.map((s) => (
        <optgroup key={s.slug} label={s.sublabel}>
          {s.stores.length === 0 && <option value={`${s.slug}${SEP}`}>{s.sublabel}</option>}
          {s.stores.map((st) => (
            <option key={st} value={`${s.slug}${SEP}${st}`}>
              {st}
            </option>
          ))}
          {extraOption && s.slug === value && <option value={`${s.slug}${SEP}${extraOption.store}`}>{extraOption.label}</option>}
        </optgroup>
      ))}
    </select>
  );
}
