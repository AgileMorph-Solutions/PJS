import { useState, type FormEvent } from "react";
import { binDrawProblem, lotNetKg, lotWeighingProblems, readNumber, shareByBags, SUGGESTED_KG_PER_BAG, suggestedScaleWeightKg, type FieldProblem, type LotWeighingDraft } from "@anagroci/contract/domain/transferLot";
import type { TransferLot } from "@anagroci/contract/types/receipt";
import { formatKg } from "../production/batchUi";
import { Button } from "../ui/Button";
import { Field, Input, ProblemText } from "../ui/Input";
import { Modal } from "../ui/Modal";

const asText = (x: number | null) => (x === null ? "" : String(x));

/**
 * "Record weight" for a lot: what the scale read once its bags were weighed together, and its moisture, KOR and nut count.
 * The net and each Bin's share by bags are shown as worked out, never typed. A Bin going below what its stock shows is a
 * warning only; a value that can't be right is red and stops the save (contract lotWeighingProblems).
 */
export function WeighLotModal({ lot, binKg, saving, onSave, onClose }: {
  lot: TransferLot;
  /** Stock each Bin shows now, by code; a Bin not in it isn't known yet. The lot's own share is already out of it when it was weighed before. */
  binKg: ReadonlyMap<string, number>;
  saving: boolean;
  onSave: (d: LotWeighingDraft) => Promise<boolean>;
  onClose: () => void;
}) {
  const [d, setD] = useState<LotWeighingDraft>({ grossWeightKg: asText(lot.grossWeightKg), moisture: asText(lot.moisture), kor: asText(lot.kor), nutCount: asText(lot.nutCount) });
  const [tried, setTried] = useState(false);
  const problems = lotWeighingProblems(d, lot.bags);
  const shown = (key: keyof LotWeighingDraft): FieldProblem | undefined => (tried || d[key].trim() ? problems[key] : undefined);
  const blocked = Object.values(problems).some((p) => !p.soft);

  const gross = problems.grossWeightKg?.soft === false ? null : readNumber(d.grossWeightKg);
  const net = lotNetKg(gross, lot.bags);
  const shares = shareByBags(net, lot.bins.map((b) => b.bags));
  // A re-weighing replaces the earlier one: that share is already off the Bin's stock, so it is put back before comparing.
  // Undefined while the Bin's stock hasn't loaded: then nothing is compared, rather than a Bin read as empty.
  const available = (code: string, i: number) => (binKg.has(code) ? binKg.get(code)! + (lot.bins[i]?.netKg ?? 0) : undefined);

  // A full bag weighs about 81 kg on the scale (80 kg of RCN and its 1 kg bag): offered, never forced (user, 24 Nov 2026).
  const suggested = suggestedScaleWeightKg(lot.bags);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!blocked && (await onSave(d))) onClose();
  }

  const box = (key: keyof LotWeighingDraft, label: string, hint?: string, whole = false) => (
    <Field label={label} hint={hint} problem={shown(key)}>
      <Input numeric inputMode={whole ? "numeric" : "decimal"} aria-invalid={Boolean(shown(key) && !shown(key)!.soft)} value={d[key]} onChange={(e) => setD({ ...d, [key]: e.target.value })} />
    </Field>
  );

  return (
    <Modal title={`Record weight · ${lot.lotNo}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-[12px] text-warmstone-500 tabular-nums">{lot.bags.toLocaleString("en-US")} bags, weighed together.</p>
        <div>
          <Field label="Weight on the scale (kg) *" problem={shown("grossWeightKg")}>
            <Input
              numeric aria-invalid={Boolean(shown("grossWeightKg"))} placeholder={String(suggested)}
              value={d.grossWeightKg} onChange={(e) => setD({ ...d, grossWeightKg: e.target.value })}
            />
          </Field>
          {!shown("grossWeightKg") && (
            <p className="mt-1 text-[12px] text-warmstone-500 tabular-nums">
              Suggested: <span className="font-semibold text-warmstone-800">{suggested.toLocaleString("en-US")} kg</span>{" "}
              ({lot.bags.toLocaleString("en-US")} bags × {SUGGESTED_KG_PER_BAG} kg, the bag included){" · "}
              <button type="button" className="font-semibold text-brand-700 hover:text-brand-800" onClick={() => setD({ ...d, grossWeightKg: String(suggested) })}>Use it</button>
            </p>
          )}
        </div>
        {/* The QFS Officer's to measure (26 Nov 2026): left blank, they send it from Quality checks, and the lot loads once it's approved. */}
        <p className="text-[12px] text-warmstone-500">Quality: all three, or leave them blank for the QFS Officer to record. The lot goes on a truck once it has its quality.</p>
        <div className="grid grid-cols-3 gap-3">
          {box("moisture", "Moisture (%)")}
          {box("kor", "KOR")}
          {box("nutCount", "Nut count", "Nuts in 1 kg.", true)}
        </div>

        <div className="rounded-xl border border-warmstone-200 bg-warmstone-50 p-3 space-y-1.5">
          <p className="text-[12px] font-semibold text-warmstone-700">Net {net === null ? "-" : formatKg(net)}, taken from</p>
          {lot.bins.map((b, i) => {
            const inBin = available(b.binCode, i);
            const warn = inBin === undefined ? undefined : binDrawProblem(inBin, shares[i] ?? null);
            return (
              <div key={b.binCode} className="text-[12px]">
                <p className="flex justify-between gap-3 tabular-nums text-warmstone-800">
                  <span>{b.binCode} · {b.bags.toLocaleString("en-US")} bags</span>
                  <span>
                    {shares[i] === null || shares[i] === undefined ? "-" : formatKg(shares[i]!)}
                    {inBin !== undefined && <span className="text-warmstone-500">, of {formatKg(Math.max(inBin, 0))} in the Bin</span>}
                  </span>
                </p>
                {warn && <ProblemText problem={warn} />}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" icon="scale" disabled={saving || (tried && blocked)}>Save the weight</Button>
        </div>
      </form>
    </Modal>
  );
}
