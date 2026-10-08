import {
  EXCEPTION_APPROVAL_LABELS, PLAN_FLAG_LABELS, PLAN_LINK_LABELS, RECEPTION_TYPE_LABELS, type ExceptionApproval, type PlanLinkStatus, type ReceptionType,
} from "@anagroci/contract/domain/deliveryPlan";
import type { ReceiptPlanInfo } from "../../types/receipt";
import { Pill } from "../ui/Pill";

// The words come from the contract (the workbook says the same); only the tone is a screen's own business.
const TONE_OF_TYPE: Record<ReceptionType, string> = { planned: "entry", planned_with_exception: "decision", unplanned: "decision" };
const TONE_OF_APPROVAL: Record<ExceptionApproval, string> = { not_required: "system", pending: "decision", approved: "entry", not_applicable_rejected: "system" };

export const RECEPTION_TYPE = Object.fromEntries(
  (Object.keys(RECEPTION_TYPE_LABELS) as ReceptionType[]).map((k) => [k, { label: RECEPTION_TYPE_LABELS[k], tone: TONE_OF_TYPE[k] }])
) as Record<ReceptionType, { label: string; tone: string }>;

export const APPROVAL = Object.fromEntries(
  (Object.keys(EXCEPTION_APPROVAL_LABELS) as ExceptionApproval[]).map((k) => [k, { label: EXCEPTION_APPROVAL_LABELS[k], tone: TONE_OF_APPROVAL[k] }])
) as Record<ExceptionApproval, { label: string; tone: string }>;

export const LINK_STATUS: Record<PlanLinkStatus, string> = PLAN_LINK_LABELS;

/** Reception Type, with the approval state beside it only when a decision is still owed. */
export function ReceptionTypePill({ info }: { info?: ReceiptPlanInfo }) {
  if (!info) return <span className="text-warmstone-300">-</span>;
  const t = RECEPTION_TYPE[info.type];
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Pill tone={t.tone} label={t.label} />
      {info.approval === "pending" && <span className="text-[10.5px] font-semibold text-ambernut-700">approval pending</span>}
    </span>
  );
}

/** Why a truck is not simply "as planned", in the client's own wording. */
export function PlanFlagList({ flags }: { flags: ReceiptPlanInfo["flags"] }) {
  if (!flags.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {flags.map((f) => (
        <li key={f} className="px-2 py-0.5 rounded-full bg-warmstone-100 border border-warmstone-200 text-[11px] font-medium text-warmstone-700">
          {PLAN_FLAG_LABELS[f]}
        </li>
      ))}
    </ul>
  );
}
