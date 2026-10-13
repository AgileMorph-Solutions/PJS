import { useMemo, useState, type FormEvent } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { Pill } from "../../components/ui/Pill";
import { useTracking } from "../../state/TrackingContext";
import { useUsers } from "../../state/userManagement";
import { api } from "../../repository/api";
import { ROLES, ROLE_LABEL, type Role } from "../../data/roles";
import { WAREHOUSE_TYPE_LABEL, type WarehouseType } from "../../data/warehouseTypes";
import type { UserView } from "../../types/user";

const inputCls =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";

/** Admin only: create users, set their role, assign them to one warehouse. Only SITE warehouses
 * with a Unit/Central type are offered (the API refuses anything else), so a user always has a
 * section to land in. */
export function UsersPage() {
  const { masters } = useTracking();
  const users = useUsers();
  const [form, setForm] = useState({ username: "", displayName: "", password: "", role: "warehouse_incharge" as Role, warehouse: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const typedSites = useMemo(() => masters.warehouses.filter((w) => !w.site && w.type), [masters.warehouses]);
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

  const columns: Column<UserView>[] = [
    { label: "Name", filter: { value: (u) => `${u.displayName} ${u.username}`, kind: "text" }, render: (u) => <div><div className="font-semibold">{u.displayName}</div><div className="text-[11.5px] text-warmstone-500">{u.username}</div></div> },
    { label: "Role", filter: { value: (u) => ROLE_LABEL[u.role], kind: "select" }, render: (u) => ROLE_LABEL[u.role] },
    {
      label: "Warehouse", filter: { value: (u) => u.warehouse ?? "All", kind: "select" },
      render: (u) => u.warehouse
        ? <span>{u.warehouse} <span className="text-warmstone-400">· {u.warehouseType ? WAREHOUSE_TYPE_LABEL[u.warehouseType as WarehouseType] : "untyped"}</span></span>
        : <span className="text-warmstone-400">All</span>,
    },
    { label: "Status", filter: { value: (u) => u.active ? "Active" : "Deactivated", kind: "select" }, render: (u) => <Pill tone={u.active ? "entry" : "gap"} label={u.active ? "Active" : "Deactivated"} /> },
    {
      label: "",
      render: (u) => (
        <div className="flex gap-3 justify-end">
          <button type="button" className="text-[12.5px] font-semibold text-brand-700 hover:text-brand-800"
            onClick={() => { const pw = window.prompt(`New password for ${u.username} (min 8 characters)`); if (pw) void patch(u, { password: pw }); }}>
            Reset password
          </button>
          <button type="button" className="text-[12.5px] font-semibold text-warmstone-600 hover:text-warmstone-900"
            onClick={() => void patch(u, { active: !u.active })}>
            {u.active ? "Deactivate" : "Reactivate"}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader kicker="Administration" title="Users" lede="Create accounts and assign each person a role and one warehouse. Only warehouses with a Unit/Central type can be assigned (set it in Masters › Warehouses)." />
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
          <div><label className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5" htmlFor="u-wh">Warehouse</label>
            <select id="u-wh" required={needsWarehouse} disabled={!needsWarehouse} value={needsWarehouse ? form.warehouse : ""} onChange={(e) => setForm({ ...form, warehouse: e.target.value })} className={inputCls}>
              <option value="">{needsWarehouse ? "Select a warehouse…" : "All (admin)"}</option>
              {typedSites.map((w) => <option key={w.name} value={w.name}>{w.name} · {WAREHOUSE_TYPE_LABEL[w.type as WarehouseType]}</option>)}
            </select></div>
          <button type="submit" disabled={busy}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white text-[13px] font-bold shadow-sm h-fit">
            <span className="material-symbols-outlined text-[17px]">person_add</span>Add user
          </button>
        </form>
      </CollapsibleCard>
      {error && <p role="alert" className="text-[13px] text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{error}</p>}
      <DataTable columns={columns} rows={users.rows} keyFn={(u) => u.id} emptyTitle={users.loading ? "Loading…" : "No users yet"} />
    </div>
  );
}
