import { NavLink } from "react-router-dom";

export interface TabItem {
  to: string;
  label: string;
  icon?: string;
  /** For tabs that differ only by query string (`?tab=…`), which NavLink's path match can't tell apart. */
  active?: boolean;
  /** A small count shown after the label. */
  badge?: number | string;
  badgeTone?: "default" | "gap";
}

interface Props {
  items: TabItem[];
}

/** Route-driven tab bar — each tab is a real NavLink, not local component state, so the active tab
 * survives a reload, a deep link, and browser back/forward. Purely presentational (no domain
 * knowledge), parameterized entirely by `items` — belongs in ui/, not components/. */
export function Tabs({ items }: Props) {
  return (
    <div className="flex items-center gap-1 border-b border-warmstone-200 mb-5 overflow-x-auto">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `inline-flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
              item.active ?? isActive
                ? "border-brand-700 text-brand-700"
                : "border-transparent text-warmstone-500 hover:text-warmstone-800 hover:border-warmstone-200"
            }`
          }
        >
          {item.icon && <span className="material-symbols-outlined text-[17px]">{item.icon}</span>}
          {item.label}
          {item.badge !== undefined && (
            <span
              className={`min-w-5 px-1.5 py-px rounded-full text-[11px] font-semibold tabular-nums text-center border ${
                item.badgeTone === "gap" ? "bg-danger-100 text-danger-700 border-danger-200" : "bg-warmstone-100 text-warmstone-600 border-warmstone-200"
              }`}
            >
              {item.badge}
            </span>
          )}
        </NavLink>
      ))}
    </div>
  );
}
