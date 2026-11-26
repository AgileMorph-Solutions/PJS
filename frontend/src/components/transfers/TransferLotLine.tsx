import type { FieldProblem } from "@anagroci/contract/domain/transferLot";
import { Field, Input } from "../ui/Input";
import { IconButton } from "../ui/IconButton";

/**
 * One lot on a new BKT: what the lot is, how much of it is left to load, how many of its bags go on this truck, and what they
 * weigh. The weight fills itself from the bags (their share of the lot's weighing) and may be changed (user, 24 Nov 2026).
 * Presentational: the page works out the labels and problems (contract lotPieceProblem / pieceWeightProblem).
 */
export function TransferLotLine({ lotNo, detail, leftLabel, bags, weight, weightHint, bagsProblem, weightProblem, onBags, onWeight, onRemove }: {
  lotNo: string;
  /** Bins · quality. */
  detail: string;
  /** "Left to load: 500 bags · 41,000 kg". */
  leftLabel: string;
  bags: string;
  weight: string;
  /** "Worked out from the bags", or what the bags come to when it was changed. */
  weightHint?: string;
  bagsProblem?: FieldProblem;
  weightProblem?: FieldProblem;
  onBags: (v: string) => void;
  onWeight: (v: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 pt-1">
          <p className="text-[13px] font-medium text-warmstone-800">{lotNo}</p>
          <p className="text-[12px] text-warmstone-500 truncate">{detail}</p>
          <p className="text-[12px] text-warmstone-500 tabular-nums">{leftLabel}</p>
        </div>
        <div className="w-40">
          <Field label="Bags on this truck *" problem={bagsProblem}>
            <Input numeric inputMode="numeric" aria-label={`Bags of ${lotNo} on this truck`} aria-invalid={Boolean(bagsProblem && !bagsProblem.soft)} value={bags} onChange={(e) => onBags(e.target.value)} />
          </Field>
        </div>
        <div className="w-44">
          <Field label="Net weight (kg) *" hint={weightHint} problem={weightProblem}>
            <Input numeric aria-label={`Net weight in kg of ${lotNo} on this truck`} aria-invalid={Boolean(weightProblem && !weightProblem.soft)} value={weight} onChange={(e) => onWeight(e.target.value)} />
          </Field>
        </div>
        <div className="pt-6">
          <IconButton icon="close" label={`Remove ${lotNo}`} onClick={onRemove} />
        </div>
      </div>
    </div>
  );
}
