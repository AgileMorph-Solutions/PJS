import { useEffect, useState, type FormEvent } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { Pill } from "../../components/ui/Pill";
import { useTracking } from "../../state/TrackingContext";
import { api } from "../../repository/api";
import type { Supplier } from "../../repository/mastersRepo";

const inputCls =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";
const linkCls = "text-[11.5px] font-semibold text-brand-700 hover:text-brand-800 whitespace-nowrap";

/**
 * Suppliers: add (the LBA code is suggested from the name and can be changed), edit and delete. A supplier
 * that trucks, plans or jute movements already use is switched off by Delete rather than removed, so history
 * stays whole; the server decides and says which it did. A switched-off one can be switched back on from Edit.
 */
export function SuppliersPage() {
  const { masters, refresh } = useTracking();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeEdited, setCodeEdited] = useState(false); // once the person types a code, the suggestion stops overwriting it
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Suggest the code as the name is typed, after a short pause so it isn't one request per letter.
  useEffect(() => {
    if (codeEdited || !name.trim()) { if (!name.trim() && !codeEdited) setCode(""); return; }
    const t = setTimeout(() => { api.suggestSupplierCode(name).then((r) => setCode(r.code)).catch(() => {}); }, 300);
    return () => clearTimeout(t);
  }, [name, codeEdited]);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setError(null); setNotice(null);
    try { await fn(); await refresh(); if (done) setNotice(done); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await run(async () => {
      await api.createSupplier({ name: name.trim(), code: code.trim() || undefined });
      setName(""); setCode(""); setCodeEdited(false);
    }, "Supplier added.");
  }

  async function remove(s: Supplier) {
    if (!window.confirm(`Delete ${s.name}? If trucks or plans already use it, it is switched off instead.`)) return;
    setError(null); setNotice(null);
    try {
      const r = await api.removeSupplier(s.code);
      await refresh();
      setNotice(r.deleted ? `${s.name} deleted.` : `${s.name} is used by ${r.references.total} record${r.references.total > 1 ? "s" : ""}, so it was switched off instead of deleted.`);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  const rows = masters.suppliers.filter((s) => showInactive || s.active !== false);
  const search = useTableSearch(rows, (s) => [s.code, s.name, s.formerName]);

  async function saveEdit(s: Supplier) {
    const patch: { name?: string; code?: string } = {};
    if (editName.trim() !== s.name) patch.name = editName.trim();
    if (editCode.trim() !== s.code) patch.code = editCode.trim();
    await run(async () => {
      if (Object.keys(patch).length) await api.updateSupplier(s.code, patch);
      setEditing(null);
    }, Object.keys(patch).length ? "Supplier updated." : undefined);
  }

  const columns: Column<Supplier>[] = [
    {
      label: "LBA Code", filter: { value: (s) => s.code, kind: "text" }, nowrap: true,
      render: (s) => editing === s.code
        ? <input aria-label="LBA code" value={editCode} onChange={(e) => setEditCode(e.target.value)} className={`${inputCls} font-mono`} />
        : <span className="font-mono text-[12.5px]">{s.code}</span>,
    },
    {
      label: "Supplier name", filter: { value: (s) => s.name, kind: "text" },
      render: (s) => editing === s.code
        ? <input aria-label="Supplier name" autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} className={inputCls} />
        : <span>{s.name}</span>,
    },
    { label: "Status", filter: { value: (s) => s.active === false ? "Switched off" : "Active", kind: "select" }, nowrap: true, render: (s) => (s.active === false ? <Pill tone="gap" label="Switched off" /> : <Pill tone="entry" label="Active" />) },
    {
      label: "", nowrap: true,
      render: (s) => editing === s.code ? (
        <span className="flex items-center gap-3 justify-end">
          {s.active === false && <button type="button" onClick={() => void run(async () => { await api.setSupplierActive(s.code, true); setEditing(null); }, "Supplier switched back on.")} className={linkCls}>Switch on</button>}
          <button type="button" disabled={!editName.trim() || !editCode.trim()} onClick={() => void saveEdit(s)} className={linkCls}>Save</button>
          <button type="button" onClick={() => setEditing(null)} className={linkCls}>Cancel</button>
        </span>
      ) : (
        <span className="flex items-center gap-3 justify-end">
          <button type="button" onClick={() => { setEditing(s.code); setEditName(s.name); setEditCode(s.code); setError(null); setNotice(null); }} className={linkCls}>Edit</button>
          <button type="button" onClick={() => void remove(s)} className={`${linkCls} text-danger-700`}>Delete</button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader kicker="Masters" title="Suppliers" lede={`${masters.suppliers.filter((s) => s.active !== false).length} active suppliers.`} />
      {error && <p role="alert" className="text-[13px] text-danger-700">{error}</p>}
      {notice && <p className="text-[13px] text-success-700">{notice}</p>}
      <CollapsibleCard title="Add supplier">
        <form onSubmit={(e) => void handleSubmit(e)} className="grid sm:grid-cols-[1fr_1fr_auto] gap-4 items-end">
          <div>
            <label htmlFor="supplier-name" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">Supplier name</label>
            <input id="supplier-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="SCOOP …" className={inputCls} />
          </div>
          <div>
            <label htmlFor="supplier-code" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">LBA Code <span className="font-normal text-warmstone-400">(suggested, you can change it)</span></label>
            <input id="supplier-code" value={code} onChange={(e) => { setCode(e.target.value); setCodeEdited(true); }} placeholder="LBA-0XX-ABC" className={inputCls} />
          </div>
          <button type="submit" disabled={!name.trim()} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white text-[13px] font-bold transition-all shadow-sm h-fit">
            <span className="material-symbols-outlined text-[17px]">add</span>
            Add supplier
          </button>
        </form>
      </CollapsibleCard>
      <FilterBar>
        <input placeholder="Search LBA code or name…" value={search.q} onChange={(e) => search.setQ(e.target.value)} className="w-full sm:w-64" />
        <label className="inline-flex items-center gap-2 text-[12.5px] text-warmstone-600">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show switched-off suppliers
        </label>
      </FilterBar>
      <DataTable columns={columns} rows={search.filtered} keyFn={(s) => s.code} emptyTitle="No suppliers yet" />
    </div>
  );
}
