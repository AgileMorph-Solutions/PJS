import type { ReactNode } from "react";
import { Card, CardTitle } from "../ui/Card";
import { Pill } from "../ui/Pill";

/**
 * One numbered step of a phase, always open: the batch page is read top to bottom, so nothing is hidden behind a
 * click. The step due now has a highlighted border and a "Do this now" pill; a finished one shows a tick.
 */
export function StepCard({ n, title, status, active, done, children }: { n: number; title: string; status: string; active: boolean; done: boolean; children: ReactNode }) {
  return (
    <Card highlight={active}>
      <div className="px-5 pt-4 pb-3 flex items-center gap-3 border-b border-warmstone-100">
        <span className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold ${done ? "bg-success-100 text-success-700 border border-success-200" : active ? "bg-brand-700 text-white" : "bg-warmstone-100 text-warmstone-500"}`}>
          {done ? <span className="material-symbols-outlined text-[18px]">check</span> : n}
        </span>
        <div className="min-w-0 flex-1">
          <CardTitle>Step {n} · {title}</CardTitle>
          <p className="text-[12px] text-warmstone-500 mt-0.5">{status}</p>
        </div>
        {active && <Pill tone="term" label="Do this now" />}
        {done && !active && <Pill tone="entry" label="Done" />}
      </div>
      <div className="px-5 pt-4 pb-5">{children}</div>
    </Card>
  );
}
