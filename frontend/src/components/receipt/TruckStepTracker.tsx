import { journeyFromStatus, type JourneyState } from "@anagroci/contract/domain/truckTimeline";
import type { ReceiptStatus } from "../../types/receipt";

const DOT: Record<JourneyState, string> = {
  done: "bg-success-600 text-white",
  rejected: "bg-danger-600 text-white",
  next: "bg-white text-brand-700 border-2 border-brand-700",
  todo: "bg-warmstone-100 text-warmstone-300 border border-warmstone-200",
  na: "bg-warmstone-50 text-warmstone-300 border border-dashed border-warmstone-200",
};
const ICON: Record<JourneyState, string> = { done: "check", rejected: "close", next: "more_horiz", todo: "", na: "" };
const TEXT: Record<JourneyState, string> = {
  done: "text-warmstone-700", rejected: "text-danger-700 font-semibold", next: "text-brand-700 font-semibold", todo: "text-warmstone-400", na: "text-warmstone-300",
};

/**
 * Where one truck is on its way to becoming stock: Arrived, Quality, Unloaded, GRN, In stock. Done steps are
 * filled, the step it is waiting on is outlined, the rest are hollow; a rejected truck stops at Quality.
 * Derived from the truck's status (contract domain/truckTimeline.ts), the same as the receipt's own page.
 */
export function TruckStepTracker({ status }: { status: ReceiptStatus }) {
  const steps = journeyFromStatus(status);
  return (
    <ol className="inline-flex items-start" aria-label="Steps done">
      {steps.map((s, i) => (
        <li key={s.id} className="relative flex flex-col items-center w-[58px]" title={`${s.label}: ${s.state === "done" ? "done" : s.state === "rejected" ? "rejected" : s.state === "next" ? "waiting" : s.state === "na" ? "not applicable" : "not yet"}`}>
          {i > 0 && <span aria-hidden className={`absolute top-[10px] right-1/2 w-full h-0.5 ${steps[i - 1].state === "done" && (s.state === "done" || s.state === "rejected") ? "bg-success-400" : "bg-warmstone-200"}`} />}
          <span className={`relative z-10 w-5 h-5 rounded-full flex items-center justify-center ${DOT[s.state]}`}>
            {ICON[s.state] && <span className="material-symbols-outlined text-[13px]">{ICON[s.state]}</span>}
          </span>
          <span className={`mt-1 text-[10.5px] leading-tight text-center ${TEXT[s.state]}`}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}
