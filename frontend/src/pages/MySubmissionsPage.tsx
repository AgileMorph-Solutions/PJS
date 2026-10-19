import { PageHeader } from "../components/ui/PageHeader";
import { DataTable, type Column } from "../components/ui/DataTable";
import { Pill } from "../components/ui/Pill";
import { useSubmissions } from "../state/userManagement";
import { useActiveSite } from "../state/SiteContext";
import { formById } from "../data/roles";
import type { SubmissionView } from "../types/user";
import { FilterBar } from "../components/ui/FilterBar";
import { useTableSearch } from "../components/ui/useTableSearch";

const TONE: Record<string, string> = { submitted: "decision", approved: "entry", rejected: "gap" };
const LABEL: Record<string, string> = { submitted: "Waiting", approved: "Approved", rejected: "Rejected" };

/** Branch Manager / QFS Officer: everything they've submitted and how the Warehouse Incharge ruled. */
export function MySubmissionsPage() {
  const site = useActiveSite();
  const subs = useSubmissions();
  const columns: Column<SubmissionView>[] = [
    { label: "Receipt", render: (s) => <span className="font-mono text-[12.5px]">{s.receiptId}</span> },
    { label: "Form", filter: { value: (s) => formById(s.formId)?.title ?? s.formId, kind: "select" }, render: (s) => formById(s.formId)?.title ?? s.formId },
    { label: "Submitted", filter: { value: (s) => s.submittedAt, kind: "date" }, render: (s) => new Date(s.submittedAt).toLocaleString() },
    { label: "Status", filter: { value: (s) => LABEL[s.status], kind: "select" }, render: (s) => <Pill tone={TONE[s.status]} label={LABEL[s.status]} /> },
    { label: "Reason", render: (s) => s.rejectReason ?? "" },
  ];
  const search = useTableSearch(subs.rows, (s) => [s.receiptId, formById(s.formId)?.title ?? s.formId, s.rejectReason]);

  return (
    <div className="space-y-5">
      <PageHeader kicker={`${site.label} · ${site.sublabel}`} title="My submissions" lede="A rejected submission is final - ask the Warehouse Incharge to correct the receipt." />
      <FilterBar>
        <input placeholder="Search receipt, form or reason…" value={search.q} onChange={(e) => search.setQ(e.target.value)} className="w-full sm:w-72" />
      </FilterBar>
      <DataTable columns={columns} rows={search.filtered} keyFn={(s) => s.id} rowHref={(s) => `/${site.slug}/receipts/${s.receiptId}`} emptyTitle={subs.loading ? "Loading…" : "Nothing submitted yet"} />
    </div>
  );
}
