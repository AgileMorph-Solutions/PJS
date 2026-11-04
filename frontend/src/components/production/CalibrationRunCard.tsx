import { useState, type FormEvent } from "react";
import { formatKg, inputCls, primaryButton } from "./batchUi";
import { DateInput } from "../ui/DateInput";
import { api, ApiError } from "../../repository/api";
import { SILO_SIZES, calibrationRunError, sizesTotal, type SizeValues } from "@anagroci/contract/domain/calibration";
import { canCalibrate } from "@anagroci/contract/domain/rcnReceipt";
import { formatDate, todayIso } from "@anagroci/contract/domain/dateFormat";
import type { RcnReceipt } from "@anagroci/contract/types/rcnReceipt";

const cellInput = `${inputCls} font-mono py-1.5! px-2! text-right`;

/**
 * Phase 2, step 2 of a load: the kg that went into each of the 9 silos, as the silo stock report's size columns.
 * A load can take several runs (the client's Calibration Process report sizes one load over two days), until its
 * runs add up to the into-silo kg from Intake. Totals use the same contract function the server checks with.
 */
export function CalibrationRunCard({ receipt, canEdit, onChanged }: { receipt: RcnReceipt; canEdit: boolean; onChanged: () => void }) {
  const cal = receipt.calibration;
  if (!cal) return null;
  const open = canEdit && canCalibrate(receipt.status);

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-[13px] font-bold text-warmstone-900">Calibration · into the silos</h4>
        <p className="text-[12px] text-warmstone-500">The kg that went into each size silo. A load can be sized over several runs.</p>
      </div>
      <div className="grid grid-cols-3 gap-3 rounded-xl border border-warmstone-200 bg-white p-3 text-[12.5px]">
        {([["Into silos (from Intake)", cal.toSilosKg], ["Sized so far", cal.sizedKg], ["Still to calibrate", cal.leftKg]] as const).map(([label, kg]) => (
          <div key={label}>
            <span className="block text-[10.5px] uppercase tracking-wide text-warmstone-500 font-bold">{label}</span>
            <b className={`tabular-nums ${label === "Still to calibrate" && kg > 0 ? "text-brand-700" : "text-warmstone-900"}`}>{formatKg(kg)}</b>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-warmstone-200 bg-white">
        <table className="w-full text-[12px]">
          <thead className="bg-warmstone-50 text-[10.5px] uppercase tracking-wide text-warmstone-500">
            <tr>
              <th className="text-left font-bold px-3 py-2">Date</th>
              {SILO_SIZES.map((s) => (
                <th key={s.key} className="text-right font-bold px-2 py-2 whitespace-nowrap" title={s.mm}>{s.code}</th>
              ))}
              <th className="text-right font-bold px-3 py-2">Total</th>
              {open && <th />}
            </tr>
          </thead>
          <tbody>
            {cal.runs.map((r) => (
              <RunRow key={r.id} run={r} removable={open} onChanged={onChanged} />
            ))}
            {cal.runs.length === 0 && !open && (
              <tr><td colSpan={11} className="px-3 py-3 text-warmstone-500">Not sized yet.</td></tr>
            )}
          </tbody>
          {open && <NewRun receiptId={receipt.id} leftKg={cal.leftKg} onSaved={onChanged} />}
        </table>
      </div>
    </section>
  );
}

function RunRow({ run, removable, onChanged }: { run: NonNullable<RcnReceipt["calibration"]>["runs"][number]; removable: boolean; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    if (!window.confirm("Remove this run? Its kg leave the silos.")) return;
    try {
      await api.deleteCalibrationRun(run.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }
  return (
    <tr className="border-t border-warmstone-100" title={run.createdBy ? `Entered by ${run.createdBy}` : undefined}>
      <td className="px-3 py-2 whitespace-nowrap">
        {formatDate(run.date)}
        {error && <span className="block text-danger-700 text-[11px]">{error}</span>}
      </td>
      {SILO_SIZES.map((s) => (
        <td key={s.key} className="px-2 py-2 text-right font-mono tabular-nums">{run.sizes[s.key] ?? ""}</td>
      ))}
      <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{run.totalKg.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
      {removable && (
        <td className="px-2 py-2 text-right">
          <button type="button" onClick={remove} title="Remove this run" className="text-warmstone-400 hover:text-danger-700">
            <span className="material-symbols-outlined text-[17px]">delete</span>
          </button>
        </td>
      )}
    </tr>
  );
}

function NewRun({ receiptId, leftKg, onSaved }: { receiptId: string; leftKg: number; onSaved: () => void }) {
  const [date, setDate] = useState(todayIso());
  const [sizes, setSizes] = useState<SizeValues>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = sizesTotal(sizes);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = calibrationRunError({ date, sizes }, leftKg);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      await api.addCalibrationRun(receiptId, { date, sizes });
      setSizes({});
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <tfoot>
      <tr className="border-t-2 border-warmstone-200 bg-brand-50/30">
        <td className="px-2 py-2 min-w-[130px]"><DateInput value={date} onChange={setDate} className={`${inputCls} py-1.5!`} /></td>
        {SILO_SIZES.map((s) => (
          <td key={s.key} className="px-1 py-2 min-w-[78px]">
            <input
              inputMode="decimal"
              aria-label={`Size ${s.code} kg`}
              className={cellInput}
              value={sizes[s.key] ?? ""}
              onChange={(e) => setSizes((p) => ({ ...p, [s.key]: e.target.value }))}
            />
          </td>
        ))}
        <td className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${total > leftKg ? "text-danger-700" : ""}`}>{total.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
        <td className="px-2 py-2">
          <button type="button" onClick={submit} disabled={saving} className={`${primaryButton} px-3! py-1.5!`}>
            <span className="material-symbols-outlined text-[17px]">add</span>Add
          </button>
        </td>
      </tr>
      <tr>
        <td colSpan={12} className="px-3 pb-2 text-[11.5px]">
          {error ? <span role="alert" className="text-danger-700">{error}</span> : (
            <span className="text-warmstone-500">kg per size · {formatKg(Math.max(leftKg - total, 0))} of this load left after this run</span>
          )}
        </td>
      </tr>
    </tfoot>
  );
}
