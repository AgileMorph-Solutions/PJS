import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface Props {
  label: string;
  value: number | string;
  to?: string;
  tone?: "default" | "gap";
  /** Optional leading icon (a Material Symbols <span>). Still a generic prop — the caller decides
   * which icon means what; KpiTile itself doesn't know what a receipt or a status is. */
  icon?: ReactNode;
}

export function KpiTile({ label, value, to, tone = "default", icon }: Props) {
  const body = (
    <>
      <div className="flex items-center justify-between mb-1">
        {icon && <span className="text-brand-700 [&_.material-symbols-outlined]:text-[20px]">{icon}</span>}
      </div>
      <b className={`text-[28px] font-bold tracking-tight tabular-nums ${tone === "gap" ? "text-danger-700" : "text-warmstone-900"}`}>
        {value}
      </b>
      <span className="block text-[11px] font-bold uppercase tracking-wider text-warmstone-500 mt-1">{label}</span>
    </>
  );
  const cls = "bg-warmstone-50 hover:bg-warmstone-100 rounded-xl p-4 border border-warmstone-200 transition-all block";
  return to ? (
    <Link to={to} className={`${cls} hover:-translate-y-0.5 hover:shadow-sm`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
