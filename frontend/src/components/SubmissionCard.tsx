import { useMemo, useState } from "react";
import type { ReceiptRecord } from "../types/receipt";
import { formForRole, type Role } from "../data/roles";
import { stages } from "../data/stages";
import { api } from "../repository/api";
import { FieldInput } from "./FieldInput";
import { useSubmissions } from "../state/userManagement";
import { useTracking } from "../state/TrackingContext";

const STATUS_STYLE: Record<string, string> = {
  submitted: "bg-ambernut-100 text-ambernut-800 border-ambernut-200",
  approved: "bg-success-100 text-success-800 border-success-200",
  rejected: "bg-danger-100 text-danger-700 border-danger-200",
};
const STATUS_LABEL: Record<string, string> = {
  submitted: "Waiting for approval", approved: "Approved", rejected: "Rejected",
};

/**
 * The Branch Manager / QFS Officer's "Your form" card: the fields of their role's form (from
 * contract's ROLE_FORMS), pre-filled from the receipt, submitted for the Warehouse Incharge to
 * approve. Once submitted the card is read-only and shows the outcome — a rejection is final, so
 * there is deliberately no resubmit button (the Warehouse Incharge corrects the data directly).
 */
export function SubmissionCard({ receipt, role }: { receipt: ReceiptRecord; role: Role }) {
  const form = formForRole(role);
  const { refresh } = useTracking();
  const { rows, refetch } = useSubmissions({ receiptId: receipt.id });
  const existing = rows.find((s) => s.formId === form?.id);

  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = useMemo(
    () => (form?.stages ?? []).flatMap(({ stageId, labels }) => {
      const stage = stages.find((s) => s.id === stageId);
      return labels.flatMap((label) => {
        const field = stage?.fields.find((f) => f.n === label);
        return field ? [{ stageId, field }] : [];
      });
    }),
    [form]
  );

  if (!form) return null;

  const valueOf = (stageId: string, label: string) =>
    existing ? existing.values[stageId]?.[label] ?? "" : draft[stageId]?.[label] ?? receipt.stageData[stageId]?.[label] ?? "";

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const values: Record<string, Record<string, string>> = {};
      for (const { stageId, field } of fields) {
        const v = valueOf(stageId, field.n).trim();
        if (v) (values[stageId] ??= {})[field.n] = v;
      }
      await api.submitForm(receipt.id, values);
      await refetch();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border-2 border-brand-700 shadow-md shadow-brand-700/10 overflow-hidden">
      <div className="px-5 py-4 bg-gradient-to-r from-brand-50 via-white to-white flex items-center gap-3 flex-wrap">
        <span className="material-symbols-outlined text-[20px] text-brand-700">edit_note</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-bold text-warmstone-900">{form.title}</h2>
          <p className="text-xs text-warmstone-500">Reviewed by the Warehouse Incharge before it's applied to this receipt.</p>
        </div>
        {existing && (
          <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${STATUS_STYLE[existing.status]}`}>
            {STATUS_LABEL[existing.status]}
          </span>
        )}
      </div>
      <div className="px-5 pb-5 pt-4 border-t border-warmstone-100 bg-warmstone-50/60 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          {fields.map(({ stageId, field }) => (
            <FieldInput
              key={`${stageId}/${field.n}`}
              field={field}
              value={valueOf(stageId, field.n)}
              onChange={(v) => setDraft((d) => ({ ...d, [stageId]: { ...d[stageId], [field.n]: v } }))}
              idPrefix={`form-${stageId}`}
              readOnly={Boolean(existing)}
            />
          ))}
        </div>
        {existing?.status === "rejected" && (
          <p role="status" className="text-[13px] text-danger-700 bg-danger-100 rounded-lg px-3 py-2">
            Rejected{existing.reviewedBy ? ` by ${existing.reviewedBy}` : ""}: {existing.rejectReason}. This can't be
            resubmitted — ask the Warehouse Incharge to correct the receipt.
          </p>
        )}
        {error && <p role="alert" className="text-[13px] text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{error}</p>}
        {!existing && (
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white text-[13px] font-bold transition-all shadow-sm"
          >
            <span className="material-symbols-outlined text-[17px]">send</span>
            {busy ? "Submitting…" : "Submit for approval"}
          </button>
        )}
      </div>
    </div>
  );
}

export type { ReceiptRecord };
