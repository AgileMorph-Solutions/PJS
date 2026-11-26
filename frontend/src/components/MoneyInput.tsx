import { useState, type InputHTMLAttributes } from "react";
import { CURRENCY, formatAmount } from "@anagroci/contract/domain/currency";
import { Input } from "./ui/Input";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { value: string; onChange: (value: string) => void };

/**
 * A price or an amount, written as on a bill (26 Nov 2026, user): the currency first, then the figure with its thousands
 * separated ("CFA 19,158,140"). While the box is being typed in it holds the plain number, so a typed separator can't be taken
 * for the decimal comma the workbooks use; what is stored is always the plain number.
 */
export function MoneyInput({ value, onChange, onFocus, onBlur, ...rest }: Props) {
  const [typing, setTyping] = useState(false);
  return (
    <Input
      numeric
      lead={CURRENCY}
      value={typing ? value : formatAmount(value)}
      onFocus={(e) => { setTyping(true); onFocus?.(e); }}
      onBlur={(e) => { setTyping(false); onBlur?.(e); }}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    />
  );
}
