import { useState, type FormEvent } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { useTracking } from "../../state/TrackingContext";
import type { Supplier } from "../../repository/mastersRepo";

const inputCls =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";

export function SuppliersPage() {
  const { masters, addSupplier } = useTracking();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;
    addSupplier({ code: code.trim(), name: name.trim() });
    setCode("");
    setName("");
  }

  const columns: Column<Supplier>[] = [
    { label: "LBA Code", render: (s) => <span className="font-mono text-[12.5px]">{s.code}</span> },
    { label: "Supplier name", render: (s) => s.name },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Masters"
        title="Suppliers"
        lede={`${masters.suppliers.length} suppliers.`}
      />
      <div className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs">
        <form onSubmit={handleSubmit} className="grid sm:grid-cols-[1fr_1fr_auto] gap-4 items-end">
          <div>
            <label htmlFor="supplier-code" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">
              LBA Code
            </label>
            <input id="supplier-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="LBA-0XX-ABC" className={inputCls} />
          </div>
          <div>
            <label htmlFor="supplier-name" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">
              Supplier name
            </label>
            <input id="supplier-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="RCN SCOOP …" className={inputCls} />
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold transition-all shadow-sm h-fit"
          >
            <span className="material-symbols-outlined text-[17px]">add</span>
            Add supplier
          </button>
        </form>
      </div>
      <DataTable columns={columns} rows={masters.suppliers} keyFn={(s) => s.code} emptyTitle="No suppliers yet" />
    </div>
  );
}
