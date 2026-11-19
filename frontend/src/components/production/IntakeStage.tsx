import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import { FilterBar } from "../ui/FilterBar";
import { Modal } from "../ui/Modal";
import { useTableSearch } from "../ui/useTableSearch";
import { PRODUCTION_PAGE_SIZE, dateCol, kgCol, numCol, statusCol, textCol } from "./columns";
import { RcnReceiptStatusPill } from "./batchUi";
import { RcnReceiptForm } from "./RcnReceiptForm";
import { api, ApiError } from "../../repository/api";
import { LOAD_STEPS, loadDone, stepsDone, type LoadPermissions } from "./loadSteps";
import { RCN_RECEIPT_STATUS_LABELS, type RcnReceiptStatus } from "@anagroci/contract/domain/rcnReceipt";
import { weighingTotals } from "@anagroci/contract/domain/rcnWeighing";
import type { BatchDetail } from "@anagroci/contract/types/productionBatch";
import type { RcnReceipt } from "@anagroci/contract/types/rcnReceipt";

export type StepPermissions = LoadPermissions;

/** Where a load's own page is. */
export const loadHref = (r: RcnReceipt) => `/production/runs/${encodeURIComponent(r.batchCode)}/loads/${encodeURIComponent(r.id)}`;

/** The latest approved moisture check, as "8.3 % · OK"; a check still waiting says so. */
function moistureWord(r: RcnReceipt): string | null {
  if (r.moistureChecks.some((c) => c.status === "submitted")) return "Waiting for approval";
  const c = r.moistureChecks.filter((x) => x.status === "approved").at(-1);
  return c ? `${c.moisture} % · ${c.decision === "ok" ? "OK" : "Hold"}` : null;
}

/**
 * One row per load, as the client's "1. RCN Receipts" register reads (date, BTM, source bin, factory bin, gross, net),
 * plus where the load stands. The kg are worked out from its pallets with the server's own function; a net only once
 * the final weight is saved, since before it there is no tare yet.
 */
function loadColumns(): Column<RcnReceipt>[] {
  const totals = (r: RcnReceipt) => weighingTotals(r.pallets, r.finalWeight ?? { emptyPallets: [] });
  return [
    textCol("RCN receipt", (r) => r.id, { mono: true, strong: true }),
    dateCol("Date", (r) => r.date),
    textCol("Crop year", (r) => r.cropYear),
    textCol("BTM No", (r) => r.btmNo),
    textCol("Source bin", (r) => r.binCode, { mono: true }),
    textCol("Factory bin", (r) => [...new Set(r.pallets.map((p) => p.factoryBin))].join(", "), { mono: true }),
    numCol("Pallets", (r) => r.pallets.length),
    numCol("Bags", (r) => totals(r).bags),
    kgCol("Gross", (r) => (r.pallets.length ? totals(r).grossKg : null)),
    kgCol("Net", (r) => (r.finalWeight ? totals(r).netKg : null)),
    kgCol("To silos", (r) => (r.finalWeight ? totals(r).toSilosKg : null), { strong: true }),
    textCol("Moisture", moistureWord),
    { ...numCol("Steps", stepsDone), render: (r) => `${stepsDone(r)} of ${LOAD_STEPS.length}` },
    statusCol("Status", (r) => RCN_RECEIPT_STATUS_LABELS[r.status], (r) => <RcnReceiptStatusPill status={r.status} />),
  ];
}

/**
 * Intake, part of the run's own page: a table of the run's loads (RCN receipts), like Reception's list of trucks. A row
 * opens the load on its own page, where its steps are worked on one at a time.
 */
export function IntakeStage({ run, receipts, can, onChanged }: { run: BatchDetail; receipts: RcnReceipt[]; can: StepPermissions; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  const left = receipts.filter((r) => !loadDone(r)).length;
  // A month's run is dozens of loads: the Production Incharge accepts the ones the warehouse finished together.
  const ready = receipts.filter((r) => r.status === "waiting_for_acceptance");
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  async function acceptReady() {
    setAccepting(true);
    setAcceptError(null);
    try {
      for (const r of ready) await api.acceptRcnReceipt(r.id);
    } catch (err) {
      setAcceptError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setAccepting(false);
      onChanged();
    }
  }

  // Search and a status filter above the table, as every list in the app has; the columns filter and page on their own.
  const search = useTableSearch(receipts, (r) => [r.id, r.btmNo, r.binCode, ...r.pallets.map((p) => p.factoryBin)]);
  const [status, setStatus] = useState<"" | "unfinished" | RcnReceiptStatus>("");
  const statuses = [...new Set(receipts.map((r) => r.status))];
  const shown = search.filtered
    .filter((r) => !status || (status === "unfinished" ? !loadDone(r) : r.status === status))
    .sort((a, b) => (a.date === b.date ? b.id.localeCompare(a.id) : b.date.localeCompare(a.date)));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-[15px] font-bold text-warmstone-900">RCN receipts ({receipts.length})</h3>
          <p className="text-[12px] text-warmstone-500 mt-0.5">
            One for each load brought from a warehouse bin, with its BTM slip. Open a load to work on its steps.
            {receipts.length > 0 && ` ${left ? `${left} still to finish.` : "All loads are finished."}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {can.canAccept && ready.length > 0 && (
            <Button icon="task_alt" variant={can.canReceive ? "secondary" : "primary"} disabled={accepting} onClick={() => void acceptReady()}>
              {accepting ? "Accepting…" : `Accept ${ready.length} weighed load${ready.length === 1 ? "" : "s"}`}
            </Button>
          )}
          {can.canReceive && <Button icon="add" onClick={() => setAdding(true)}>Record a load</Button>}
        </div>
      </div>
      {acceptError && <p role="alert" className="text-[12px] text-danger-700">{acceptError}</p>}

      {receipts.length === 0 ? (
        <EmptyState title="No load recorded yet" hint={can.canReceive ? "Click Record a load when the first load comes in from a bin, or upload the tally sheet." : "The warehouse records each load it sends; it shows here to be accepted."} />
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
          <DataTable
            columns={loadColumns()}
            rows={shown}
            keyFn={(r) => r.id}
            rowHref={loadHref}
            pageSize={PRODUCTION_PAGE_SIZE}
            emptyTitle="No load matches"
            emptyHint="Clear the search or the status filter."
          />
        </>
      )}

      {adding && (
        <Modal wide title="Record a load" onClose={() => setAdding(false)}>
          {/* A new load opens on its own page, as a new truck does in Reception: its next step is there. */}
          <RcnReceiptForm run={run} existing={receipts} onSaved={(saved) => { setAdding(false); onChanged(); navigate(loadHref(saved)); }} />
        </Modal>
      )}
    </div>
  );
}
