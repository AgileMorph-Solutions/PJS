import { useMemo, useState } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { EmptyState } from "../../components/ui/EmptyState";
import { useTracking } from "../../state/TrackingContext";
import { useBranchManagers } from "../../state/userManagement";
import { api } from "../../repository/api";
import type { BranchManagerView } from "../../types/user";

/** Warehouse Incharge assigns which suppliers each Branch Manager may report for. Edited as a
 * checklist and saved as the BM's whole set. */
export function SupplierAssignmentPage() {
  const bms = useBranchManagers();
  return (
    <div className="space-y-5">
      <PageHeader kicker="Masters" title="Supplier assignment" lede="A Branch Manager can only see receipts and submit forms for the suppliers assigned to them here." />
      {bms.rows.length === 0 && <EmptyState title={bms.loading ? "Loading…" : "No Branch Managers yet"} hint="An admin creates Branch Manager accounts under Users." />}
      {bms.rows.map((bm) => <BranchManagerCard key={bm.id} bm={bm} onSaved={() => void bms.refetch()} />)}
    </div>
  );
}

function BranchManagerCard({ bm, onSaved }: { bm: BranchManagerView; onSaved: () => void }) {
  const { masters } = useTracking();
  const [selected, setSelected] = useState(() => new Set(bm.supplierCodes));
  const [q, setQ] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return masters.suppliers.filter((s) => !needle || s.code.toLowerCase().includes(needle) || s.name.toLowerCase().includes(needle));
  }, [masters.suppliers, q]);

  const dirty = selected.size !== bm.supplierCodes.length || bm.supplierCodes.some((c) => !selected.has(c));

  async function save() {
    setState("saving");
    setError(null);
    try {
      await api.setBranchManagerSuppliers(bm.id, [...selected]);
      setState("saved");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("idle");
    }
  }

  return (
    <div className="bg-white border border-warmstone-200 rounded-2xl shadow-xs p-5 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="font-semibold text-warmstone-900 text-[14px]">{bm.displayName}</span>
        <span className="text-[12px] text-warmstone-500">{bm.username} · {bm.warehouse} · {selected.size} assigned</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter suppliers…" aria-label={`Filter suppliers for ${bm.displayName}`}
          className="ml-auto px-3 py-1.5 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] outline-none focus:border-brand-700 w-48" />
      </div>
      <div className="max-h-56 overflow-y-auto grid sm:grid-cols-2 gap-x-6 gap-y-1 border border-warmstone-100 rounded-xl p-3">
        {shown.map((s) => (
          <label key={s.code} className="flex items-center gap-2 text-[12.5px] text-warmstone-800 cursor-pointer">
            <input type="checkbox" checked={selected.has(s.code)}
              onChange={() => { setState("idle"); setSelected((prev) => { const n = new Set(prev); if (n.has(s.code)) n.delete(s.code); else n.add(s.code); return n; }); }} />
            <span className="font-mono text-[11.5px] text-warmstone-500">{s.code}</span>
            <span className="truncate">{s.name}</span>
          </label>
        ))}
      </div>
      {error && <p role="alert" className="text-[12.5px] text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{error}</p>}
      <button type="button" disabled={!dirty || state === "saving"} onClick={save}
        className="px-4 py-1.5 rounded-xl bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white text-[12.5px] font-bold">
        {state === "saving" ? "Saving…" : state === "saved" && !dirty ? "Saved" : "Save assignments"}
      </button>
    </div>
  );
}
