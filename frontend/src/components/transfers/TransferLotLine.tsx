import { Field, Input } from "../ui/Input";
import { IconButton } from "../ui/IconButton";

/**
 * One Lot on a new BKT: what the Lot is, how much of it there is (or is left), and how much goes on this truck.
 * Presentational: the page works out the size line and the warning (contract's suggestedPiece / pieceChanged).
 */
export function TransferLotLine({
  lotNo, detail, sizeLabel, bags, net, warning, onBags, onNet, onRemove,
}: {
  lotNo: string;
  /** Supplier · bin. */
  detail: string;
  /** "Whole Lot: 200 bags · 39,800 kg", or what is left of it when part is already on a BKT. */
  sizeLabel?: string;
  bags: string;
  net: string;
  /** Short lines shown when the figures differ from what the line started with. Never blocks creating the BKT. */
  warning?: string[];
  onBags: (v: string) => void;
  onNet: (v: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 pb-1">
          <p className="text-[13px] font-medium text-warmstone-800">{lotNo}</p>
          <p className="text-[12px] text-warmstone-500 truncate">{detail}</p>
          {sizeLabel && <p className="text-[12px] text-warmstone-500 tabular-nums">{sizeLabel}</p>}
        </div>
        <div className="w-28">
          <Field label="Bags">
            <Input numeric inputMode="numeric" aria-label={`Bags for ${lotNo}`} value={bags} onChange={(e) => onBags(e.target.value)} />
          </Field>
        </div>
        <div className="w-40">
          <Field label="Net weight (kg)">
            <Input numeric aria-label={`Net weight in kg for ${lotNo}`} value={net} onChange={(e) => onNet(e.target.value)} />
          </Field>
        </div>
        <div className="pb-1">
          <IconButton icon="close" label={`Remove ${lotNo}`} onClick={onRemove} />
        </div>
      </div>
      {warning?.length ? (
        <div role="status" className="flex items-start gap-1.5 text-[12px] text-ambernut-800">
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">warning</span>
          <div className="space-y-0.5 tabular-nums">
            {warning.map((line, i) => <p key={i}>{line}</p>)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
