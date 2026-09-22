import type { ReactNode } from "react";

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 bg-white border border-warmstone-200 rounded-2xl px-4 py-3 mb-5 shadow-xs [&_input]:px-3 [&_input]:py-2 [&_input]:rounded-xl [&_input]:border [&_input]:border-warmstone-200 [&_input]:bg-warmstone-50 [&_input]:text-[13px] [&_input]:text-warmstone-900 [&_input]:outline-none [&_input]:focus:border-brand-700 [&_input]:focus:bg-white [&_input]:focus:ring-1 [&_input]:focus:ring-brand-700 [&_select]:px-3 [&_select]:py-2 [&_select]:rounded-xl [&_select]:border [&_select]:border-warmstone-200 [&_select]:bg-warmstone-50 [&_select]:text-[13px] [&_select]:text-warmstone-700 [&_select]:outline-none [&_select]:focus:border-brand-700">
      {children}
    </div>
  );
}
