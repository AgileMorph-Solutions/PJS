import { useState, type FormEvent } from "react";
import { formatKg } from "./batchUi";
import { Button } from "../ui/Button";
import { DateInput } from "../ui/DateInput";
import { Field, Input, inputClass } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { api, ApiError } from "../../repository/api";
import { SILO_SIZES, calibrationRunError, siloLabel, sizesTotal, type SizeValues } from "@anagroci/contract/domain/calibration";
import { pctOfNet, weighingTotals } from "@anagroci/contract/domain/rcnWeighing";
import { formatDate, todayIso } from "@anagroci/contract/domain/dateFormat";
import type { RcnReceipt } from "@anagroci/contract/types/rcnReceipt";
import { IconButton } from "../ui/IconButton";

type Run = NonNullable<RcnReceipt["calibration"]>["runs"][number];

/**
 * One load's sorting, in a dialog: where its kg came from in one sentence, the form, and what was already entered.
 * A load can take several runs over several days (the client's Calibration Process report sizes one over two days),
 * so saving a part of it is normal. Totals use the same contract function the server checks with.
 */
export function SortLoadDialog({ receipt, canEdit, onClose, onChanged }: { receipt: RcnReceipt; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  return (
    <Modal wide title={`Sort BTM ${receipt.btmNo} into the silos`} onClose={onClose}>
      <SortLoadPanel receipt={receipt} canEdit={canEdit} onChanged={onChanged} onSaved={onClose} />
    </Modal>
  );
}

/**
 * How much of one load went into each size silo: what is left to sort, the form for the next run, and the runs so far.
 * Open at any step: a load can be sorted before its final weight is saved, and is then simply not held to a total yet.
 */
export function SortLoadPanel({ receipt, canEdit, onChanged, onSaved }: { receipt: RcnReceipt; canEdit: boolean; onChanged: () => void; onSaved?: () => void }) {
  const cal = receipt.calibration ?? { toSilosKg: null, sizedKg: 0, leftKg: null, runs: [] };
  const t = weighingTotals(receipt.pallets, receipt.finalWeight ?? { emptyPallets: [] });

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[15px] font-bold text-warmstone-900 tabular-nums">
          {cal.leftKg === null ? `${formatKg(cal.sizedKg)} sorted so far` : cal.leftKg > 0 ? `${formatKg(cal.leftKg)} left to sort` : "All of this load is sorted."}
        </p>
        <p className="text-[12px] text-warmstone-500 mt-1 tabular-nums">
          {cal.toSilosKg === null
            ? "The total to sort is known once the final weight is saved. Until then nothing limits what you enter here."
            : <>Weighed: {formatKg(t.netKg)} net − {formatKg(t.dustKg)} dust ({pctOfNet(t.dustKg, t.netKg).toFixed(2)} %) − {formatKg(t.voidsKg)} voids ({pctOfNet(t.voidsKg, t.netKg).toFixed(3)} %) = {formatKg(cal.toSilosKg)} to sort.</>}
        </p>
      </div>
      {canEdit && <NewRun receiptId={receipt.id} leftKg={cal.leftKg} onSaved={() => { onChanged(); onSaved?.(); }} />}
      <RunList runs={cal.runs} removable={canEdit} onChanged={onChanged} />
    </div>
  );
}

function NewRun({ receiptId, leftKg, onSaved }: { receiptId: string; leftKg: number | null; onSaved: () => void }) {
  const [date, setDate] = useState(todayIso());
  const [sizes, setSizes] = useState<SizeValues>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = sizesTotal(sizes);
  const over = leftKg !== null && total > leftKg;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = calibrationRunError({ date, sizes }, leftKg);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      await api.addCalibrationRun(receiptId, { date, sizes });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="max-w-48">
        <Field label="Date"><DateInput value={date} onChange={setDate} className={inputClass} /></Field>
      </div>
      <fieldset>
        <legend className="block text-[13px] font-bold text-warmstone-900 mb-3">How many kg went into each silo?</legend>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {SILO_SIZES.map((s) => (
            <Field key={s.key} label={`Silo ${siloLabel(s.key)}`}>
              <Input numeric value={sizes[s.key] ?? ""} onChange={(e) => setSizes((p) => ({ ...p, [s.key]: e.target.value }))} />
            </Field>
          ))}
        </div>
        <p className="text-[12px] text-warmstone-500 mt-2">Leave a silo blank if nothing went into it.</p>
      </fieldset>
      <p className={`text-[13px] tabular-nums ${over ? "text-danger-700" : "text-warmstone-800"}`}>
        You entered <b>{formatKg(total)}</b>.{leftKg === null ? "" : over ? ` That is ${formatKg(total - leftKg)} too much.` : ` ${formatKg(leftKg - total)} will be left.`}
      </p>
      {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" icon="check" disabled={saving || over}>Save</Button>
      </div>
    </form>
  );
}

function RunList({ runs, removable, onChanged }: { runs: Run[]; removable: boolean; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  if (runs.length === 0) return null;

  async function remove(run: Run) {
    if (!window.confirm("Remove this entry? Its kg leave the silos.")) return;
    setError(null);
    try {
      await api.deleteCalibrationRun(run.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <div className="border-t border-warmstone-100 pt-4">
      <h3 className="text-[13px] font-bold text-warmstone-900 mb-2">Already entered</h3>
      <ul className="space-y-2">
        {runs.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 text-[13px] text-warmstone-800">
            <span className="min-w-0 tabular-nums">
              {formatDate(r.date)} · <b>{formatKg(r.totalKg)}</b>
              <span className="block text-[12px] text-warmstone-500">{SILO_SIZES.filter((s) => r.sizes[s.key]).map((s) => `${s.code}: ${r.sizes[s.key]} kg`).join(" · ")}</span>
            </span>
            {removable && (
              <IconButton icon="delete" label={`Remove the entry of ${formatDate(r.date)}`} onClick={() => remove(r)} />
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-[12px] text-danger-700 mt-2">{error}</p>}
    </div>
  );
}
