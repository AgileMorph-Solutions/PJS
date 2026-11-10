import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Modal } from "../ui/Modal";
import { FilterBar } from "../ui/FilterBar";
import { Pagination } from "../ui/Pagination";
import { usePagination } from "../ui/usePagination";
import { useTableSearch } from "../ui/useTableSearch";
import { RCN_RECEIPT_STATUS_LABELS, type RcnReceiptStatus } from "@anagroci/contract/domain/rcnReceipt";
import { RcnReceiptForm } from "./RcnReceiptForm";
import { LoadCard, loadDone, type LoadPermissions } from "./LoadCard";
import type { BatchDetail } from "@anagroci/contract/types/productionBatch";
import type { RcnReceipt } from "@anagroci/contract/types/rcnReceipt";

export type StepPermissions = LoadPermissions;

/**
 * Intake, part of the run's own page: one card per load (RCN receipt) brought from a warehouse bin. A load is opened in
 * place — never on a page of its own — and shows all its forms at once. Loads with something left to do start open;
 * finished ones start folded, so the page shows what needs work. `?load=<id>` opens one from a link.
 */
export function IntakeStage({ run, receipts, can, onChanged }: { run: BatchDetail; receipts: RcnReceipt[]; can: StepPermissions; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [params] = useSearchParams();
  const linked = params.get("load");
  // What the person opened or closed by hand; anything else follows the rule above.
  const [toggled, setToggled] = useState<Record<string, boolean>>(() => (linked ? { [linked]: true } : {}));
  const isOpen = (r: RcnReceipt) => toggled[r.id] ?? !loadDone(r);
  const toggle = (r: RcnReceipt) => setToggled((t) => ({ ...t, [r.id]: !isOpen(r) }));

  // A link to one load scrolls to it once the loads are on the page.
  const loaded = receipts.length > 0;
  useEffect(() => {
    if (linked && loaded) document.getElementById(`load-${linked}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [linked, loaded]);

  const left = receipts.filter((r) => !loadDone(r)).length;

  // Search, a status filter and pages, as every list in the app has (useTableSearch, usePagination).
  const search = useTableSearch(receipts, (r) => [r.id, r.btmNo, r.binCode]);
  const [status, setStatus] = useState<"" | "unfinished" | RcnReceiptStatus>("");
  const statuses = [...new Set(receipts.map((r) => r.status))];
  const shown = search.filtered.filter((r) => !status || (status === "unfinished" ? !loadDone(r) : r.status === status));
  const page = usePagination(shown, 10);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-[15px] font-bold text-warmstone-900">RCN receipts ({receipts.length})</h3>
          <p className="text-[12px] text-warmstone-500 mt-0.5">
            One for each load brought from a warehouse bin, with its BTM slip. Fill in any step of any load, in any order.
            {receipts.length > 0 && ` ${left ? `${left} still to finish.` : "All loads are finished."}`}
          </p>
        </div>
        {can.canReceive && <Button icon="add" onClick={() => setAdding(true)}>Record a load</Button>}
      </div>

      {receipts.length === 0 ? (
        <EmptyState title="No load recorded yet" hint={can.canReceive ? "Click Record a load when the first load comes in from a bin." : "The first load has not come in yet."} />
      ) : (
        <>
          <FilterBar>
            <input placeholder="Search RCN receipt, BTM or bin…" value={search.q} onChange={(e) => search.setQ(e.target.value)} className="w-full sm:w-72" />
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status">
              <option value="">All loads</option>
              <option value="unfinished">Not finished</option>
              {statuses.map((st) => <option key={st} value={st}>{RCN_RECEIPT_STATUS_LABELS[st]}</option>)}
            </select>
            <span className="text-[12px] text-warmstone-500">{shown.length} of {receipts.length}</span>
          </FilterBar>
          {shown.length === 0 && <EmptyState title="No load matches" hint="Clear the search or the status filter." />}
          {page.pageRows.map((r) => <LoadCard key={r.id} receipt={r} open={isOpen(r)} onToggle={() => toggle(r)} can={can} onChanged={onChanged} />)}
          <div className="bg-white border border-warmstone-200 rounded-2xl overflow-hidden empty:hidden">
            <Pagination state={page} />
          </div>
        </>
      )}

      {adding && (
        <Modal wide title="Record a load" onClose={() => setAdding(false)}>
          <RcnReceiptForm run={run} existing={receipts} onSaved={() => { setAdding(false); onChanged(); }} />
        </Modal>
      )}
    </div>
  );
}
