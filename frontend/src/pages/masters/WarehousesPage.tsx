import { useMemo, useState, type FormEvent } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { useTracking } from "../../state/TrackingContext";
import { useMe } from "../../state/AuthContext";
import { api } from "../../repository/api";
import { WAREHOUSE_TYPES } from "../../data/warehouseTypes";
import { SITE_LIST, siteSlugForWarehouse, siteSlugForSiteName, type SiteSlug } from "../../config/sites";
import { WAREHOUSE_KINDS, type WarehouseKind } from "../../data/warehouseKinds";
import type { WarehouseMaster } from "../../types/receipt";

/**
 * Grouped by site rather than one flat list — a row is a SITE itself (has a `kind`) or a STORE
 * under one (has a `site`). A store's `site` can legitimately hold either the canonical site name
 * or one of its known aliases (see config/sites.ts's own comment on a real, live data quirk: which
 * one it currently is depends on execution order between a seed backfill and a real workbook
 * upload) — `siteSlugForSiteName` checks both, so a store still lands in the right section either
 * way. Anything that resolves to neither (no kind, no site, or a site value this app doesn't
 * recognize) goes in "Unclassified" rather than silently vanishing from the page.
 */
function bucketFor(w: WarehouseMaster): SiteSlug | "unclassified" {
  if (w.kind) return siteSlugForWarehouse(w.name) ?? "unclassified";
  if (w.site) return siteSlugForSiteName(w.site) ?? "unclassified";
  return "unclassified";
}

/** Every value the "Type" select can produce, each mapping to exactly one of `{kind}` / `{site}` —
 * never both, matching Warehouse's Site -> Store hierarchy (see backend/services/masters.ts). */
type TypeChoice =
  | { group: "site"; kind: WarehouseKind }
  | { group: "store"; site: string };

function encodeChoice(c: TypeChoice): string {
  return c.group === "site" ? `site:${c.kind}` : `store:${c.site}`;
}

function decodeChoice(value: string): TypeChoice | null {
  const [group, rest] = value.split(":");
  if (group === "site" && rest) return { group: "site", kind: rest as WarehouseKind };
  if (group === "store" && rest) return { group: "store", site: rest };
  return null;
}

/** Admin-only Unit/Central assignment for a SITE. Users can only be assigned to a typed site, so
 * this is where a warehouse becomes assignable. The API refuses to clear a type while active users
 * are pinned to it, and shows that message here rather than failing silently. */
