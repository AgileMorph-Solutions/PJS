import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { NAV, type NavLeaf } from "../config/nav";

interface Props {
  /** Mobile/tablet only — below `lg` the nav is an off-canvas drawer, closed by default. At `lg`
   * and up it's always visible (see the `lg:translate-x-0` below) and these props are unused. */
  open: boolean;
  onClose: () => void;
}

/** Mirrors react-router's default (non-`end`) NavLink matching, so "which section is the current
 * route in" agrees with which nav item actually lights up. */
function isItemActive(pathname: string, item: NavLeaf): boolean {
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

function sectionForPath(pathname: string): string | undefined {
  return NAV.find((section) => section.items.some((item) => isItemActive(pathname, item)))?.label;
}

export function AppNav({ open, onClose }: Props) {
  const location = useLocation();
  // Starts on whichever section holds the current route; a section with only one item has
  // nothing to hide, so it's never collapsible in the first place (see the render below).
  const [openSections, setOpenSections] = useState<Set<string>>(() => {
    const active = sectionForPath(location.pathname);
    return new Set(active ? [active] : []);
  });

  // Following a link into a different section reveals it, without collapsing a section the user
  // opened by hand — this only ever adds to the set, a manual header click is the only way to
  // remove from it.
  useEffect(() => {
    const active = sectionForPath(location.pathname);
    if (!active) return;
    setOpenSections((prev) => (prev.has(active) ? prev : new Set(prev).add(active)));
  }, [location.pathname]);

  function toggleSection(label: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <>
      {/* Backdrop — mobile/tablet only, and only while the drawer is open. */}
      {open && (
        <div
          className="fixed inset-0 bg-warmstone-900/40 z-40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed left-0 top-0 h-screen w-72 bg-white border-r border-warmstone-200 flex flex-col z-50 select-none shadow-[1px_0_12px_rgba(28,25,23,0.03)] transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0`}
      >
      {/* Brand header */}
      <div className="p-6 border-b border-warmstone-100">
        <div className="flex items-center justify-between gap-3.5">
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
          <button
            onClick={onClose}
            aria-label="Close navigation"
            className="lg:hidden -mr-1.5 p-1.5 rounded-lg text-warmstone-400 hover:bg-warmstone-100 hover:text-warmstone-700"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-4 py-5 space-y-6">
        {NAV.map((section) => {
          const collapsible = section.items.length > 1;
          const isOpen = !collapsible || openSections.has(section.label);
          return (
          <div className="space-y-1" key={section.label}>
            {collapsible ? (
              <button
                type="button"
                onClick={() => toggleSection(section.label)}
                className="w-full flex items-center justify-between px-3 py-1 text-[11px] font-bold text-warmstone-400 uppercase tracking-wider hover:text-warmstone-600 transition-colors"
                aria-expanded={isOpen}
              >
                {section.label}
                <span
                  className={`material-symbols-outlined text-[16px] transition-transform ${isOpen ? "rotate-0" : "-rotate-90"}`}
                >
                  expand_more
                </span>
              </button>
            ) : (
              <div className="px-3 text-[11px] font-bold text-warmstone-400 uppercase tracking-wider">
                {section.label}
              </div>
            )}
            {isOpen && section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onClose}
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
                    <span className="flex-1">{item.label}</span>
                    {item.badge && (
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md ${
                          isActive ? "bg-white/15 text-white" : "bg-ambernut-100 text-ambernut-700"
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
          );
        })}
      </nav>
      </aside>
    </>
  );
}
