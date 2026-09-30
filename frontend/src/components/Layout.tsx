import { type FormEvent, type ReactNode, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppNav } from "./AppNav";
import { useAuth } from "../state/AuthContext";
import { ROLE_LABEL } from "../data/roles";
import { siteSlugForType } from "../config/sites";

export function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { me, logout } = useAuth();
  const [q, setQ] = useState("");
  // Below `lg` the sidebar is an off-canvas drawer (see AppNav), closed by default so it never
  // covers the content on a phone/tablet the way a permanently-fixed w-72 sidebar used to.
  const [navOpen, setNavOpen] = useState(false);

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    // No site to scope a header search to — lands on the unit section (the larger of the two,
    // matching pages/LegacyRedirects.tsx's own default), same as visiting a stale /procurement/*
    // link with no other info to resolve from.
    // A non-admin only has their own section.
    const slug = me && me.role !== "admin" ? siteSlugForType(me.warehouseType) ?? "unit" : "unit";
    navigate(`/${slug}/receipts?q=${encodeURIComponent(q.trim())}`);
    setNavOpen(false);
  }

  return (
    <div className="flex min-h-screen bg-warmstone-50">
      <AppNav open={navOpen} onClose={() => setNavOpen(false)} />
      {/* min-w-0 overrides a flex item's default min-width: auto — without it, any wide
          descendant (a nowrap table, a long badge) stops this column from ever shrinking below
          its content's intrinsic width, blowing the whole page out past the viewport instead of
          letting that one element scroll internally (which overflow-x-auto wrappers already do). */}
      <div className="flex-1 min-w-0 lg:pl-72">
        <header className="fixed top-0 left-0 lg:left-72 right-0 h-16 bg-white/95 backdrop-blur-md border-b border-warmstone-200 z-30 px-4 sm:px-6 lg:px-8 flex items-center gap-3">
          <button
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            className="lg:hidden shrink-0 p-2 -ml-1 rounded-lg text-warmstone-600 hover:bg-warmstone-100"
          >
            <span className="material-symbols-outlined text-[22px]">menu</span>
          </button>
          <form onSubmit={handleSearch} className="relative flex-1 max-w-80">
            <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[19px] text-warmstone-400">
              search
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search receipt, vehicle, supplier…"
              className="w-full pl-10 pr-4 py-1.5 bg-warmstone-50 border border-warmstone-200 focus:border-brand-700 focus:bg-white rounded-xl text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:ring-1 focus:ring-brand-700"
            />
          </form>
          {me && (
            <div className="ml-auto flex items-center gap-3 shrink-0">
              <div className="hidden sm:block text-right leading-tight">
                <div className="text-[13px] font-semibold text-warmstone-900">{me.displayName}</div>
                <div className="text-[11px] text-warmstone-500">
                  {ROLE_LABEL[me.role]}{me.warehouse ? ` · ${me.warehouse}` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => { void logout().then(() => navigate("/")); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-warmstone-200 text-warmstone-700 text-xs font-semibold hover:bg-warmstone-50 transition-all shadow-xs"
              >
                <span className="material-symbols-outlined text-[16px]">logout</span>
                Sign out
              </button>
            </div>
          )}
        </header>
        <main className="pt-16 min-h-screen">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
