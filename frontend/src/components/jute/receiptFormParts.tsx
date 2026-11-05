import type { ReactNode } from "react";

export const inputCls =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-white text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100";

export const field = (label: string, el: ReactNode) => (
  <label className="block">
    <span className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">{label}</span>
    {el}
  </label>
);

interface ReceivingWarehouseProps {
  value: string;
  options: string[];
  /** Assigned to one warehouse: shown, not chosen. */
  fixed: boolean;
  onChange: (warehouse: string) => void;
}

/** Where received bags go: the person's own warehouse, or a choice from the master when they have none. */
export const receivingWarehouseField = ({ value, options, fixed, onChange }: ReceivingWarehouseProps) =>
  field(
    fixed ? "Receiving warehouse" : "Receiving warehouse *",
    fixed ? (
      <input readOnly tabIndex={-1} value={value} className={`${inputCls} bg-warmstone-50! cursor-not-allowed focus:border-warmstone-200! focus:ring-0!`} />
    ) : (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        <option value="">Choose a warehouse…</option>
        {options.map((w) => <option key={w} value={w}>{w}</option>)}
      </select>
    ),
  );
