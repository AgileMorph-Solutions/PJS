import type { ReactNode } from "react";

/**
 * The one sentence at the top of a phase that says what to do next. Every phase uses it, so the person learns one
 * place to look: brand colour while there is work, green once the phase is finished for now.
 */
export function NextStep({ done, children, action }: { done: boolean; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${done ? "border-success-200 bg-success-50" : "border-brand-200 bg-brand-50"}`}>
      <span className={`material-symbols-outlined text-[20px] ${done ? "text-success-700" : "text-brand-700"}`}>{done ? "check_circle" : "arrow_forward"}</span>
      <p className="min-w-0 flex-1 text-[13px] font-semibold text-warmstone-900">{children}</p>
      {action}
    </div>
  );
}
