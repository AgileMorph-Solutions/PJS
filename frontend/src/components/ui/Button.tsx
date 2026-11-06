import type { ButtonHTMLAttributes } from "react";

const BASE = "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-[13px] transition-all disabled:opacity-50 disabled:pointer-events-none";

const VARIANTS = {
  primary: "bg-brand-700 hover:bg-brand-800 text-white font-bold shadow-sm",
  secondary: "border border-warmstone-200 bg-white hover:bg-warmstone-50 text-warmstone-800 font-semibold",
  danger: "bg-danger-700 hover:bg-danger-800 text-white font-bold shadow-sm",
} as const;

/** The app's button: one size, three variants, so no page varies padding or weight (ui-consistency skill). */
export function Button({ variant = "primary", icon, children, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANTS; icon?: string }) {
  return (
    <button type={type} className={`${BASE} ${VARIANTS[variant]}`} {...rest}>
      {/* The icon's name is its text, so it would otherwise be read out as part of the button's label. */}
      {icon && <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{icon}</span>}
      {children}
    </button>
  );
}
