import { useState, type FormEvent } from "react";
import { formatKg, inputCls, primaryButton, secondaryButton } from "./batchUi";
import { ReviewBar } from "./MoistureCard";
import { DateInput } from "../ui/DateInput";
import { Pill } from "../ui/Pill";
import { api, ApiError } from "../../repository/api";
import {
  CORRECT_SIZE_TARGET_PCT, DEFAULT_SIZING_SAMPLE_G, SILO_SIZES, SIZING_DECISION_LABELS, SIZING_GRADES, manualCalibrationError,
  samplingPointLabel, siloLabel, sizingCheckError, sizingCheckNotes, sizingGradeLabel, sizingGramsTotal, correctSizePct,
  isSamplingPoint, type SiloSize, type SizingDecision,
} from "@anagroci/contract/domain/calibration";
import { formatDate, formatDateTime, todayIso } from "@anagroci/contract/domain/dateFormat";
import type { BatchCalibration, ManualCalibrationInput, SizingCheck, SizingCheckInput } from "@anagroci/contract/types/calibration";
import type { BatchDetail } from "@anagroci/contract/types/productionBatch";

export interface CalibrationPermissions {
  /** Enter a QC-2 check (the QFS Officer, or the Incharge / Admin directly). */
  canCheck: boolean;
  /** Approve / reject a submitted check, re-size by hand, and enter directly. */
  canReview: boolean;
}

const pct = (n: number | null) => (n === null ? "-" : `${n.toFixed(1)} %`);

/**
 * Phase 2 for the whole batch: the silos (step 5), the QFS Officer's QC-2 sizing checks (step 3) and the hand
 * re-sizing a failed check calls for (step 4). Each load's own sizing (step 2) is on its RCN Receipt.
 */
