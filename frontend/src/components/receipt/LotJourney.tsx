import type { JourneyStep } from "./lotJourney";

const DOT: Record<JourneyStep["state"], string> = {
  done: "bg-success-600 text-white",
  active: "bg-brand-700 text-white ring-4 ring-brand-100",
  todo: "bg-warmstone-100 text-warmstone-400",
  failed: "bg-danger-600 text-white",
};

/** The Lot's whole path on one line. Scrolls sideways on a phone rather than wrapping, so the order
 * is never ambiguous. */
export function LotJourney({ steps }: { steps: JourneyStep[] }) {
  return (
    <ol className="flex items-start overflow-x-auto pb-1 -mx-1 px-1">
      {steps.map((s, i) => (
        <li key={s.id} className="flex-1 min-w-[84px] flex flex-col items-center text-center relative">
          {i > 0 && (
            <span
              aria-hidden
              className={`absolute top-[17px] right-1/2 w-full h-0.5 -z-0 ${
                steps[i - 1].state === "done" && s.state !== "todo" ? "bg-success-400" : "bg-warmstone-200"
              }`}
            />
          )}
          <span className={`relative z-10 w-9 h-9 rounded-full flex items-center justify-center transition-all ${DOT[s.state]}`}>
            <span className="material-symbols-outlined text-[18px]">
              {s.state === "done" ? "check" : s.state === "failed" ? "close" : s.icon}
            </span>
          </span>
          <span className={`mt-2 text-[12px] font-bold ${s.state === "todo" ? "text-warmstone-400" : "text-warmstone-900"}`}>{s.label}</span>
          <span className="text-[11px] text-warmstone-500 mt-0.5 min-h-[14px] tabular-nums">{s.detail ?? ""}</span>
        </li>
      ))}
    </ol>
  );
}
