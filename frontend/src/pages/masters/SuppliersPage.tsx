import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SUPPLIER_STATUS_LABELS, type SupplierStatus } from "@anagroci/contract/domain/supplierProfile";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { Pill } from "../../components/ui/Pill";
import { useTracking } from "../../state/TrackingContext";
import { api } from "../../repository/api";
import type { Supplier } from "../../repository/mastersRepo";

const linkCls = "text-[11.5px] font-semibold text-brand-700 hover:text-brand-800 whitespace-nowrap";
const STATUS_TONE: Record<SupplierStatus, string> = { active: "entry", suspended: "decision", inactive: "gap" };
const statusOf = (s: Supplier): SupplierStatus => s.status ?? (s.active === false ? "inactive" : "active");

/**
 * The supplier register. A row opens the supplier's page (all its LBA register details and the figures worked out
 * from its trucks); Edit opens it ready to change; Delete removes one nothing uses, otherwise makes it inactive, so
 * history stays whole (the server decides and says which it did).
 */
export function SuppliersPage() {
  const navigate = useNavigate();
  const { masters, refresh } = useTracking();
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function remove(s: Supplier) {
    if (!window.confirm(`Delete ${s.name}? If trucks or plans already use it, it is made inactive instead.`)) return;
    setError(null); setNotice(null);
    try {
      const r = await api.removeSupplier(s.code);
      await refresh();
      setNotice(r.deleted ? `${s.name} deleted.` : `${s.name} is used by ${r.references.total} record${r.references.total > 1 ? "s" : ""}, so it was made inactive instead of deleted.`);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  const rows = masters.suppliers.filter((s) => showInactive || statusOf(s) !== "inactive");
  const search = useTableSearch(rows, (s) => [s.code, s.supplierNo, s.name, s.formerName]);
  const page = (s: Supplier) => `/masters/suppliers/${encodeURIComponent(s.code)}`;

  const columns: Column<Supplier>[] = [
    { label: "Supplier ID", nowrap: true, render: (s) => <span className="font-mono text-[12.5px] text-warmstone-500">{s.supplierNo ?? "-"}</span> },
    { label: "LBA Code", nowrap: true, render: (s) => <span className="font-mono text-[12.5px] font-semibold text-brand-700">{s.code}</span> },
    { label: "Supplier name", render: (s) => s.name },
    { label: "Status", nowrap: true, filter: { value: (s) => SUPPLIER_STATUS_LABELS[statusOf(s)], kind: "select" }, render: (s) => <Pill tone={STATUS_TONE[statusOf(s)]} label={SUPPLIER_STATUS_LABELS[statusOf(s)]} /> },
    {
      label: "", nowrap: true,
      render: (s) => (
        <span className="flex items-center gap-3 justify-end">
          <button type="button" onClick={() => navigate(`${page(s)}?edit=1`)} className={linkCls}>Edit</button>
          <button type="button" onClick={() => void remove(s)} className={`${linkCls} text-danger-700`}>Delete</button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Masters"
        title="Suppliers"
        lede={`${masters.suppliers.filter((s) => statusOf(s) !== "inactive").length} suppliers. Open one to see its LBA register details and performance.`}
        actions={(
          <Link to="/masters/suppliers/new" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold shadow-sm">
            <span className="material-symbols-outlined text-[17px]">add</span>Add supplier
          </Link>
        )}
      />
      {error && <p role="alert" className="text-[13px] text-danger-700">{error}</p>}
      {notice && <p className="text-[13px] text-success-700">{notice}</p>}
      <FilterBar>
        <input placeholder="Search ID, LBA code or name…" value={search.q} onChange={(e) => search.setQ(e.target.value)} className="w-full sm:w-64" />
        <label className="inline-flex items-center gap-2 text-[12.5px] text-warmstone-600">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive suppliers
        </label>
      </FilterBar>
      <DataTable columns={columns} rows={search.filtered} keyFn={(s) => s.code} rowHref={page} emptyTitle="No suppliers yet" />
    </div>
  );
}
