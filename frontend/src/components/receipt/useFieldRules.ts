import { useMemo } from "react";
import type { ReceiptRecord } from "@anagroci/contract/types/receipt";
import { issuesByLabel, recordIssues, type FieldIssue } from "@anagroci/contract/domain/fieldRules";
import { passBlocked, stageGate, type GateFacts, type StageGate } from "@anagroci/contract/domain/phaseGate";

const today = () => new Date().toISOString().slice(0, 10);
const OPEN: StageGate = { open: true, missing: [] };

/**
 * The field rules and the phase order on a truck's page (contract domain/fieldRules.ts, domain/phaseGate.ts). Every value
 * is saved as it is typed; the field rules only add a warning under it (Nov 2026: "all values can be saved, just warn").
 *
 * Records imported from the 2026 workbooks aren't gated (the server doesn't gate them either): they never had most fields.
 */
export function useFieldRules(receipt: ReceiptRecord | undefined, save: (stageId: string, label: string, value: string) => void, facts: GateFacts = {}) {
  const ctx = useMemo(
    // An imported truck's createdAt is the import day, not the day anyone typed it in: leaving it out keeps "a past date"
    // from firing on every record of the 2026 workbooks.
    () => ({ arrivalDate: receipt?.arrivalDate, today: today(), enteredOn: receipt?.source === "entered" ? receipt.createdAt?.slice(0, 10) : undefined }),
    [receipt?.arrivalDate, receipt?.createdAt, receipt?.source],
  );
  const issues = useMemo<FieldIssue[]>(() => (receipt ? recordIssues(receipt.stageData, ctx) : []), [receipt, ctx]);
  const gated = Boolean(receipt) && receipt!.source !== "imported";

  return {
    valuesOf: (stageId: string) => receipt?.stageData[stageId] ?? {},
    issuesOf: (stageId: string) => issuesByLabel(issues, stageId),
    change: save,
    /** Whether a stage is open yet, and the sentence to show when it isn't. */
    gateOf: (stageId: string): StageGate => (gated && receipt ? stageGate(receipt, stageId, facts) : OPEN),
    /** Why Pass can't be chosen yet, if it can't. */
    passBlocked: gated ? passBlocked(receipt!.stageData, receipt!) : undefined,
  };
}
