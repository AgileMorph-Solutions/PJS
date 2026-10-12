import { truckTimeline, type TimelineStepState } from "@anagroci/contract/domain/truckTimeline";
import type { ReceiptRecord } from "../../types/receipt";

const DOT: Record<TimelineStepState, string> = {
  done: "bg-success-600 text-white",
  rejected: "bg-danger-600 text-white",
  next: "bg-warmstone-100 text-warmstone-400 border border-dashed border-warmstone-300",
};
const ICON: Record<TimelineStepState, string> = { done: "check", rejected: "close", next: "more_horiz" };

/**
 * When the truck arrived and what happened after, step by step with dates. Derived from the receipt
 * (contract domain/truckTimeline.ts); a date the warehouse entered is shown as is, one the system only
 * noted is marked "recorded" so the two are never confused.
 */
export function TruckSummaryCard({ receipt }: { receipt: ReceiptRecord }) {
  const steps = truckTimeline(receipt);
  return (
    <section className="bg-white border border-warmstone-200 rounded-2xl shadow-xs p-5">
      <h2 className="text-base font-bold text-warmstone-900 flex items-center gap-2 mb-4">
        <span className="material-symbols-outlined text-[19px] text-brand-700">local_shipping</span>
        Truck summary
      </h2>
      <ol className="space-y-3">
        {steps.map((s) => (
          <li key={s.id} className="flex items-start gap-3">
            <span className={`mt-0.5 w-6 h-6 shrink-0 rounded-full flex items-center justify-center ${DOT[s.state]}`}>
              <span className="material-symbols-outlined text-[15px]">{ICON[s.state]}</span>
            </span>
            <div className="min-w-0">
              <p className={`text-[13px] font-semibold ${s.state === "next" ? "text-warmstone-400" : s.state === "rejected" ? "text-danger-700" : "text-warmstone-900"}`}>
                {s.state === "next" ? `Waiting for: ${s.label.toLowerCase()}` : s.label}
              </p>
              {(s.at || s.detail) && (
                <p className="text-[12px] text-warmstone-500 tabular-nums">
                  {s.at}{s.at && s.atKind === "recorded" ? " (recorded)" : ""}{s.at && s.detail ? " · " : ""}{s.detail}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
