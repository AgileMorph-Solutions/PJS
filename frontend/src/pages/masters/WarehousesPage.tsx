import { useMemo, useState, type FormEvent } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { Pill } from "../../components/ui/Pill";
import { siteSetupGaps } from "@anagroci/contract/domain/siteType";
import { useTracking } from "../../state/TrackingContext";
import { useMe } from "../../state/AuthContext";
import { api } from "../../repository/api";
import { WAREHOUSE_TYPES } from "../../data/warehouseTypes";
import { useSites } from "../../state/SiteContext";
import { WAREHOUSE_KINDS, type WarehouseKind } from "../../data/warehouseKinds";
import type { WarehouseMaster } from "../../types/receipt";

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
      {error && <span role="alert" className="text-[12px] text-danger-700">{error}</span>}
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
      {error && <span role="alert" className="text-[12px] text-danger-700">{error}</span>}
    </span>
  );
}

export function WarehousesPage() {
  const { masters, addWarehouse, receipts } = useTracking();
  const isAdmin = useMe().role === "admin";
  // Every site of the master for an admin; only their own warehouse for anyone else (the API scopes it too).
  const sites = useSites();
  const [name, setName] = useState("");
  const [type, setType] = useState("");

  /** A site's stores, as config/sites.ts resolved them (a store's `site` may hold the site name or an alias). The
   * site's own row is not listed under itself: it already IS the section heading. */
  const storesFor = (site: (typeof sites)[number]): WarehouseMaster[] =>
    masters.warehouses.filter((w) => site.stores.includes(w.name));

  /** Rows that belong to no site — an imported name nobody has classified yet. Shown rather than silently vanishing,
   * so an admin can give it a type and make it a site. */
  const unclassified = useMemo(() => {
    const placed = new Set(sites.flatMap((s) => [s.warehouseName, ...s.stores]));
    return masters.warehouses.filter((w) => !placed.has(w.name));
  }, [masters.warehouses, sites]);

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
              {sites.length > 0 && (
                <optgroup label="Store under an existing site">
                  {sites.map((s) => (
                    <option key={s.slug} value={encodeChoice({ group: "store", site: s.warehouseName })}>
                      {s.sublabel} · {s.label}
                    </option>
                  ))}
                </optgroup>
              )}
              {/* A new site becomes a section of the app and something users are assigned to: an admin's call. */}
              {isAdmin && (
                <optgroup label="New site">
                  {WAREHOUSE_KINDS.map((k) => (
                    <option key={k.value} value={encodeChoice({ group: "site", kind: k.value })}>
                      {k.label}
                    </option>
                  ))}
                </optgroup>
              )}
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

      {sites.length === 0 && (
        <div className="bg-white border border-warmstone-200 rounded-2xl shadow-xs px-5 py-4 text-[13px] text-warmstone-500">
          {isAdmin ? "No warehouse is ready yet. Add one above (New site), then give it a Unit/Central type and an ID code so users can be assigned to it." : "Your account isn't assigned to a warehouse yet. Ask an admin."}
        </div>
      )}

      {/* Each site IS a warehouse row of the master (the one users are assigned to), so it is shown as one, with its
          stores under it, rather than as a heading that reads like a label. */}
      {sites.map((site) => {
        const row = masters.warehouses.find((w) => w.name === site.warehouseName);
        const stores = storesFor(site);
        return (
          <div key={site.slug} className="bg-white border border-warmstone-200 rounded-2xl shadow-xs divide-y divide-warmstone-100">
            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3 text-[13px]">
              <span className="flex flex-wrap items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-brand-700">warehouse</span>
                <span className="font-bold text-warmstone-900">{site.warehouseName}</span>
                <Pill tone="system" label={site.label} />
                {row && isAdmin && <TypeSelect warehouse={row} />}
                {row && <CodeInput key={`${row.name}:${row.code ?? ""}`} warehouse={row} editable={isAdmin} />}
              </span>
              <span className="text-warmstone-500 tabular-nums">
                {stores.length} {stores.length === 1 ? "store" : "stores"} · {receipts.filter((r) => r.warehouse === site.warehouseName).length} receipts
              </span>
            </div>
            {stores.map((w) => (
              <div key={w.name} className="flex items-center justify-between gap-4 pl-12 pr-5 py-3 text-[13px]">
                <span className="text-warmstone-800 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px] text-warmstone-400">subdirectory_arrow_right</span>
                  {w.name}
                </span>
                <span className="text-warmstone-500 tabular-nums">{receipts.filter((r) => r.warehouse === w.name).length} receipts</span>
              </div>
            ))}
            {!stores.length && (
              <div className="pl-12 pr-5 py-3 text-[13px] text-warmstone-500">No stores under this warehouse yet.</div>
            )}
          </div>
        );
      })}

      {unclassified.length > 0 && (
        <div>
          <h3 className="px-1 mb-2 text-[11px] font-bold text-warmstone-500 uppercase tracking-wider">
            Not ready to use
          </h3>
          <p className="px-1 mb-2 text-[12px] text-warmstone-500">
            A warehouse is offered for users, production and transfers only once it has a Unit/Central type and an ID code.
            Until then nobody can work there. If one of these was meant to be a store, it should be under its warehouse instead.
          </p>
          <div className="bg-white border border-warmstone-200 rounded-2xl shadow-xs divide-y divide-warmstone-100">
            {unclassified.map((w) => {
              const gaps = siteSetupGaps(w);
              return (
                <div key={w.name} className="flex flex-wrap items-center justify-between gap-4 px-5 py-3 text-[13px]">
                  <span className="font-semibold text-warmstone-800 flex flex-wrap items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-ambernut-700">warning</span>
                    {w.name}
                    {w.site
                      ? <span className="text-[12px] font-normal text-warmstone-500">store of {w.site}, which isn't ready either</span>
                      : <Pill tone="decision" label={`Needs ${gaps.join(" and ")}`} />}
                    {isAdmin && !w.site && <TypeSelect warehouse={w} />}
                    {!w.site && <CodeInput key={`${w.name}:${w.code ?? ""}`} warehouse={w} editable={isAdmin} />}
                  </span>
                  <span className="text-warmstone-500 tabular-nums">{receipts.filter((r) => r.warehouse === w.name).length} receipts</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
