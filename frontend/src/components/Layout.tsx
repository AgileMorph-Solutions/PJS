import { type FormEvent, type ReactNode, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppNav } from "./AppNav";

export function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    navigate(`/procurement/receipts?q=${encodeURIComponent(q.trim())}`);
  }

  return (
    <div className="flex min-h-screen bg-warmstone-50">
      <AppNav />
      <div className="flex-1 pl-72">
        <header className="fixed top-0 left-72 right-0 h-16 bg-white/95 backdrop-blur-md border-b border-warmstone-200 z-40 px-8 flex items-center">
          <form onSubmit={handleSearch} className="relative w-80">
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
        </header>
        <main className="pt-16 min-h-screen">
          <div className="max-w-7xl mx-auto px-8 py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
