import type { ReactNode } from "react";
import { Field, inputClass } from "../ui/Input";
import { SearchSelect } from "../ui/SearchSelect";

/** The jute forms' boxes are the app's own (ui/Input), so they look and behave like every other form (26 Nov 2026). */
export const inputCls = inputClass;

export const field = (label: string, el: ReactNode, hint?: string) => <Field label={label} hint={hint}>{el}</Field>;

interface ReceivingWarehouseProps {
  /** Ties the dropdown to its form, so two forms on one page don't share one. */
  id: string;
  value: string;
  options: string[];
  /** Assigned to one warehouse: shown, not chosen. */
  fixed: boolean;
  onChange: (warehouse: string) => void;
}

/** Where received bags go: the person's own warehouse, or a choice from the master (the shared searchable dropdown). */
export const receivingWarehouseField = ({ id, value, options, fixed, onChange }: ReceivingWarehouseProps) =>
  field(
    fixed ? "Receiving warehouse" : "Receiving warehouse *",
    fixed ? (
      <input readOnly tabIndex={-1} value={value} className={`${inputClass} bg-warmstone-100 cursor-default`} />
    ) : (
      <SearchSelect id={id} value={value} options={options} onChange={onChange} placeholder="Choose a warehouse…" clearable={false} />
    ),
  );
