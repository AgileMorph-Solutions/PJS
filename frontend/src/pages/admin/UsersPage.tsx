import { useMemo, useState, type FormEvent } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { Pill } from "../../components/ui/Pill";
import { useTracking } from "../../state/TrackingContext";
import { useUsers } from "../../state/userManagement";
import { api } from "../../repository/api";
import { ROLES, ROLE_LABEL, type Role } from "../../data/roles";
import { WAREHOUSE_TYPES, WAREHOUSE_TYPE_LABEL, type WarehouseType } from "../../data/warehouseTypes";
import type { WarehouseMaster } from "../../types/receipt";
import { Field, Select } from "../../components/ui/Input";
import { listSites } from "@anagroci/contract/domain/siteType";
import type { UserView } from "../../types/user";
import { FilterBar } from "../../components/ui/FilterBar";
import { useTableSearch } from "../../components/ui/useTableSearch";

const inputCls =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";

type SiteRow = ReturnType<typeof listSites<WarehouseMaster>>[number];

/** The warehouses a person can work at (BOUAKE, YAKRO FACTORY), grouped under their category, Unit or Central. Only
 * ready ones (a category and an ID code) — the API refuses anything else (services/users.ts). */
function WarehouseOptions({ warehouses }: { warehouses: SiteRow[] }) {
  return (
    <>
      {WAREHOUSE_TYPES.map((t) => {
        const inCategory = warehouses.filter((w) => w.type === t.value);
        return inCategory.length ? (
          <optgroup key={t.value} label={t.label}>
            {inCategory.map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
          </optgroup>
        ) : null;
      })}
    </>
  );
}

/** Admin only: create users, set their role, assign each to the one warehouse they work at, which is the section they
 * land in. */
export function UsersPage() {
  const { masters } = useTracking();
  const users = useUsers();
  const [form, setForm] = useState({ username: "", displayName: "", password: "", role: "warehouse_incharge" as Role, warehouse: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Ready warehouses only (a category and an ID code, contract's isUsableSite): those are what can be assigned.
  const ready = useMemo(() => listSites(masters.warehouses), [masters.warehouses]);
  const readyNames = useMemo(() => new Set(ready.map((w) => w.name)), [ready]);
  const needsWarehouse = form.role !== "admin";

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createUser({ ...form, warehouse: needsWarehouse ? form.warehouse : null });
      setForm({ ...form, username: "", displayName: "", password: "" });
      await users.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function patch(u: UserView, body: Parameters<typeof api.updateUser>[1]) {
    try {
      await api.updateUser(u.id, body);
      await users.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const search = useTableSearch(users.rows, (u) => [u.displayName, u.username, ROLE_LABEL[u.role], u.warehouse]);

  const columns: Column<UserView>[] = [
    { label: "Name", render: (u) => <div><div className="font-semibold">{u.displayName}</div><div className="text-[11px] text-warmstone-500">{u.username}</div></div> },
    { label: "Role", filter: { value: (u) => ROLE_LABEL[u.role], kind: "select" }, render: (u) => ROLE_LABEL[u.role] },
    {
      label: "Warehouse", filter: { value: (u) => u.warehouse ?? (u.role === "admin" ? "All" : "Not assigned"), kind: "select" },
      render: (u) => {
        if (u.role === "admin") return <span className="text-warmstone-500">All</span>;
        // On an old store row, or on nothing: say so, and let the admin pick the warehouse.
        const onWarehouse = u.warehouse !== null && readyNames.has(u.warehouse);
        return (
          <div className="flex flex-col gap-1">
            <select aria-label={`Warehouse for ${u.username}`} value={onWarehouse ? u.warehouse! : ""}
              onChange={(e) => e.target.value && void patch(u, { warehouse: e.target.value })}
              className="px-2.5 py-1 rounded-lg border border-warmstone-200 bg-warmstone-50 text-[12px] font-semibold text-warmstone-800 outline-none focus:border-brand-700">
              <option value="">{u.warehouse && !onWarehouse ? `${u.warehouse}: choose a warehouse…` : "Choose a warehouse…"}</option>
              <WarehouseOptions warehouses={ready} />
            </select>
            {onWarehouse
              ? <span className="text-[11px] text-warmstone-500">{u.warehouseType ? WAREHOUSE_TYPE_LABEL[u.warehouseType as WarehouseType] : "No category"}</span>
              : <Pill tone="decision" label={u.warehouse ? `${u.warehouse} isn't a warehouse: choose one` : "Not assigned to a warehouse"} />}
          </div>
        );
      },
    },
    { label: "Status", filter: { value: (u) => u.active ? "Active" : "Deactivated", kind: "select" }, render: (u) => <Pill tone={u.active ? "entry" : "gap"} label={u.active ? "Active" : "Deactivated"} /> },
    {
      label: "",
      render: (u) => (
        <div className="flex gap-3 justify-end">
          <button type="button" className="text-[12px] font-semibold text-brand-700 hover:text-brand-800"
            onClick={() => { const pw = window.prompt(`New password for ${u.username} (min 8 characters)`); if (pw) void patch(u, { password: pw }); }}>
            Reset password
          </button>
          <button type="button" className="text-[12px] font-semibold text-warmstone-600 hover:text-warmstone-900"
            onClick={() => void patch(u, { active: !u.active })}>
            {u.active ? "Deactivate" : "Reactivate"}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader kicker="Administration" title="Users" lede="Create accounts and assign each person a role and the one warehouse they work at. Warehouses are listed under their category, Unit or Central; a warehouse needs a category and an ID code (Masters › Warehouses) before anyone can be assigned to it." />
      <CollapsibleCard title="Add user" defaultOpen>
        <form onSubmit={handleCreate} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-3 items-end">
          <div><label className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5" htmlFor="u-username">Username</label>
            <input id="u-username" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className={inputCls} /></div>
          <div><label className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5" htmlFor="u-name">Display name</label>
            <input id="u-name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className={inputCls} /></div>
          <div><label className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5" htmlFor="u-pw">Password (min 8)</label>
            <input id="u-pw" type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputCls} /></div>
          <div><label className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5" htmlFor="u-role">Role</label>
            <select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} className={inputCls}>
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select></div>
          <Field label="Warehouse" hint={needsWarehouse && !ready.length ? "No warehouse is ready yet: add one in Masters › Warehouses, with its category and ID code." : undefined}>
            <Select required={needsWarehouse} disabled={!needsWarehouse} value={needsWarehouse ? form.warehouse : ""} onChange={(e) => setForm({ ...form, warehouse: e.target.value })}>
              <option value="">{needsWarehouse ? "Select a warehouse…" : "All (admin)"}</option>
              <WarehouseOptions warehouses={ready} />
            </Select>
          </Field>
          <button type="submit" disabled={busy}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white text-[13px] font-bold shadow-sm h-fit">
            <span className="material-symbols-outlined text-[17px]">person_add</span>Add user
          </button>
        </form>
      </CollapsibleCard>
      {error && <p role="alert" className="text-[13px] text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{error}</p>}
      <FilterBar>
        <input placeholder="Search name, username, role or warehouse…" value={search.q} onChange={(e) => search.setQ(e.target.value)} className="w-full sm:w-72" />
      </FilterBar>
      <DataTable columns={columns} rows={search.filtered} keyFn={(u) => u.id} emptyTitle={users.loading ? "Loading…" : "No users yet"} />
    </div>
  );
}
