import type { ReactNode } from "react";

interface Props {
  kicker?: string;
  title: string;
  lede?: string;
  actions?: ReactNode;
}

export function PageHeader({ kicker, title, lede, actions }: Props) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-5 mb-6">
      <div>
        {kicker && (
          <p className="text-[11px] font-bold text-warmstone-500 uppercase tracking-wider mb-1.5">{kicker}</p>
        )}
        <h1 className="text-2xl font-bold text-warmstone-900 tracking-tight">{title}</h1>
        {lede && <p className="text-sm text-warmstone-500 mt-1.5 max-w-2xl leading-relaxed">{lede}</p>}
      </div>
      {actions && <div className="pt-0.5">{actions}</div>}
    </div>
  );
}
