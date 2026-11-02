import type { ReactNode } from "react";

export type StepState = "done" | "active" | "waiting" | "later";

/**
 * One step of production work, styled like a truck's stage cards on its Reception page: done collapses
 * with a tick, active is open for entry, waiting is someone else's turn, later is not built yet.
 */
export function StepCard({ num, title, sub, state, badge, open, children }: {
  num: number | string;
  title: string;
  sub?: string;
  state: StepState;
  badge?: ReactNode;
  /** Open when first shown; defaults to the active step only. */
  open?: boolean;
  children?: ReactNode;
}) {
  const header = (
    <>
      <span
        className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center font-bold text-sm ${
          state === "done"
            ? "bg-success-100 text-success-700 border border-success-200"
            : state === "active"
              ? "bg-brand-700 text-white ring-4 ring-brand-100"
              : state === "waiting"
                ? "bg-ambernut-100 text-ambernut-700 border border-ambernut-200"
                : "bg-warmstone-100 text-warmstone-400"
        }`}
      >
        {state === "done" ? <span className="material-symbols-outlined text-[18px]">check</span> : state === "waiting" ? <span className="material-symbols-outlined text-[18px]">hourglass_top</span> : num}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-bold ${state === "later" ? "text-warmstone-400" : "text-warmstone-900"}`}>{title}</span>
          {state === "active" && <span className="px-2.5 py-0.5 rounded-full bg-brand-700 text-white text-[11px] font-bold">In progress</span>}
          {state === "later" && <span className="px-2 py-0.5 rounded-full bg-warmstone-100 text-warmstone-500 text-[11px] font-semibold">Not built yet</span>}
          {badge}
        </div>
        {sub && <p className="text-xs text-warmstone-500 mt-0.5">{sub}</p>}
      </div>
    </>
  );

  if (!children) return <div className="bg-white/60 border border-warmstone-200 rounded-2xl p-3.5 flex items-center gap-3.5">{header}</div>;

  const highlighted = state === "active" || state === "waiting";
  return (
    <details
      open={open ?? state === "active"}
      className={`bg-white rounded-2xl overflow-hidden ${highlighted ? `border-2 ${state === "active" ? "border-brand-700" : "border-ambernut-300"} shadow-md shadow-brand-700/10` : "border border-warmstone-200 shadow-xs"}`}
    >
      <summary className={`list-none cursor-pointer p-4.5 flex items-center gap-3.5 ${state === "active" ? "bg-gradient-to-r from-brand-50 via-white to-white" : "hover:bg-warmstone-50"}`}>
        {header}
      </summary>
      <div className="px-5 pb-5 pt-4 border-t border-warmstone-100 bg-warmstone-50/60">{children}</div>
    </details>
  );
}
