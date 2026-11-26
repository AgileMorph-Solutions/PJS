import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

/** For a control that takes its own class, such as DateInput. */
export const inputClass =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";

/** A text box. `numeric` lines the digits up and asks for a number keypad. `lead` is shown inside it, before the value (a currency). */
export function Input({ numeric, lead, ...rest }: InputHTMLAttributes<HTMLInputElement> & { numeric?: boolean; lead?: string }) {
  const box = <input className={`${inputClass} ${numeric ? "tabular-nums" : ""} ${lead ? "pl-12" : ""}`} {...(numeric ? { inputMode: "decimal" as const } : {})} {...rest} />;
  return lead ? <LeadBox lead={lead}>{box}</LeadBox> : box;
}

/** Puts a short text inside the left edge of the box it wraps (the box leaves room for it with pl-12). */
export function LeadBox({ lead, children }: { lead: string; children: ReactNode }) {
  return (
    <span className="relative block">
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[13px] font-semibold text-warmstone-500">{lead}</span>
      {children}
    </span>
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={inputClass} {...props} />;
}

/** What is wrong with a field's value: `soft` is a warning (amber), otherwise it can't be right (red). */
export interface FieldProblem { message: string; soft: boolean }

/** The line under a field that says what is wrong with its value, in place of its hint. */
export function ProblemText({ problem }: { problem: FieldProblem }) {
  return <span role={problem.soft ? "status" : "alert"} className={`block text-[12px] mt-1 ${problem.soft ? "text-ambernut-700" : "text-danger-700"}`}>{problem.message}</span>;
}

/** A label, its control and an optional hint — or, when its value is wrong, what is wrong with it. */
export function Field({ label, hint, problem, children }: { label: ReactNode; hint?: string; problem?: FieldProblem; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[12px] font-semibold text-warmstone-700 mb-1.5">{label}</span>
      {children}
      {problem ? <ProblemText problem={problem} /> : hint && <span className="block text-[12px] text-warmstone-500 mt-1">{hint}</span>}
    </label>
  );
}
