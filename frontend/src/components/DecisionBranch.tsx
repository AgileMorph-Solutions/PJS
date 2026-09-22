import type { BranchOutcome } from "../types/stage";

interface Props {
  branches: BranchOutcome[];
  chosen?: string;
  onChoose: (branchId: string) => void;
}

export function DecisionBranch({ branches, chosen, onChoose }: Props) {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {branches.map((b) => {
        const isChosen = chosen === b.id;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onChoose(b.id)}
            className={`text-left rounded-xl border-2 p-4 transition-all ${
              isChosen
                ? "border-brand-700 bg-brand-50 shadow-sm"
                : "border-dashed border-warmstone-300 bg-white hover:border-warmstone-400 hover:bg-warmstone-50"
            }`}
          >
            <h4 className={`text-[13.5px] font-bold flex items-center gap-1.5 ${isChosen ? "text-brand-800" : "text-warmstone-900"}`}>
              {isChosen && <span className="material-symbols-outlined text-[16px] fill">check_circle</span>}
              {b.label}
            </h4>
            <p className="text-[12.5px] text-warmstone-500 mt-1 leading-relaxed">{b.note}</p>
          </button>
        );
      })}
    </div>
  );
}
