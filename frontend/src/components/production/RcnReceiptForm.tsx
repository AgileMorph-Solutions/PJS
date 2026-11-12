import { useState, type FormEvent, type ReactNode } from "react";
import { DateInput } from "../ui/DateInput";
import { formatTonnes } from "./batchUi";
import { Button } from "../ui/Button";
import { inputClass } from "../ui/Input";
import { api, ApiError } from "../../repository/api";
import { sameBtmAndBin } from "@anagroci/contract/domain/rcnReceipt";
import { formatDate, todayIso } from "@anagroci/contract/domain/dateFormat";
import type { BatchDetail } from "@anagroci/contract/types/productionBatch";
import type { RcnReceipt } from "@anagroci/contract/types/rcnReceipt";

const field = (label: string, el: ReactNode, hint?: string) => (
  <label className="block">
    <span className="block text-[12px] font-semibold text-warmstone-700 mb-1.5">{label}</span>
    {el}
    {hint && <span className="block mt-1 text-[12px] text-warmstone-500">{hint}</span>}
  </label>
);

/**
 * Record one load arriving from a warehouse bin of this production run (Intake, step 1). The run is the page's own,
 * so only the slip is typed — no weights. `existing` is the run's receipts, for the same-BTM-same-bin warning.
 */
export function RcnReceiptForm({ run, existing, onSaved }: { run: BatchDetail; existing: RcnReceipt[]; onSaved: () => void }) {
  const [date, setDate] = useState(todayIso());
  const [btmNo, setBtmNo] = useState("");
  const [binCode, setBinCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const duplicates = btmNo.trim() && binCode ? sameBtmAndBin(existing, btmNo, binCode) : [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.createRcnReceipt({ batchCode: run.code, date, btmNo, binCode });
      setBtmNo("");
      setBinCode("");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        {field("Date", <DateInput value={date} onChange={setDate} className={inputClass} />)}
        {field("BTM number", <input className={`${inputClass} tabular-nums`} value={btmNo} onChange={(e) => setBtmNo(e.target.value)} placeholder="e.g. 112" />, "The number on the transfer slip (BTM) that came with the load.")}
      </div>

      <div>
        <span className="block text-[12px] font-semibold text-warmstone-700 mb-1.5">From which warehouse bin?</span>
        <div className="grid sm:grid-cols-2 gap-3">
          {run.bins.map((b) => {
            const on = binCode === b.binCode;
            return (
              <label key={b.binCode} className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer bg-white ${on ? "border-brand-700 bg-brand-50/60" : "border-warmstone-200 hover:bg-warmstone-50"}`}>
                <input type="radio" name="rcn-bin" checked={on} onChange={() => setBinCode(b.binCode)} />
                <span>
                  <span className="block font-semibold text-[13px]">{b.binCode}</span>
                  <span className="block text-[12px] text-warmstone-500">{formatTonnes(b.currentKg)} left</span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {duplicates.length > 0 && (
        <p className="rounded-xl border bg-ambernut-50 border-ambernut-200 text-ambernut-800 p-3 text-[12px]">
          <b>BTM {btmNo.trim()} from {binCode} is already recorded</b> ({duplicates.map((d) => `${d.id}, ${formatDate(d.date)}`).join("; ")}). Save only if this is really a second load.
        </p>
      )}
      {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}

      <div className="flex justify-end">
        <Button type="submit" icon="check" disabled={saving || !date || !btmNo.trim() || !binCode}>Save RCN receipt</Button>
      </div>
    </form>
  );
}
