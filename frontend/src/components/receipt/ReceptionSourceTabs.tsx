import { NavLink } from "react-router-dom";
import type { SiteConfig } from "../../config/sites";

export interface ReceptionSourceCounts {
  /** Reception records of supplier trucks at this warehouse. */
  suppliers: number;
  /** Reception records of trucks from the Unit warehouse. */
  unit: number;
  /** Trucks the Unit warehouse dispatched here that aren't received yet. */
  onTheRoad: number;
}

/**
 * Where a truck at a Central warehouse comes from (24 Nov 2026): a supplier, or the Unit warehouse on a BKT. Both go through
 * the same reception; each has its own list. Two large tabs, each saying what it holds and how many, so nobody wonders which
 * list a truck is on (user, 24 Nov 2026: "make this tabs much more clear"). A Unit warehouse only receives from suppliers:
 * no tabs there.
 */
export function ReceptionSourceTabs({ site, counts, unitFrom }: {
  site: Pick<SiteConfig, "slug" | "type">;
  counts?: ReceptionSourceCounts;
  /** The Unit warehouse(s) trucks come from, named in the tab ("BOUAKE"). */
  unitFrom?: string;
}) {
  if (site.type !== "CENTRAL") return null;
  const tabs = [
    {
      to: `/${site.slug}/receipts`, end: true, icon: "agriculture", title: "From suppliers",
      sub: "Trucks bought from suppliers: supplier, fiche, price.", count: counts?.suppliers, badge: undefined,
    },
    {
      to: `/${site.slug}/receipts/from-unit`, end: false, icon: "local_shipping", title: "From Unit warehouse",
      sub: `Trucks sent by ${unitFrom || "the Unit warehouse"} on a BKT: no supplier, no price.`, count: counts?.unit,
      badge: counts?.onTheRoad ? `${counts.onTheRoad} on the road` : undefined,
    },
  ];
  return (
    <nav aria-label="Where the trucks come from" className="grid sm:grid-cols-2 gap-3 mb-5">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            `flex items-start gap-3 rounded-xl border p-4 transition-all ${
              isActive ? "border-2 border-brand-700 bg-brand-50 shadow-xs" : "border-warmstone-200 bg-white hover:border-warmstone-300 hover:bg-warmstone-50"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <span className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${isActive ? "bg-brand-700 text-white" : "bg-warmstone-100 text-warmstone-500"}`}>
                <span aria-hidden="true" className="material-symbols-outlined text-[20px]">{t.icon}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={`text-[13px] font-bold ${isActive ? "text-brand-700" : "text-warmstone-900"}`}>{t.title}</span>
                  {t.badge && <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-ambernut-100 text-ambernut-800 border border-ambernut-200">{t.badge}</span>}
                </span>
                <span className="block text-[12px] text-warmstone-500 mt-0.5">{t.sub}</span>
              </span>
              {t.count !== undefined && <span className={`text-xl font-bold tracking-tight tabular-nums ${isActive ? "text-brand-700" : "text-warmstone-700"}`}>{t.count.toLocaleString("en-US")}</span>}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
