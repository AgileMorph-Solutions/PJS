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
import type { WarehouseMaster } from "../../types/receipt";

/** Admin-only: moves a warehouse to the other category (Unit/Central). Users can only be assigned to a warehouse with a
 * category, so this is part of what makes one assignable. The API refuses to clear it while active users are on the
 * warehouse, and shows that message here rather than failing silently. */
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
        aria-label={`Category of ${warehouse.name}`}
        value={warehouse.type ?? ""}
        onChange={(e) => void change(e.target.value)}
        className="px-2.5 py-1 rounded-lg border border-warmstone-200 bg-warmstone-50 text-[12px] font-semibold text-warmstone-800 outline-none focus:border-brand-700"
      >
        <option value="">No category</option>
        {WAREHOUSE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      {error && <span role="alert" className="text-[12px] text-danger-700">{error}</span>}
    </span>
  );
}

/** Admin-only: the code printed into every ID issued at this warehouse (REC-<code>-2027-001). Saved when
 * the field loses focus or Enter is pressed. The API refuses to change it once an ID carries it, and
 * says why here. Everyone else sees it read-only — and an empty one is called out, because a warehouse
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

const labelCls = "block text-[12px] font-semibold text-warmstone-700 mb-1.5";
const fieldCls =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";

/**
 * Masters › Warehouses. A warehouse (BOUAKE, YAKRO FACTORY) is a top-level row; its category is Unit Warehouse or
 * Central Warehouse (the row's `type`), which decides its section of the app. Stores under a warehouse aren't a concept
 * the app offers: any old store rows still in the database are listed under their warehouse, never offered for new use.
 */
export function WarehousesPage() {
  const { masters, addWarehouse, receipts } = useTracking();
  const isAdmin = useMe().role === "admin";
  // Every warehouse for an admin; only their own for anyone else (the API scopes it too).
  const sites = useSites();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");

  const rowOf = (n: string) => masters.warehouses.find((w) => w.name === n);
  /** Trucks of a warehouse: filed under its name, an alias, or an old store row under it. */
  const receiptCount = (site: (typeof sites)[number]) => {
    const names = new Set([site.warehouseName, ...site.aliases, ...site.stores]);
    return receipts.filter((r) => names.has(r.warehouse)).length;
  };

  /** Top-level rows that aren't ready yet (no category or no ID code) — shown rather than silently vanishing, so an
   * admin can finish them. Old store rows go with their warehouse, not here. */
  const unfinished = useMemo(() => {
    const placed = new Set(sites.flatMap((s) => [s.warehouseName, ...s.stores]));
    return masters.warehouses.filter((w) => !placed.has(w.name) && !w.site);
  }, [masters.warehouses, sites]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !category) return;
    addWarehouse(name.trim().toUpperCase(), { type: category });
    setName("");
  }

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Masters"
        title="Warehouses"
        lede="Every warehouse, under its category: Unit Warehouse or Central Warehouse. People, receipts and jute stock belong to a warehouse; a warehouse needs a category and an ID code before anyone can work there."
      />
      {/* A warehouse is a section of the app and what users are assigned to: an admin's call. */}
      {isAdmin && (
        <CollapsibleCard title="Add warehouse">
          <form onSubmit={handleSubmit} className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-45">
              <label htmlFor="warehouse-name" className={labelCls}>Warehouse name</label>
              <input id="warehouse-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. BONDOUKOU" className={fieldCls} />
            </div>
            <div className="flex-1 min-w-45">
              <label htmlFor="warehouse-category" className={labelCls}>Category</label>
              <select id="warehouse-category" required value={category} onChange={(e) => setCategory(e.target.value)} className={fieldCls}>
                <option value="" disabled>Select a category…</option>
                {WAREHOUSE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-[13px] transition-all bg-brand-700 hover:bg-brand-800 text-white font-bold shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              Add warehouse
            </button>
          </form>
          <p className="text-[12px] text-warmstone-500 mt-3">Then give it its ID code below (e.g. BKE): every receipt, Lot and plan number issued there carries it.</p>
        </CollapsibleCard>
      )}

      {sites.length === 0 && (
        <div className="bg-white border border-warmstone-200 rounded-2xl shadow-xs px-5 py-4 text-[13px] text-warmstone-500">
          {isAdmin ? "No warehouse is ready yet. Add one above, then give it an ID code so users can be assigned to it." : "Your account isn't assigned to a warehouse yet. Ask an admin."}
        </div>
      )}

      {WAREHOUSE_TYPES.map((t) => {
        const inCategory = sites.filter((s) => s.type === t.value);
        if (!inCategory.length) return null;
        return (
          <div key={t.value} className="bg-white border border-warmstone-200 rounded-2xl shadow-xs divide-y divide-warmstone-100">
            <div className="flex items-center justify-between gap-4 px-5 pt-4 pb-3">
              <h2 className="text-[15px] font-bold text-warmstone-900 flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-brand-700">category</span>
                {t.label}
              </h2>
              <span className="text-[12px] text-warmstone-500 tabular-nums">
                {inCategory.length} {inCategory.length === 1 ? "warehouse" : "warehouses"}
              </span>
            </div>
            {inCategory.map((site) => {
              const row = rowOf(site.warehouseName);
              return (
                <div key={site.slug}>
                  <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3 text-[13px]">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="material-symbols-outlined text-[18px] text-brand-700">warehouse</span>
                      <span className="font-bold text-warmstone-900">{site.warehouseName}</span>
                      {row && isAdmin && <TypeSelect warehouse={row} />}
                      {row && <CodeInput key={`${row.name}:${row.code ?? ""}`} warehouse={row} editable={isAdmin} />}
                    </span>
                    <span className="text-warmstone-500 tabular-nums">{receiptCount(site)} receipts</span>
                  </div>
                  {site.stores.length > 0 && (
                    <p className="pl-12 pr-5 pb-3 text-[12px] text-warmstone-500">
                      Old store rows, kept with this warehouse's records: {site.stores.join(", ")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {unfinished.length > 0 && (
        <div>
          <p className="px-1 mb-2 text-[11px] font-bold text-warmstone-500 uppercase tracking-wider">Not ready to use</p>
          <p className="px-1 mb-2 text-[12px] text-warmstone-500">
            A warehouse is offered for users, production and transfers only once it has a category and an ID code.
          </p>
          <div className="bg-white border border-warmstone-200 rounded-2xl shadow-xs divide-y divide-warmstone-100">
            {unfinished.map((w) => {
              const gaps = siteSetupGaps(w).map((g) => (g === "a Unit/Central type" ? "a category" : g));
              return (
                <div key={w.name} className="flex flex-wrap items-center justify-between gap-4 px-5 py-3 text-[13px]">
                  <span className="font-semibold text-warmstone-800 flex flex-wrap items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-ambernut-700">warning</span>
                    {w.name}
                    <Pill tone="decision" label={`Needs ${gaps.join(" and ")}`} />
                    {isAdmin && <TypeSelect warehouse={w} />}
                    <CodeInput key={`${w.name}:${w.code ?? ""}`} warehouse={w} editable={isAdmin} />
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
