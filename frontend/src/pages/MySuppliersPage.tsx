import { useState, type FormEvent } from "react";
import { PageHeader } from "../components/ui/PageHeader";
import { DataTable, type Column } from "../components/ui/DataTable";
import { CollapsibleCard } from "../components/ui/CollapsibleCard";
import { Pill } from "../components/ui/Pill";
import { useMySuppliers, useSupplierRequests } from "../state/userManagement";
import { api } from "../repository/api";
import type { Supplier } from "../types/receipt";
import type { SupplierRequestView } from "../types/user";

const inputCls =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";

const TONE: Record<string, string> = { pending: "decision", approved: "entry", rejected: "gap" };

/** Branch Manager: the suppliers assigned to them, plus asking the Warehouse Incharge to add one. */
export function MySuppliersPage() {
  const mine = useMySuppliers();
  const requests = useSupplierRequests();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleRequest(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.requestSupplier(name.trim(), code.trim() || undefined);
      setName(""); setCode("");
      await requests.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const supplierCols: Column<Supplier>[] = [
    { label: "LBA Code", filter: { value: (s) => s.code, kind: "text" }, render: (s) => <span className="font-mono text-[12.5px]">{s.code}</span> },
    { label: "Supplier name", filter: { value: (s) => s.name, kind: "text" }, render: (s) => s.name },
  ];
  const requestCols: Column<SupplierRequestView>[] = [
    { label: "Supplier", filter: { value: (r) => r.name, kind: "text" }, render: (r) => r.name },
    { label: "LBA Code", filter: { value: (r) => r.code, kind: "text" }, render: (r) => r.code ?? "-" },
    { label: "Status", filter: { value: (r) => r.status, kind: "select" }, render: (r) => <Pill tone={TONE[r.status]} label={r.status} /> },
    { label: "Note", filter: { value: (r) => r.reason, kind: "text" }, render: (r) => r.reason ?? "" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader kicker="Branch Manager" title="My suppliers" lede="You can report on receipts for these suppliers only." />
      <DataTable columns={supplierCols} rows={mine.rows} keyFn={(s) => s.code} emptyTitle={mine.loading ? "Loading…" : "No suppliers assigned yet"} emptyHint="Ask the Warehouse Incharge to assign suppliers to you, or request a new one below." />
      <CollapsibleCard title="Request a new supplier">
        <form onSubmit={handleRequest} className="grid sm:grid-cols-[1fr_1fr_auto] gap-4 items-end pt-3">
          <div><label htmlFor="rq-name" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">Supplier name</label>
            <input id="rq-name" required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></div>
          <div><label htmlFor="rq-code" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">LBA code (if known)</label>
            <input id="rq-code" value={code} onChange={(e) => setCode(e.target.value)} className={inputCls} /></div>
          <button type="submit" className="px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold shadow-sm h-fit">Send request</button>
        </form>
        {error && <p role="alert" className="mt-3 text-[13px] text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{error}</p>}
      </CollapsibleCard>
      <h2 className="text-[11px] font-bold text-warmstone-400 uppercase tracking-wider px-1">Your requests</h2>
      <DataTable columns={requestCols} rows={requests.rows} keyFn={(r) => r.id} emptyTitle="No requests yet" />
    </div>
  );
}
