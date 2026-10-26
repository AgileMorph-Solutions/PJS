/** A person's initial in a brand circle. Decorative: the name is always printed next to it, so it's hidden from screen readers. */
export function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={`shrink-0 rounded-full bg-brand-50 text-brand-700 font-bold grid place-items-center uppercase ${
        size === "md" ? "w-8 h-8 text-[12px]" : "w-6 h-6 text-[11px]"
      }`}
    >
      {name.slice(0, 1)}
    </span>
  );
}
