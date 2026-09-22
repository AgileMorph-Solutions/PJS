import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface Props {
  label: string;
  value: number | string;
  to?: string;
  tone?: "default" | "gap";
  /** Optional leading icon. Still a generic prop — the caller (a domain page) decides which icon
   * means what; KpiTile itself doesn't know what a receipt or a status is. */
  icon?: ReactNode;
}

export function KpiTile({ label, value, to, tone = "default", icon }: Props) {
  const body = (
    <>
      {icon && <span className="kpi-icon">{icon}</span>}
      <b className={tone === "gap" ? "kpi-value gap" : "kpi-value"}>{value}</b>
      <span className="kpi-label">{label}</span>
    </>
  );
  return to ? (
    <Link to={to} className="kpi-tile kpi-tile-link">
      {body}
    </Link>
  ) : (
    <div className="kpi-tile">{body}</div>
  );
}