export function CalibrationSection({ batch, calibration, can, onChanged }: {
  batch: BatchDetail;
  calibration: BatchCalibration;
  can: CalibrationPermissions;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const stockOf = (size: SiloSize) => calibration.silos.find((s) => s.size === size)!.stockKg;

  return (
    <div className="max-w-5xl space-y-5">
      <SiloTable calibration={calibration} />

      <section className="bg-white border border-warmstone-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-[15px] font-bold text-warmstone-900">Sizing checks · QC-2 ({calibration.sizingChecks.length})</h3>
            <p className="text-[12px] text-warmstone-500 mt-0.5">
              A {DEFAULT_SIZING_SAMPLE_G} g sample from a silo, sorted by size. Target: {CORRECT_SIZE_TARGET_PCT} % of it the silo's own size. A failed silo is re-sized by hand.
            </p>
          </div>
          {can.canCheck && !adding && (
            <button type="button" className={primaryButton} onClick={() => setAdding(true)}>
              <span className="material-symbols-outlined text-[18px]">add</span>New sizing check
            </button>
          )}
        </div>

        {can.canCheck && adding && (
          <div className="mx-5 mb-5 rounded-2xl border border-warmstone-200 bg-warmstone-50/60 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h4 className="text-[13.5px] font-bold text-warmstone-900">New sizing check</h4>
              <button type="button" className={secondaryButton} onClick={() => setAdding(false)}>Cancel</button>
            </div>
            <SizingForm batch={batch} direct={can.canReview} onSaved={() => { setAdding(false); onChanged(); }} />
          </div>
        )}

        {calibration.sizingChecks.length === 0 ? (
          !adding && <p className="px-5 pb-5 text-[12.5px] text-warmstone-500">No sizing checks yet.</p>
        ) : (
          <ul className="divide-y divide-warmstone-100 border-t border-warmstone-100">
            {calibration.sizingChecks.map((c) => (
              <CheckRow key={c.id} check={c} can={can} stockOf={stockOf} onChanged={onChanged} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SiloTable({ calibration }: { calibration: BatchCalibration }) {
  const total = calibration.silos.reduce((n, s) => n + s.stockKg, 0);
  return (
    <section className="bg-white border border-warmstone-200 rounded-2xl shadow-xs overflow-hidden">
      <div className="px-5 pt-5 pb-3 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-[15px] font-bold text-warmstone-900">Calibrated silos</h3>
          <p className="text-[12px] text-warmstone-500 mt-0.5">The factory's 9 size silos: they hold every batch's sized nuts. Stock = sized in ± re-sized by hand − cooked.</p>
        </div>
        <span className="text-[13px] text-warmstone-700">In silos now: <b className="tabular-nums">{formatKg(total)}</b></span>
      </div>
      <table className="w-full text-[12.5px]">
        <thead className="bg-warmstone-50 text-[10.5px] uppercase tracking-wide text-warmstone-500">
          <tr>
            <th className="text-left font-bold px-5 py-2">Silo</th>
            <th className="text-right font-bold px-3 py-2">From this batch</th>
            <th className="text-right font-bold px-3 py-2">All sized in</th>
            <th className="text-right font-bold px-3 py-2">Re-sized ±</th>
            <th className="text-right font-bold px-3 py-2">Cooked</th>
            <th className="text-right font-bold px-5 py-2">Stock</th>
          </tr>
        </thead>
        <tbody>
          {calibration.silos.map((s) => {
            const moved = s.manualInKg - s.manualOutKg;
            return (
              <tr key={s.size} className="border-t border-warmstone-100">
                <td className="px-5 py-2 font-semibold">{siloLabel(s.size)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatKg(calibration.batchSizedKg[s.size] ?? 0)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatKg(s.sizedInKg)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{moved === 0 ? "-" : `${moved > 0 ? "+" : "−"}${formatKg(Math.abs(moved))}`}</td>
                <td className="px-3 py-2 text-right tabular-nums text-warmstone-400" title="Cooking (Phase 3) takes nuts out of the silos; not built yet">{formatKg(s.cookedKg)}</td>
                <td className="px-5 py-2 text-right tabular-nums font-bold">{formatKg(s.stockKg)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function SizingForm({ batch, direct, onSaved }: { batch: BatchDetail; direct: boolean; onSaved: () => void }) {
  const [v, setV] = useState<SizingCheckInput>({ batchCode: batch.code, date: todayIso(), sampleG: DEFAULT_SIZING_SAMPLE_G, grams: {} });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof SizingCheckInput) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [key]: e.target.value }));
  const setGram = (g: string, value: string) => setV((p) => ({ ...p, grams: { ...p.grams, [g]: value } }));

  const point = isSamplingPoint(v.point) ? v.point : null;
  const correct = point ? correctSizePct(point, v.sampleG, v.grams ?? {}) : null;
  const notes = sizingCheckNotes(v);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = sizingCheckError(v);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      await api.submitSizingCheck(v);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSaving(false);
    }
  }

  const label = (text: string, el: React.ReactNode) => (
    <label className="block">
      <span className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">{text}</span>
      {el}
    </label>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {label("Date", <DateInput value={v.date ?? ""} onChange={(d) => setV((p) => ({ ...p, date: d }))} className={inputCls} />)}
        {label("Sampled from", (
          <select className={inputCls} value={v.point ?? ""} onChange={set("point")}>
            <option value="">Choose…</option>
            {SILO_SIZES.map((s) => <option key={s.key} value={s.key}>{samplingPointLabel(s.key)}</option>)}
            <option value="received">{samplingPointLabel("received")}</option>
          </select>
        ))}
        {label("Bin (optional)", (
          <select className={inputCls} value={v.binCode ?? ""} onChange={set("binCode")}>
            <option value="">-</option>
            {batch.bins.map((b) => <option key={b.binCode} value={b.binCode}>{b.binCode}</option>)}
          </select>
        ))}
        {label("Nut count per kg", <input inputMode="decimal" className={`${inputCls} font-mono`} value={v.nutCount ?? ""} onChange={set("nutCount")} placeholder="e.g. 143" />)}
        {label("Sample (g)", <input inputMode="decimal" className={`${inputCls} font-mono`} value={v.sampleG ?? ""} onChange={set("sampleG")} />)}
      </div>

      <fieldset className="rounded-xl border border-warmstone-200 bg-white p-4">
        <legend className="px-1 text-[12.5px] font-semibold text-warmstone-700">Grams found in each size</legend>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {SIZING_GRADES.map((g) => (
            <label key={g} className="block">
              <span className={`block text-[11.5px] mb-1 ${g === point ? "text-brand-700 font-bold" : "text-warmstone-600"}`}>{sizingGradeLabel(g)}</span>
              <input inputMode="decimal" className={`${inputCls} font-mono`} value={v.grams?.[g] ?? ""} onChange={(e) => setGram(g, e.target.value)} />
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
          <span className="text-warmstone-500">Parts add up to {sizingGramsTotal(v.grams ?? {}).toLocaleString("en-US")} g{v.sampleG ? ` of ${v.sampleG} g` : ""}</span>
          <span className={`rounded-lg border px-3 py-1.5 ${correct !== null && correct < CORRECT_SIZE_TARGET_PCT ? "bg-danger-50 border-danger-200 text-danger-800" : "bg-brand-50 border-brand-200 text-brand-800"}`}>
            Correct size <b className="font-mono">{pct(correct)}</b> <span className="text-warmstone-500">· target {CORRECT_SIZE_TARGET_PCT} %</span>
          </span>
        </div>
        {notes.length > 0 && (
          <ul className="mt-2 text-[12px] text-ambernut-800 list-disc pl-5">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
        )}
      </fieldset>

      <div>
        <span className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">Decision</span>
        <div className="grid sm:grid-cols-2 gap-3">
          {(["ok", "fail"] as SizingDecision[]).map((d) => {
            const on = v.decision === d;
            return (
              <label key={d} className={`flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer bg-white ${on ? (d === "ok" ? "border-success-600 bg-success-50" : "border-danger-600 bg-danger-50") : "border-warmstone-200 hover:bg-warmstone-50"}`}>
                <input type="radio" name="sizing-decision" className="mt-0.5" checked={on} onChange={() => setV((p) => ({ ...p, decision: d }))} />
                <span>
                  <span className="block font-semibold text-[13px]">{SIZING_DECISION_LABELS[d]}</span>
                  <span className="block text-[11.5px] text-warmstone-500">{d === "ok" ? "The silo holds the right size." : "The silo is flagged; nuts are moved to the right silo by hand."}</span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {error && <p role="alert" className="text-[12.5px] text-danger-700">{error}</p>}
      <div className="flex items-center justify-end gap-3">
        <span className="text-[11.5px] text-warmstone-500">{direct ? "Your entry applies at once." : "The Warehouse Incharge approves it."}</span>
        <button type="submit" disabled={saving} className={primaryButton}>
          <span className="material-symbols-outlined text-[18px]">{direct ? "check" : "send"}</span>
          {direct ? "Save check" : "Submit for approval"}
        </button>
      </div>
    </form>
  );
}

function CheckRow({ check, can, stockOf, onChanged }: { check: SizingCheck; can: CalibrationPermissions; stockOf: (s: SiloSize) => number; onChanged: () => void }) {
  const [open, setOpen] = useState(check.status === "submitted" || (check.decision === "fail" && check.status === "approved" && check.manualCalibrations.length === 0));
  const failedSilo = check.decision === "fail" && check.status === "approved" && check.point !== "received" ? check.point : null;

  return (
    <li className="px-5 py-3">
      <button type="button" className="w-full flex flex-wrap items-center gap-2 text-left" onClick={() => setOpen(!open)}>
        <span className="text-[12.5px] text-warmstone-500 w-24">{formatDate(check.date)}</span>
        <span className="text-[13px] font-semibold text-warmstone-900">{samplingPointLabel(check.point)}</span>
        {check.binCode && <span className="font-mono text-[12px] text-warmstone-500">{check.binCode}</span>}
        <span className="text-[12.5px] text-warmstone-700">correct size <b className="font-mono">{pct(check.correctPct)}</b></span>
        <Pill tone={check.decision === "ok" ? "entry" : "gap"} label={SIZING_DECISION_LABELS[check.decision]} />
        <Pill tone={check.status === "approved" ? "term" : check.status === "rejected" ? "gap" : "decision"} label={check.status === "approved" ? "Approved" : check.status === "rejected" ? "Rejected" : "Waiting for approval"} />
        <span className="material-symbols-outlined text-[16px] text-warmstone-400 ml-auto">{open ? "expand_less" : "expand_more"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="rounded-xl border border-warmstone-200 bg-white p-3">
            <dl className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-1 text-[12px]">
              {SIZING_GRADES.filter((g) => check.grams[g] !== undefined).map((g) => (
                <div key={g} className="flex justify-between gap-2">
                  <dt className={g === check.point ? "text-brand-700 font-bold" : "text-warmstone-500"}>{sizingGradeLabel(g)}</dt>
                  <dd className="font-mono">{check.grams[g]} g</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[11.5px] text-warmstone-500">
              Sample {check.sampleG} g{check.nutCount ? ` · nut count ${check.nutCount}` : ""} · by {check.submittedBy}, {formatDateTime(check.submittedAt)}
              {check.reviewedBy && check.reviewedBy !== check.submittedBy && ` · ${check.status} by ${check.reviewedBy}`}
              {check.rejectReason && <span className="text-danger-700">: {check.rejectReason}</span>}
            </p>
            {check.notes.length > 0 && <ul className="mt-1 text-[11.5px] text-ambernut-800 list-disc pl-5">{check.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          </div>

          {check.status === "submitted" && (can.canReview ? (
            <ReviewBar
              applies={check.decision === "ok" ? "the silo is marked correctly sized." : "the silo is flagged for re-sizing by hand."}
              onApprove={() => api.approveSizingCheck(check.id)}
              onReject={(reason) => api.rejectSizingCheck(check.id, reason)}
              onDone={onChanged}
            />
          ) : (
            <p className="rounded-xl border border-ambernut-200 bg-ambernut-50 text-ambernut-900 px-4 py-3 text-[12.5px]">Submitted. Waiting for the Warehouse Incharge to approve.</p>
          ))}

          {failedSilo && (
            <div className="rounded-xl border border-danger-200 bg-danger-50/50 p-3 space-y-2">
              <h5 className="text-[12.5px] font-bold text-warmstone-900">Re-sized by hand · out of silo {siloLabel(failedSilo)}</h5>
              {check.manualCalibrations.length > 0 && (
                <ul className="text-[12.5px] text-warmstone-800 space-y-0.5">
                  {check.manualCalibrations.map((m) => (
                    <li key={m.id}>{formatDate(m.date)} · {formatKg(Number(m.kg))} to silo {siloLabel(m.toSize)} · {m.createdBy}</li>
                  ))}
                </ul>
              )}
              {can.canReview && <ManualForm checkId={check.id} fromSize={failedSilo} stockKg={stockOf(failedSilo)} onSaved={onChanged} />}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function ManualForm({ checkId, fromSize, stockKg, onSaved }: { checkId: number; fromSize: SiloSize; stockKg: number; onSaved: () => void }) {
  const [v, setV] = useState<ManualCalibrationInput>({ date: todayIso(), fromSize });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = manualCalibrationError(v, stockKg);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      await api.addManualCalibration(checkId, v);
      setV({ date: v.date, fromSize });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <label className="block">
        <span className="block text-[11.5px] text-warmstone-600 mb-1">Date</span>
        <DateInput value={v.date ?? ""} onChange={(d) => setV((p) => ({ ...p, date: d }))} className={`${inputCls} py-1.5!`} />
      </label>
      <label className="block">
        <span className="block text-[11.5px] text-warmstone-600 mb-1">Into silo</span>
        <select className={`${inputCls} py-1.5!`} value={v.toSize ?? ""} onChange={(e) => setV((p) => ({ ...p, toSize: e.target.value }))}>
          <option value="">Choose…</option>
          {SILO_SIZES.filter((s) => s.key !== fromSize).map((s) => <option key={s.key} value={s.key}>{siloLabel(s.key)}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="block text-[11.5px] text-warmstone-600 mb-1">Kg moved</span>
        <input inputMode="decimal" className={`${inputCls} py-1.5! font-mono w-28`} value={v.kg ?? ""} onChange={(e) => setV((p) => ({ ...p, kg: e.target.value }))} />
      </label>
      <button type="submit" disabled={saving} className={`${primaryButton} py-1.5!`}>
        <span className="material-symbols-outlined text-[17px]">swap_horiz</span>Move
      </button>
      <span className="text-[11.5px] text-warmstone-500 pb-2">Silo holds {formatKg(stockKg)}</span>
      {error && <p role="alert" className="w-full text-[12px] text-danger-700">{error}</p>}
    </form>
  );
}
