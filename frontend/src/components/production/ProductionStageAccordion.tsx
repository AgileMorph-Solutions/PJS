import type { ReactNode } from "react";

export interface AccordionStep {
  id: string;
  title: string;
  phase: string;
  /** "check": done, green. "number": not done, shows `index`. "fraction": aggregate Bin-level
   * step — shows "doneCount/totalCount" and only turns green once doneCount === totalCount (never
   * a misleading binary check when only some of a Bin's BTMs have a stage's data). */
  badge:
    | { kind: "check" }
    | { kind: "number"; index: number }
    | { kind: "fraction"; doneCount: number; totalCount: number };
  active?: boolean;
  body: ReactNode;
}

interface Props {
  steps: AccordionStep[];
}

/**
 * The production twin of ReceiptDetailPage's "Delivery stages" accordion — same markup, same
 * Tailwind classes, so a production stage tracker reads as the same UI language as procurement's.
 * Unlike that one (a single record's own 15 stages), this renders whatever step list the caller
 * built — a BTM's or Lot's own table-presence steps (binary), or a Bin's aggregate Phase 1-2 steps
 * (fraction). The accordion itself doesn't know which; it only renders whatever badge it's given.
 *
 * Same interaction rule as the reference: every step is independently togglable (native
 * <details>/<summary>, no step locked behind another), `active` only controls which one is open by
 * default.
 */
export function ProductionStageAccordion({ steps }: Props) {
  return (
    <div className="space-y-3">
      {steps.map((step) => {
        const done = step.badge.kind === "check" || (step.badge.kind === "fraction" && step.badge.doneCount === step.badge.totalCount && step.badge.totalCount > 0);
        return (
          <details
            key={step.id}
            open={step.active}
            className={`bg-white rounded-2xl overflow-hidden transition-all ${
              step.active ? "border-2 border-brand-700 shadow-md shadow-brand-700/10" : "border border-warmstone-200 shadow-xs"
            }`}
          >
            <summary
              className={`list-none cursor-pointer p-4.5 flex items-center gap-3.5 transition-colors ${
                step.active ? "bg-gradient-to-r from-brand-50 via-white to-white" : "hover:bg-warmstone-50"
              }`}
            >
              <span
                className={`shrink-0 rounded-full flex items-center justify-center font-bold text-sm ${
                  step.badge.kind === "fraction" ? "h-8 px-2.5 min-w-8" : "w-8 h-8"
                } ${
                  done
                    ? "bg-success-100 text-success-700 border border-success-200"
                    : step.active
                      ? "bg-brand-700 text-white ring-4 ring-brand-100"
                      : "bg-warmstone-100 text-warmstone-400"
                }`}
              >
                {done ? (
                  <span className="material-symbols-outlined text-[18px]">check</span>
                ) : step.badge.kind === "fraction" ? (
                  <span className="text-[11px] tabular-nums whitespace-nowrap">{step.badge.doneCount}/{step.badge.totalCount}</span>
                ) : step.badge.kind === "number" ? (
                  step.badge.index
                ) : (
                  "•"
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-warmstone-900">{step.title}</span>
                  {step.active && (
                    <span className="px-2.5 py-0.5 rounded-full bg-brand-700 text-white text-[11px] font-bold">In progress</span>
                  )}
                </div>
                <p className="text-xs text-warmstone-500 mt-0.5">{step.phase}</p>
              </div>
            </summary>
            <div className="px-5 pb-5 pt-1 border-t border-warmstone-100 bg-warmstone-50/60">
              <div className="pt-4">{step.body}</div>
            </div>
          </details>
        );
      })}
    </div>
  );
}
