import type { ReactNode } from "react";

/** A titled card of label/value rows — the "everything about X at a glance" block. Generic: knows
 * nothing about receipts, just renders what it is given. A row whose value is empty shows a quiet
 * dash instead of disappearing, so the card keeps the same shape from record to record. */
export function InfoCard({
  icon,
  title,
  badge,
  children,
  footer,
}: {
  icon: string;
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="bg-white border border-warmstone-200 rounded-2xl shadow-xs flex flex-col">
      <header className="flex items-center gap-2.5 px-5 pt-4 pb-3">
        <span className="w-8 h-8 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-[18px]">{icon}</span>
        </span>
        <h3 className="text-[14px] font-bold text-warmstone-900 flex-1">{title}</h3>
        {badge}
      </header>
      <dl className="px-5 pb-4 space-y-2 flex-1">{children}</dl>
      {footer && <div className="px-5 py-3 border-t border-warmstone-100 bg-warmstone-50/60 rounded-b-2xl">{footer}</div>}
    </section>
  );
}

export function InfoRow({ label, value, strong }: { label: string; value?: ReactNode; strong?: boolean }) {
  const empty = value === undefined || value === null || value === "";
  return (
    <div className="flex items-baseline justify-between gap-4 text-[13px]">
      <dt className="text-warmstone-500 shrink-0">{label}</dt>
      <dd className={`text-right tabular-nums ${empty ? "text-warmstone-300" : strong ? "font-bold text-warmstone-900" : "font-medium text-warmstone-800"}`}>
        {empty ? "-" : value}
      </dd>
    </div>
  );
}
