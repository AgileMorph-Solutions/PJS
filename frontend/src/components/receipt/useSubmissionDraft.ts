import { useCallback, useMemo, useState } from "react";
import type { ReceiptRecord } from "../../types/receipt";
import { formForRole, submitAgainBlocker, type Role } from "../../data/roles";
import { computeDerivedFields, derivedRuleFor } from "../../domain/receiptMath";
import { api } from "../../repository/api";
import { useSubmissions } from "../../state/userManagement";
import { isSupplierLinkedField } from "@anagroci/contract/domain/supplierCode";

/**
 * A Branch Manager's / QFS Officer's form, filled in on the same stage cards everyone else uses (team, 23 Nov 2026: "the form
 * should be the same for everyone"). Their fields are typed into a draft here, never saved field by field; the whole draft is
 * submitted for the Warehouse Incharge to approve. Shared by every stage card of the page, since one form spans several stages
 * (the QFS Officer's: Quality analysis and Unloading).
 *
 * A value already recorded on the truck stays locked (22 Nov 2026): only the Incharge or an Admin changes it, and the server
 * refuses the same (contract changesToRecorded). A calculated field (KOR) follows what is typed and is never sent itself.
 */
export function useSubmissionDraft(receipt: ReceiptRecord | undefined, role: Role, enabled: boolean) {
  const form = enabled ? formForRole(role) : undefined;
  const { rows, refetch } = useSubmissions({ receiptId: receipt?.id ?? "" }, { enabled: Boolean(form && receipt) });
  // Every time this form was sent for this truck, newest first. After an approval it may be sent again for what is still
  // empty (contract submitAgainBlocker); one waiting for approval, or a rejection, holds it — `existing` is that one.
  const sentBefore = useMemo(
    () => (form ? rows.filter((s) => s.formId === form.id).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)) : []),
    [rows, form],
  );
  const latest = sentBefore[0];
  const blocker = submitAgainBlocker(sentBefore);
  const existing = blocker ? sentBefore.find((s) => s.status !== "approved") : undefined;
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stageData = useMemo(() => receipt?.stageData ?? {}, [receipt?.stageData]);
  /** The truck as it stands with this person's values on it: what they typed, or once submitted, what they sent. */
  const values = useMemo(() => {
    const merged: Record<string, Record<string, string>> = {};
    for (const [stageId, fields] of Object.entries(stageData)) merged[stageId] = { ...fields };
    for (const [stageId, fields] of Object.entries(existing ? existing.values : draft)) merged[stageId] = { ...merged[stageId], ...fields };
    return merged;
  }, [stageData, draft, existing]);
  const derived = useMemo(() => computeDerivedFields(values), [values]);

  const labelsOn = (stageId: string) => form?.stages.find((s) => s.stageId === stageId)?.labels ?? [];
  const recorded = (stageId: string, label: string) => (stageData[stageId]?.[label] ?? "").trim() !== "";
  const calculated = (stageId: string, label: string) => {
    // The LBA code follows the supplier (the server sets it on approval), like a calculation: nobody types it.
    if (isSupplierLinkedField(stageId, label)) return true;
    const rule = derivedRuleFor(stageId, label);
    return Boolean(rule && (!rule.fallbackToTyped || rule.calculatedOnlyInApp || derived[stageId]?.[label] !== undefined));
  };
  /** The fields of this stage this person may still type: on their form, not recorded, not calculated, not yet submitted. */
  const editableIn = (stageId: string) => (existing ? [] : labelsOn(stageId).filter((l) => !recorded(stageId, l) && !calculated(stageId, l)));
  const open = (form?.stages ?? []).flatMap((s) => editableIn(s.stageId).map((label) => ({ stageId: s.stageId, label })));
  const typed = open.filter((o) => (draft[o.stageId]?.[o.label] ?? "").trim() !== "");

  const setField = useCallback((stageId: string, label: string, value: string) => {
    setError(null);
    setDraft((d) => ({ ...d, [stageId]: { ...d[stageId], [label]: value } }));
  }, []);

  async function submit(afterSubmit: () => Promise<void>) {
    if (!receipt) return;
    setBusy(true);
    setError(null);
    try {
      const out: Record<string, Record<string, string>> = {};
      for (const o of typed) (out[o.stageId] ??= {})[o.label] = draft[o.stageId]![o.label]!.trim();
      await api.submitForm(receipt.id, out);
      setDraft({});
      await refetch();
      await afterSubmit();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return {
    form, existing, latest, blocker, values, derived, busy, error, open, typed, setField, submit,
    /** A field of their form already recorded on the truck (not a calculation): theirs no more, the Incharge's or an Admin's. */
    lockedForMe: (stageId: string, label: string) => labelsOn(stageId).includes(label) && recorded(stageId, label) && !calculated(stageId, label),
    /** Whether this stage is part of this person's form. */
    covers: (stageId: string) => labelsOn(stageId).length > 0,
    editableIn,
    /** How a field this person sent stands: the newest submission that carried it (waiting, approved or rejected). */
    sentStatus: (stageId: string, label: string) => sentBefore.find((s) => s.values[stageId]?.[label] !== undefined)?.status,
  };
}

export type SubmissionDraft = ReturnType<typeof useSubmissionDraft>;
