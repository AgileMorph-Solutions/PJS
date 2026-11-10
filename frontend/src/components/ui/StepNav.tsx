/**
 * A list of steps where one is open at a time: pick a step, its form shows beside (vertical) or under (horizontal) the
 * list. Each step says where it stands with the same marks everywhere — a tick when done, a filled brand dot for the
 * job due now, an amber dot when it waits on someone else, a number when not reached, and a dashed outline for a step
 * that can't be opened yet. No domain knowledge: callers pass labels and states.
 */
export type StepState = "done" | "current" | "waiting" | "todo" | "later";

export interface StepItem<Id extends string> {
  id: Id;
  label: string;
  /** One short line under the label: a count, who is next, or why it is unavailable. */
  sub?: string;
  state: StepState;
}

const MARK: Record<StepState, string> = {
  done: "bg-success-600 border-success-600 text-white",
  current: "bg-brand-700 border-brand-700 text-white",
  waiting: "bg-ambernut-100 border-ambernut-400 text-ambernut-800",
  todo: "bg-white border-warmstone-300 text-warmstone-500",
  later: "bg-warmstone-50 border-dashed border-warmstone-300 text-warmstone-400",
};

function Mark({ n, state }: { n: number; state: StepState }) {
  return (
    <span className={`shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center text-[11px] font-bold ${MARK[state]}`}>
      {state === "done" ? <span className="material-symbols-outlined text-[16px]">check</span> : state === "waiting" ? <span className="material-symbols-outlined text-[16px]">schedule</span> : n}
    </span>
  );
}

export function StepNav<Id extends string>({ steps, selected, onSelect, layout = "vertical", label }: {
  steps: StepItem<Id>[];
  selected: Id;
  onSelect: (id: Id) => void;
  layout?: "vertical" | "horizontal";
  /** What the list is, for screen readers ("Stages", "Steps of this load"). */
  label: string;
}) {
  const vertical = layout === "vertical";
  return (
    <nav aria-label={label}>
      <ol className={vertical ? "space-y-1" : "flex gap-2 overflow-x-auto pb-1"}>
        {steps.map((s, i) => {
          const on = s.id === selected;
          const disabled = s.state === "later";
          return (
            <li key={s.id} className={vertical ? "" : "flex-1 min-w-[140px]"}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(s.id)}
                aria-current={on ? "step" : undefined}
                className={`w-full flex items-center gap-3 text-left rounded-xl border px-3 py-2.5 transition-colors disabled:cursor-not-allowed ${
                  on ? "border-brand-700 bg-brand-50" : "border-transparent hover:bg-warmstone-100"
                } ${vertical ? "" : on ? "" : "border-warmstone-200 bg-white"}`}
              >
                <Mark n={i + 1} state={s.state} />
                <span className="min-w-0">
                  <span className={`block text-[13px] font-semibold ${disabled ? "text-warmstone-400" : on ? "text-brand-800" : "text-warmstone-900"}`}>{s.label}</span>
                  {s.sub && <span className="block text-[11px] text-warmstone-500 truncate">{s.sub}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
