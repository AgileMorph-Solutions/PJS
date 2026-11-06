import type { ReactNode } from "react";
import { Card, CardTitle } from "../ui/Card";

/**
 * One numbered step that opens and closes, as on a truck's Reception page: the step to work on now is open and
 * highlighted, a finished one shows a tick, and the rest stay closed until clicked.
 */
export function StepCard({ n, title, status, active, done, children }: { n: number; title: string; status: string; active: boolean; done: boolean; children: ReactNode }) {
  return (
    <Card highlight={active}>
      <details open={active}>
        <summary className="list-none cursor-pointer px-5 py-4 flex items-center gap-3 hover:bg-warmstone-50 transition-colors">
          <span className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold ${done ? "bg-success-100 text-success-700 border border-success-200" : active ? "bg-brand-700 text-white" : "bg-warmstone-100 text-warmstone-500"}`}>
            {done ? <span className="material-symbols-outlined text-[18px]">check</span> : n}
          </span>
          <div className="min-w-0 flex-1">
            <CardTitle>{title}</CardTitle>
            <p className="text-[12px] text-warmstone-500 mt-0.5">{status}</p>
          </div>
          <span className="material-symbols-outlined text-[20px] text-warmstone-400">expand_more</span>
        </summary>
        <div className="px-5 pb-5 pt-1">{children}</div>
      </details>
    </Card>
  );
}
