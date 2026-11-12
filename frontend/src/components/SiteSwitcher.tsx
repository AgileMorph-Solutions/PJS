import type { SiteSlug } from "../config/sites";
import { WAREHOUSE_TYPES } from "../data/warehouseTypes";
import { useSites } from "../state/SiteContext";

interface Props {
  value: SiteSlug | "";
  onChange: (value: SiteSlug | "") => void;
}

/**
 * The warehouse-switching control on a page under `/:site/*`, where `onChange` navigates to the other warehouse's URL.
 * Lists the warehouses this person may open (useSites) under their category, Unit or Central: only an admin has more
 * than one, so for everyone else it renders nothing. The jute pages filter by warehouse instead (components/jute/WarehouseFilter).
 */
export function SiteSwitcher({ value, onChange }: Props) {
  const sites = useSites();
  if (sites.length < 2) return null;
  const uncategorised = sites.filter((s) => !s.type);
  return (
    <select
      aria-label="Warehouse"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] font-semibold text-warmstone-800 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700"
    >
      {WAREHOUSE_TYPES.map((t) => {
        const inCategory = sites.filter((s) => s.type === t.value);
        return inCategory.length ? (
          <optgroup key={t.value} label={t.label}>
            {inCategory.map((s) => <option key={s.slug} value={s.slug}>{s.sublabel}</option>)}
          </optgroup>
        ) : null;
      })}
      {uncategorised.map((s) => <option key={s.slug} value={s.slug}>{s.sublabel}</option>)}
    </select>
  );
}
