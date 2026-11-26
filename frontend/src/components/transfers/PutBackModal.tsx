import { useState, type FormEvent } from "react";
import { pieceNetKg, putBackProblems, readNumber, type FieldProblem } from "@anagroci/contract/domain/transferLot";
import { todayIso } from "@anagroci/contract/domain/dateFormat";
import type { TransferLot } from "@anagroci/contract/types/receipt";
import { formatKg } from "../production/batchUi";
import { Button } from "../ui/Button";
import { DateInput } from "../ui/DateInput";
import { Field, Input, inputClass } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { SearchSelect, type SearchSelectOption } from "../ui/SearchSelect";

export interface PutBackDraft { binCode: string; bags: string; date: string }

/**
 * "Put back in a Bin" (26 Nov 2026, user: half a lot went on the truck, the rest stays): the bags of a lot not on a truck go
 * into a Bin of this warehouse — the one they came from, or another. The kg the Bin gets back is their share of the lot's
 * weighing, worked out and shown, never typed (contract putBackProblems / pieceNetKg).
 */
export function PutBackModal({ lot, binOptions, saving, onSave, onClose }: {
  lot: TransferLot;
  /** This warehouse's Bins, with the stock each shows. */
  binOptions: readonly SearchSelectOption[];
  saving: boolean;
  onSave: (d: PutBackDraft) => Promise<boolean>;
  onClose: () => void;
}) {
  // It starts with every bag not on a truck, into the Bin they came from when there was one.
  const [d, setD] = useState<PutBackDraft>({ binCode: lot.bins.length === 1 ? lot.bins[0]!.binCode : "", bags: String(lot.leftBags), date: todayIso() });
  const [tried, setTried] = useState(false);
  const problems = putBackProblems(d, { weighed: lot.netKg !== null, leftBags: lot.leftBags }, todayIso());
  const shown = (key: keyof PutBackDraft): FieldProblem | undefined => (tried || d[key].trim() ? problems[key] : undefined);
  const blocked = Object.values(problems).some((p) => !p.soft);
  const bags = problems.bags ? null : readNumber(d.bags);
  const kg = bags === null ? null : pieceNetKg(lot.netKg, lot.bags, bags);
  const from = lot.bins.map((b) => b.binCode).join(", ");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!blocked && (await onSave(d))) onClose();
  }

  return (
    <Modal title={`Put back in a Bin · ${lot.lotNo}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-[12px] text-warmstone-500 tabular-nums">
          {lot.leftBags.toLocaleString("en-US")} of its {lot.bags.toLocaleString("en-US")} bags aren't on a truck. Taken from {from}.
        </p>
        <Field label="Bin it goes into *" hint="One of this warehouse's Bins: the one it came from, or another." problem={shown("binCode")}>
          <SearchSelect id={`put-back-bin-${lot.id}`} value={d.binCode} options={binOptions} onChange={(binCode) => setD({ ...d, binCode })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bags put back *" problem={shown("bags")}>
            <Input numeric inputMode="numeric" value={d.bags} onChange={(e) => setD({ ...d, bags: e.target.value })} />
          </Field>
          <Field label="Date *" problem={shown("date")}>
            <DateInput value={d.date} max={todayIso()} onChange={(date) => setD({ ...d, date })} className={inputClass} />
          </Field>
        </div>
        <p className="rounded-xl border border-warmstone-200 bg-warmstone-50 p-3 text-[12px] text-warmstone-700 tabular-nums">
          {kg === null
            ? "The Bin gets back these bags' share of the lot's weighing."
            : <>The Bin gets back <b>{formatKg(kg)}</b>: {bags!.toLocaleString("en-US")} of the lot's {lot.bags.toLocaleString("en-US")} bags, weighed at {formatKg(lot.netKg!)} net.</>}
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" icon="move_to_inbox" disabled={saving || (tried && blocked)}>{saving ? "Saving…" : "Put back in the Bin"}</Button>
        </div>
      </form>
    </Modal>
  );
}
