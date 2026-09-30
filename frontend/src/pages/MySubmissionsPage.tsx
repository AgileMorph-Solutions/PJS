import { PageHeader } from "../components/ui/PageHeader";
import { DataTable, type Column } from "../components/ui/DataTable";
import { Pill } from "../components/ui/Pill";
import { useSubmissions } from "../state/userManagement";
import { useActiveSite } from "../state/SiteContext";
import { formById } from "../data/roles";
import type { SubmissionView } from "../types/user";

const TONE: Record<string, string> = { submitted: "decision", approved: "entry", rejected: "gap" };
const LABEL: Record<string, string> = { submitted: "Waiting", approved: "Approved", rejected: "Rejected" };

/** Branch Manager / QFS Officer: everything they've submitted and how the Warehouse Incharge ruled. */
export function MySubmissionsPage() {
  const site = useActiveSite();
  const subs = useSubmissions();
  const columns: Column<SubmissionView>[] = [
    { label: "Receipt", render: (s) => <span className="font-mono text-[12.5px]">{s.receiptId}</span> },
    { label: "Form", render: (s) => formById(s.formId)?.title ?? s.formId },
    { label: "Submitted", render: (s) => new Date(s.submittedAt).toLocaleString() },
    { label: "Status", render: (s) => <Pill tone={TONE[s.status]} label={LABEL[s.status]} /> },
    { label: "Reason", render: (s) => s.rejectReason ?? "" },
  ];
  return (
    <div className="space-y-5">
      <PageHeader kicker={`${site.label} · ${site.sublabel}`} title="My submissions" lede="A rejected submission is final — ask the Warehouse Incharge to correct the receipt." />
      <DataTable columns={columns} rows={subs.rows} keyFn={(s) => s.id} rowHref={(s) => `/${site.slug}/receipts/${s.receiptId}`} emptyTitle={subs.loading ? "Loading…" : "Nothing submitted yet"} />
    </div>
  );
}
