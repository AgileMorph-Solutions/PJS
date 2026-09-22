import { NavLink } from "react-router-dom";
import { NAV } from "../config/nav";

export function AppNav() {
  return (
    <aside className="fixed left-0 top-0 h-screen w-72 bg-white border-r border-warmstone-200 flex flex-col z-50 select-none shadow-[1px_0_12px_rgba(28,25,23,0.03)]">
      {/* Brand header */}
      <div className="p-6 border-b border-warmstone-100">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 flex items-center justify-center shadow-md shadow-brand-700/20 ring-4 ring-brand-100">
            <span className="material-symbols-outlined text-white text-[22px]">eco</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-[16px] tracking-tight text-warmstone-900">ANAGROCI</span>
            </div>
            <div className="text-[12px] font-medium text-warmstone-500">RCN Tracking</div>
          </div>
        </div>
        {/* Real data, not decoration: the two warehouses this app actually tracks. */}
        <div className="mt-3.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-warmstone-50 border border-warmstone-200 text-[11.5px] font-medium text-warmstone-600">
          <span className="w-2 h-2 rounded-full bg-ambernut-600" />
          <span>Bouaké &amp; Yakro Network</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-4 py-5 space-y-6">
        {NAV.map((section) => (
          <div className="space-y-1" key={section.label}>
            <div className="px-3 text-[11px] font-bold text-warmstone-400 uppercase tracking-wider">
              {section.label}
            </div>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-colors font-medium text-[13.5px] ${
                    isActive
                      ? "bg-warmstone-800 text-white shadow-sm font-semibold"
                      : "text-warmstone-600 hover:bg-warmstone-50 hover:text-warmstone-900"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`material-symbols-outlined text-[20px] ${isActive ? "fill text-brand-200" : "text-warmstone-400"}`}
                    >
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* No accounts in this app (single shared workspace) — kept honest rather than a fabricated
          user profile, styled to match the new sidebar chrome. */}
      <div className="p-4 border-t border-warmstone-100 bg-warmstone-50">
        <div className="bg-white border border-warmstone-200 rounded-xl px-3 py-2.5 flex items-center gap-2.5">
          <span className="material-symbols-outlined text-[18px] text-warmstone-400">groups</span>
          <p className="text-[11.5px] text-warmstone-500 leading-snug">
            No accounts yet — a shared workspace, everyone sees the same data.
          </p>
        </div>
      </div>
    </aside>
  );
}
