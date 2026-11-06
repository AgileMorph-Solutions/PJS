import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

/** For a control that takes its own class, such as DateInput. */
export const inputClass =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";

/** A text box. `numeric` lines the digits up and asks for a number keypad. */
export function Input({ numeric, ...rest }: InputHTMLAttributes<HTMLInputElement> & { numeric?: boolean }) {
  return <input className={`${inputClass} ${numeric ? "tabular-nums" : ""}`} {...(numeric ? { inputMode: "decimal" as const } : {})} {...rest} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={inputClass} {...props} />;
}

/** A label, its control and an optional hint. */
export function Field({ label, hint, children }: { label: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[12px] font-semibold text-warmstone-700 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[12px] text-warmstone-500 mt-1">{hint}</span>}
    </label>
  );
}
