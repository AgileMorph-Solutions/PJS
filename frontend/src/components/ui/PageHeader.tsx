import type { ReactNode } from "react";

interface Props {
  kicker?: string;
  title: string;
  lede?: string;
  actions?: ReactNode;
}

export function PageHeader({ kicker, title, lede, actions }: Props) {
  return (
    <div className="page-header-row">
      <div>
        {kicker && <p className="kicker">{kicker}</p>}
        <h2 className="page-title">{title}</h2>
        {lede && <p className="page-lede">{lede}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </div>
  );
}