function TypeSelect({ warehouse }: { warehouse: WarehouseMaster }) {
  const { refresh } = useTracking();
  const [error, setError] = useState<string | null>(null);
  async function change(value: string) {
    setError(null);
    try {
      await api.setWarehouseType(warehouse.name, value || null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <select
        aria-label={`Unit/Central type for ${warehouse.name}`}
        value={warehouse.type ?? ""}
        onChange={(e) => void change(e.target.value)}
        className="px-2.5 py-1 rounded-lg border border-warmstone-200 bg-warmstone-50 text-[12px] font-semibold text-warmstone-800 outline-none focus:border-brand-700"
      >
        <option value="">No type</option>
        {WAREHOUSE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      {error && <span role="alert" className="text-[11.5px] text-danger-700">{error}</span>}
    </span>
  );
}

/** Admin-only: the code printed into every ID issued at this site (REC-<code>-2027-001). Saved when
 * the field loses focus or Enter is pressed. The API refuses to change it once an ID carries it, and
 * says why here. Everyone else sees it read-only — and an empty one is called out, because a site
 * with no code can't issue a Receipt ID, Lot or Delivery Plan. */
function CodeInput({ warehouse, editable }: { warehouse: WarehouseMaster; editable: boolean }) {
  const { refresh } = useTracking();
  const [value, setValue] = useState(warehouse.code ?? "");
  const [error, setError] = useState<string | null>(null);
  async function save() {
    const next = value.trim().toUpperCase();
    if (next === (warehouse.code ?? "")) return;
    setError(null);
    try {
      await api.setWarehouseCode(warehouse.name, next || null);
      setValue(next);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setValue(warehouse.code ?? "");
    }
  }
  if (!editable) {
    return warehouse.code ? (
      <span className="text-[12px] font-mono font-semibold text-warmstone-600">ID code {warehouse.code}</span>
    ) : (
      <span className="text-[12px] font-semibold text-ambernut-800">No ID code yet - no IDs can be issued here</span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 normal-case">
      <input
        aria-label={`ID code for ${warehouse.name}`}
        value={value}
        onChange={(e) => setValue(e.target.value.toUpperCase())}
        onBlur={() => void save()}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur())}
        placeholder="ID code, e.g. BKE"
        maxLength={12}
        className="w-36 px-2.5 py-1 rounded-lg border border-warmstone-200 bg-warmstone-50 text-[12px] font-mono font-semibold text-warmstone-800 outline-none focus:border-brand-700"
      />
      {error && <span role="alert" className="text-[11.5px] text-danger-700">{error}</span>}
    </span>
  );
}

export function WarehousesPage() {
  const { masters, addWarehouse, receipts } = useTracking();
  const isAdmin = useMe().role === "admin";
  const [name, setName] = useState("");
  const [type, setType] = useState("");

  const groups = useMemo(() => {
    const byBucket = new Map<SiteSlug | "unclassified", WarehouseMaster[]>();
    for (const w of masters.warehouses) {
      const bucket = bucketFor(w);
      if (!byBucket.has(bucket)) byBucket.set(bucket, []);
      byBucket.get(bucket)!.push(w);
    }
    return byBucket;
  }, [masters.warehouses]);

  /** The site's own row (BOUAKE, YAKRO FACTORY) is deliberately excluded from the list below its
   * section — that row already IS the section, so listing it again as one of "its own warehouses"
   * is exactly the confusing duplication this was built to avoid. Only real stores are listed. */
  function storesFor(slug: SiteSlug): WarehouseMaster[] {
    return (groups.get(slug) ?? []).filter((w) => !w.kind);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const choice = decodeChoice(type);
    if (!name.trim() || !choice) return;
    addWarehouse(name.trim().toUpperCase(), choice.group === "site" ? { kind: choice.kind } : { site: choice.site });
    setName("");
    setType("");
  }

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Masters"
        title="Warehouses"
        lede="Village, Regional Central, and Factory warehouses."
      />
      <CollapsibleCard title="Add warehouse">
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-45">
            <label htmlFor="warehouse-name" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">
              Warehouse name
            </label>
            <input
              id="warehouse-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. BONDOUKOU"
              className="w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700"
            />
          </div>
          <div className="flex-1 min-w-55">
            <label htmlFor="warehouse-type" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">
              Type
            </label>
            <select
              id="warehouse-type"
              required
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700"
            >
              <option value="" disabled>
                Select a type…
              </option>
              <optgroup label="Store under an existing site">
                {SITE_LIST.map((s) => (
                  <option key={s.slug} value={encodeChoice({ group: "store", site: s.warehouseName })}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="New site">
                {WAREHOUSE_KINDS.map((k) => (
                  <option key={k.value} value={encodeChoice({ group: "site", kind: k.value })}>
                    {k.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold transition-all shadow-sm"
          >
            <span className="material-symbols-outlined text-[17px]">add</span>
            Add warehouse
          </button>
        </form>
      </CollapsibleCard>

      {SITE_LIST.map((site) => (
        <div key={site.slug}>
          <h3 className="px-1 mb-2 text-[11px] font-bold text-warmstone-400 uppercase tracking-wider flex items-center gap-3">
            <span>
              {site.label} <span className="normal-case font-medium text-warmstone-300">· {site.sublabel}</span>
            </span>
            {(() => {
              const row = masters.warehouses.find((w) => w.name === site.warehouseName);
              if (!row) return null;
              return (
                <>
                  {isAdmin && <TypeSelect warehouse={row} />}
                  <CodeInput key={`${row.name}:${row.code ?? ""}`} warehouse={row} editable={isAdmin} />
                </>
              );
            })()}
          </h3>
          <div className="bg-white border border-warmstone-200 rounded-2xl shadow-xs divide-y divide-warmstone-100">
            {storesFor(site.slug).map((w) => (
              <div key={w.name} className="flex items-center justify-between gap-4 px-5 py-3 text-[13px]">
                <span className="font-semibold text-warmstone-800 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[17px] text-brand-700">warehouse</span>
                  {w.name}
                </span>
                <span className="text-warmstone-500 tabular-nums">{receipts.filter((r) => r.warehouse === w.name).length} receipts</span>
              </div>
            ))}
            {!storesFor(site.slug).length && (
              <div className="px-5 py-3 text-[13px] text-warmstone-400">No warehouses recorded here yet.</div>
            )}
          </div>
        </div>
      ))}

      {(groups.get("unclassified") ?? []).length > 0 && (
        <div>
          <h3 className="px-1 mb-2 text-[11px] font-bold text-warmstone-400 uppercase tracking-wider">
            Unclassified
          </h3>
          <p className="px-1 mb-2 text-[12px] text-warmstone-400">
            Not yet assigned to a site or store - see Warehouses master data.
          </p>
          <div className="bg-white border border-warmstone-200 rounded-2xl shadow-xs divide-y divide-warmstone-100">
            {(groups.get("unclassified") ?? []).map((w) => (
              <div key={w.name} className="flex items-center justify-between gap-4 px-5 py-3 text-[13px]">
                <span className="font-semibold text-warmstone-800 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[17px] text-warmstone-400">help</span>
                  {w.name}
                  {isAdmin && !w.site && <TypeSelect warehouse={w} />}
                </span>
                <span className="text-warmstone-500 tabular-nums">{receipts.filter((r) => r.warehouse === w.name).length} receipts</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
