import type { ReactNode } from "react";

interface Props {
  title: string;
  /** Short context shown next to the title, e.g. a row count — visible whether open or closed. */
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** The app's standard white/rounded card, made collapsible. A native `<details>` disclosure — same
 * mechanism as the stage cards on ReceiptDetailPage, so a card collapses/expands with a plain click
 * and needs no extra state or ARIA wiring. */
export function CollapsibleCard({ title, meta, defaultOpen = false, children }: Props) {
  return (
    <details open={defaultOpen} className="group bg-white border border-warmstone-200 rounded-2xl shadow-xs overflow-hidden">
      <summary className="list-none cursor-pointer px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-warmstone-50 transition-colors">
        <span className="flex items-center gap-2.5 min-w-0">
          <span className="text-[15px] font-bold text-warmstone-900">{title}</span>
          {meta && <span className="text-[12px] text-warmstone-500 truncate">{meta}</span>}
        </span>
        <span className="material-symbols-outlined text-[20px] text-warmstone-400 shrink-0 transition-transform group-open:rotate-180">
          expand_more
        </span>
      </summary>
      <div className="px-5 pb-5 pt-1 border-t border-warmstone-100">{children}</div>
    </details>
  );
}
