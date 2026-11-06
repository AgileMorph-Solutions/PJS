import type { BranchOutcome } from "../types/stage";

interface Props {
  branches: BranchOutcome[];
  chosen?: string;
  onChoose: (branchId: string) => void;
  /** Show the decision without letting the viewer change it. */
  readOnly?: boolean;
  /** Options that can't be chosen yet. Say why in `notice`. */
  unavailable?: string[];
  notice?: string;
}

export function DecisionBranch({ branches, chosen, onChoose, readOnly, unavailable, notice }: Props) {
  return (
    <div className="space-y-2">
      <div className="grid sm:grid-cols-2 gap-3">
        {branches.map((b) => {
          const isChosen = chosen === b.id;
          const blocked = unavailable?.includes(b.id) && !isChosen;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onChoose(b.id)}
              disabled={readOnly || blocked}
              className={`text-left rounded-xl border-2 p-4 transition-all disabled:cursor-default ${blocked ? "opacity-50" : ""} ${
                isChosen
                  ? "border-brand-700 bg-brand-50 shadow-sm"
                  : "border-dashed border-warmstone-300 bg-white hover:border-warmstone-400 hover:bg-warmstone-50"
              }`}
            >
              <h4 className={`text-[13px] font-bold flex items-center gap-1.5 ${isChosen ? "text-brand-800" : "text-warmstone-900"}`}>
                {isChosen && <span className="material-symbols-outlined text-[16px] fill">check_circle</span>}
                {b.label}
              </h4>
              <p className="text-[12px] text-warmstone-500 mt-1 leading-relaxed">{b.note}</p>
            </button>
          );
        })}
      </div>
      {notice && <p className="text-[12px] font-semibold text-ambernut-700">{notice}</p>}
    </div>
  );
}
