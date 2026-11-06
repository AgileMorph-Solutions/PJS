import type { ReactNode } from "react";

/** The card shell. `highlight` marks the one the person should work on now. Header and body padding belong to what goes inside. */
export function Card({ highlight, children }: { highlight?: boolean; children: ReactNode }) {
  return <section className={`bg-white rounded-2xl shadow-xs overflow-hidden ${highlight ? "border-2 border-brand-700" : "border border-warmstone-200"}`}>{children}</section>;
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-[15px] font-bold text-warmstone-900">{children}</h3>;
}
