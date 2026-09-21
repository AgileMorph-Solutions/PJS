import { Link } from "react-router-dom";

interface Props {
  label: string;
  value: number | string;
  to?: string;
  tone?: "default" | "gap";
}

export function KpiTile({ label, value, to, tone = "default" }: Props) {
  const body = (
    <>
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
