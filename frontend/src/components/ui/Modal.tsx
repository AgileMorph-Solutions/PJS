import { useEffect } from "react";
import type { ReactNode } from "react";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Widens the panel for content that needs more room (e.g. the workbook upload's preview
   * table) — plain `max-w-lg` is the default, matching every other dialog-shaped UI in this app. */
  wide?: boolean;
}

/** Generic centered dialog — backdrop click and Escape both close it, matching AppNav's mobile
 * drawer convention (backdrop click closes) plus the one keyboard affordance a modal needs that a
 * drawer doesn't. No domain knowledge here; callers own everything in `children`. */
export function Modal({ title, onClose, children, wide }: Props) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div className="fixed inset-0 bg-warmstone-900/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative bg-white rounded-2xl shadow-xl border border-warmstone-200 w-full ${wide ? "max-w-3xl" : "max-w-lg"} my-4`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-warmstone-100">
          <h2 className="text-[15px] font-bold text-warmstone-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-warmstone-400 hover:bg-warmstone-100 hover:text-warmstone-700 transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
