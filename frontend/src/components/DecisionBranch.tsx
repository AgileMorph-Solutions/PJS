import type { BranchOutcome } from "../types/stage";

interface Props {
  branches: BranchOutcome[];
  chosen?: string;
  onChoose: (branchId: string) => void;
}

export function DecisionBranch({ branches, chosen, onChoose }: Props) {
  return (
    <div className="decision-branches">
      {branches.map((b) => (
        <button
          key={b.id}
          type="button"
          className={`branch-card${chosen === b.id ? " chosen" : ""}`}
          onClick={() => onChoose(b.id)}
        >
          <h4>{b.label}</h4>
          <p>{b.note}</p>
        </button>
      ))}
    </div>
  );
}
