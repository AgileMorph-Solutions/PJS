import { useState, type FormEvent } from "react";
import { formatKg } from "./batchUi";
import { ReviewBar } from "./MoistureCard";
import { StepCard } from "./StepCard";
import { Button } from "../ui/Button";
import { DateInput } from "../ui/DateInput";
import { Field, Input, Select, inputClass } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { Pill } from "../ui/Pill";
import { api, ApiError } from "../../repository/api";
import {
  CORRECT_SIZE_TARGET_PCT, DEFAULT_SIZING_SAMPLE_G, SILO_SIZES, SIZING_DECISION_LABELS, SIZING_GRADES, correctSizePct, isSamplingPoint, largestOtherGrade, manualCalibrationError,
  samplingPointLabel, siloLabel, silosWaiting, sizingCheckError, sizingGradeLabel, sizingGramsTotal, type SiloSize, type SizingDecision,
} from "@anagroci/contract/domain/calibration";
import { formatDate, formatDateTime, todayIso } from "@anagroci/contract/domain/dateFormat";
import type { BatchCalibration, ManualCalibrationInput, SizingCheck, SizingCheckInput } from "@anagroci/contract/types/calibration";
import type { BatchDetail } from "@anagroci/contract/types/productionBatch";

export interface CalibrationPermissions {
  /** Sort a load (the Incharge / Admin; Data Entry later). */
  canSize: boolean;
  /** Enter a silo check (the QFS Officer, or the Incharge / Admin directly). */
  canCheck: boolean;
  /** Approve / reject a submitted check, move nuts by hand, and enter directly. */
  canReview: boolean;
}

const pct = (n: number | null) => (n === null ? "-" : `${n.toFixed(1)} %`);

/** Silos with nuts that want a check, leaving out one whose check is already waiting for approval: it can't be sampled twice. */
export function silosToCheck(calibration: BatchCalibration): SiloSize[] {
  const sent = new Set(calibration.sizingChecks.filter((c) => c.status === "submitted").map((c) => c.point));
  return silosWaiting(calibration.silos, calibration.siloChecks).toCheck.filter((s) => !sent.has(s));
}

/** Step 2: QC-2. A sample from one silo, weighed by size, says whether the silo holds the right nuts. */
export function CheckSilosStep({ batch, calibration, can, active, done, status, onChanged }: { batch: BatchDetail; calibration: BatchCalibration; can: CalibrationPermissions; active: boolean; done: boolean; status: string; onChanged: () => void }) {
  // Which silo the form opens on: "" is the form with no silo chosen yet, null is no form.
  const [adding, setAdding] = useState<SiloSize | "" | null>(null);
  const checks = calibration.sizingChecks;
  const toCheck = silosToCheck(calibration);

  return (
    <StepCard n={2} title="Check the silos" status={status} active={active} done={done}>
      <p className="text-[13px] text-warmstone-800 mb-3">
        Take a {DEFAULT_SIZING_SAMPLE_G} g sample from a silo and weigh the nuts by size. At least {CORRECT_SIZE_TARGET_PCT} % should be the silo's own size.
      </p>
      {can.canCheck && (
        <div className="flex flex-wrap gap-2">
          {toCheck.map((s, i) => <Button key={s} variant={i === 0 ? "primary" : "secondary"} onClick={() => setAdding(s)}>Check silo {siloLabel(s)}</Button>)}
          <Button variant={toCheck.length === 0 ? "primary" : "secondary"} icon="add" onClick={() => setAdding("")}>{toCheck.length === 0 ? "Check a silo" : "Check another sample"}</Button>
        </div>
      )}
      {checks.length > 0 && (
        <ul className="mt-3 divide-y divide-warmstone-100 rounded-xl border border-warmstone-200">
          {checks.map((c) => <CheckRow key={c.id} check={c} batchCode={batch.code} canReview={can.canReview} onChanged={onChanged} />)}
        </ul>
      )}
      {adding !== null && (
        <Modal wide title="Check a silo" onClose={() => setAdding(null)}>
          <SizingForm batch={batch} calibration={calibration} point={adding} direct={can.canReview} onSaved={() => { setAdding(null); onChanged(); }} />
        </Modal>
      )}
    </StepCard>
  );
}

function SizingForm({ batch, calibration, point: startPoint, direct, onSaved }: { batch: BatchDetail; calibration: BatchCalibration; point: SiloSize | ""; direct: boolean; onSaved: () => void }) {
  const [v, setV] = useState<SizingCheckInput>({ batchCode: batch.code, date: todayIso(), point: startPoint, sampleG: DEFAULT_SIZING_SAMPLE_G, grams: {} });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof SizingCheckInput) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [key]: e.target.value }));

  const point = isSamplingPoint(v.point) ? v.point : null;
  const grams = v.grams ?? {};
  const correct = point ? correctSizePct(point, v.sampleG, grams) : null;
  const low = correct !== null && correct < CORRECT_SIZE_TARGET_PCT;
  const total = sizingGramsTotal(grams);

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

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Which silo did the sample come from?">
          <Select value={v.point ?? ""} onChange={set("point")}>
            <option value="">Choose a silo…</option>
            {/* Only silos holding nuts: an empty one can't be sampled. */}
            {calibration.silos.filter((s) => s.stockKg > 0).map((s) => <option key={s.size} value={s.size}>{samplingPointLabel(s.size)} · {formatKg(s.stockKg)}</option>)}
            <option value="received">{samplingPointLabel("received")}</option>
          </Select>
        </Field>
        <Field label="Date"><DateInput value={v.date ?? ""} onChange={(d) => setV((p) => ({ ...p, date: d }))} className={inputClass} /></Field>
        <Field label="Sample weight (g)"><Input numeric value={v.sampleG ?? ""} onChange={set("sampleG")} /></Field>
        <Field label="Nut count per kg (optional)"><Input numeric value={v.nutCount ?? ""} onChange={set("nutCount")} /></Field>
        <Field label="Bin the nuts came from (optional)">
          <Select value={v.binCode ?? ""} onChange={set("binCode")}>
            <option value="">-</option>
            {batch.bins.map((b) => <option key={b.binCode} value={b.binCode}>{b.binCode}</option>)}
          </Select>
        </Field>
      </div>

      <fieldset>
        <legend className="block text-[13px] font-bold text-warmstone-900 mb-3">How many grams of each size did you find?</legend>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {SIZING_GRADES.map((g) => (
            <Field key={g} label={<span className={g === point ? "text-brand-700 font-bold" : ""}>{sizingGradeLabel(g)}{g === point ? " · this silo" : ""}</span>}>
              <Input numeric value={grams[g] ?? ""} onChange={(e) => setV((p) => ({ ...p, grams: { ...p.grams, [g]: e.target.value } }))} />
            </Field>
          ))}
        </div>
        <p className="text-[12px] text-warmstone-500 mt-2 tabular-nums">
          Total {total.toLocaleString("en-US")} g of {v.sampleG || 0} g.{total > 0 && String(total) !== (v.sampleG ?? "").trim() ? " The total should match the sample weight." : ""}
        </p>
      </fieldset>

      <p className={`text-[15px] font-bold tabular-nums ${low ? "text-danger-700" : "text-warmstone-900"}`}>
        Correct size: {pct(correct)} <span className="text-[12px] font-normal text-warmstone-500">· at least {CORRECT_SIZE_TARGET_PCT} % expected</span>
      </p>

      <div>
        <span className="block text-[13px] font-bold text-warmstone-900 mb-3">What is your decision?</span>
        <div className="grid sm:grid-cols-2 gap-3">
          {(["ok", "fail"] as SizingDecision[]).map((d) => {
            const on = v.decision === d;
            return (
              <label key={d} className={`flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer ${on ? (d === "ok" ? "border-success-600 bg-success-50" : "border-danger-600 bg-danger-50") : "border-warmstone-200 bg-white hover:bg-warmstone-50"}`}>
                <input type="radio" name="sizing-decision" className="mt-0.5" checked={on} onChange={() => setV((p) => ({ ...p, decision: d }))} />
                <span>
                  <span className="block font-semibold text-[13px] text-warmstone-900">{d === "ok" ? "OK" : "Fail"}</span>
                  <span className="block text-[12px] text-warmstone-500">{d === "ok" ? "The silo holds the right size." : "The nuts must be moved to the right silo."}</span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
      <div className="flex items-center justify-end gap-3 flex-wrap">
        {!direct && <span className="text-[12px] text-warmstone-500">The Warehouse Incharge will approve it.</span>}
        <Button type="submit" icon={direct ? "check" : "send"} disabled={saving}>{direct ? "Save" : "Send for approval"}</Button>
      </div>
    </form>
  );
}

function CheckRow({ check, batchCode, canReview, onChanged }: { check: SizingCheck; batchCode: string; canReview: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const waiting = check.status === "submitted";

  return (
    <li className="px-4 py-3">
      <button type="button" aria-expanded={open || waiting} className="w-full flex flex-wrap items-center gap-x-3 gap-y-1.5 text-left text-[13px] text-warmstone-800" onClick={() => setOpen(!open)}>
        <span className="font-semibold text-warmstone-900">{samplingPointLabel(check.point)}</span>
        <span className="text-warmstone-500">{formatDate(check.date)}</span>
        {check.batchCode !== batchCode && <Pill tone="system" label={`Batch ${check.batchCode}`} />}
        <span className="tabular-nums">{pct(check.correctPct)} correct</span>
        <Pill tone={check.decision === "ok" ? "entry" : "gap"} label={check.decision === "ok" ? "OK" : "Fail"} />
        {waiting && <Pill tone="decision" label="Waiting for approval" />}
        {check.status === "rejected" && <Pill tone="gap" label="Rejected" />}
        <span className="material-symbols-outlined text-[18px] text-warmstone-400 ml-auto">{open || waiting ? "expand_less" : "expand_more"}</span>
      </button>

      {(open || waiting) && (
        <div className="mt-3 space-y-3">
          <p className="text-[12px] text-warmstone-500 tabular-nums">
            {SIZING_GRADES.filter((g) => check.grams[g] !== undefined).map((g) => `${sizingGradeLabel(g)}: ${check.grams[g]} g`).join(" · ")}
          </p>
          <p className="text-[12px] text-warmstone-500">
            Sample {check.sampleG} g{check.nutCount ? ` · nut count ${check.nutCount}` : ""} · by {check.submittedBy}, {formatDateTime(check.submittedAt)}
            {check.rejectReason && <span className="text-danger-700"> · rejected: {check.rejectReason}</span>}
          </p>
          {check.notes.map((n) => (
            <p key={n} className="flex items-center gap-1.5 text-[12px] text-ambernut-800">
              <span className="material-symbols-outlined text-[16px]">warning</span>{n}
            </p>
          ))}
          {waiting && (canReview ? (
            <ReviewBar
              applies={check.decision === "ok" ? "the silo is marked OK." : `the silo is marked ${SIZING_DECISION_LABELS.fail.toLowerCase()}.`}
              onApprove={() => api.approveSizingCheck(check.id)}
              onReject={(reason) => api.rejectSizingCheck(check.id, reason)}
              onDone={onChanged}
            />
          ) : (
            <p className="text-[12px] text-ambernut-800">Sent. Waiting for the Warehouse Incharge to approve.</p>
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * The failed checks still to act on, one per silo: the check a silo holding nuts stands on now. A silo that has
 * since passed, or has since been emptied, needs nothing more; its moves stay in History.
 */
export function checksToFix(calibration: BatchCalibration): SizingCheck[] {
  const { failed, moved } = silosWaiting(calibration.silos, calibration.siloChecks);
  return [...failed, ...moved].flatMap((size) => calibration.sizingChecks.filter((c) => c.id === calibration.siloChecks[size].checkId));
}

/** Step 3: only for a silo whose failed check was approved. The nuts leave that silo and go to the one they belong in. */
export function FixSiloStep({ calibration, can, active, onChanged }: { calibration: BatchCalibration; can: CalibrationPermissions; active: boolean; onChanged: () => void }) {
  const failed = checksToFix(calibration);
  const stockOf = (size: SiloSize) => calibration.silos.find((s) => s.size === size)!.stockKg;
  const stillToMove = failed.filter((c) => c.manualCalibrations.length === 0).length;
  const status = stillToMove > 0 ? `${stillToMove} silo${stillToMove === 1 ? "" : "s"} failed` : failed.length > 0 ? "Nuts moved. Check the silo again in step 2." : "Nothing to fix";

  return (
    <StepCard n={3} title="Fix a failed silo" status={status} active={active} done={false}>
      {failed.length === 0 ? (
        <p className="text-[13px] text-warmstone-800">No silo has failed. If a check fails, you will move the nuts here.</p>
      ) : (
        <ul className="space-y-3">
          {failed.map((c) => {
            const from = c.point as SiloSize;
            const likely = largestOtherGrade(from, c.grams);
            return (
              <li key={c.id} className="rounded-xl border border-warmstone-200 p-4 space-y-3">
                <p className="text-[13px] font-bold text-warmstone-900">Silo {siloLabel(from)} failed <span className="font-normal text-warmstone-500">· {pct(c.correctPct)} correct on {formatDate(c.date)}</span></p>
                {likely && <p className="text-[12px] text-warmstone-500">Most of the rest of the sample was size {siloLabel(likely)}.</p>}
                {c.manualCalibrations.map((m) => (
                  <p key={m.id} className="text-[13px] text-warmstone-800 tabular-nums">Moved {formatKg(Number(m.kg))} to silo {siloLabel(m.toSize)} on {formatDate(m.date)}. Check this silo again.</p>
                ))}
                {can.canReview
                  ? <MoveForm checkId={c.id} fromSize={from} stockKg={stockOf(from)} onSaved={onChanged} />
                  : <p className="text-[12px] text-warmstone-500">The Warehouse Incharge moves the nuts. You will be asked to check the silo again after that.</p>}
              </li>
            );
          })}
        </ul>
      )}
    </StepCard>
  );
}

function MoveForm({ checkId, fromSize, stockKg, onSaved }: { checkId: number; fromSize: SiloSize; stockKg: number; onSaved: () => void }) {
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
    <form onSubmit={submit} className="space-y-3">
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Move the nuts to which silo?">
          <Select value={v.toSize ?? ""} onChange={(e) => setV((p) => ({ ...p, toSize: e.target.value }))}>
            <option value="">Choose a silo…</option>
            {SILO_SIZES.filter((s) => s.key !== fromSize).map((s) => <option key={s.key} value={s.key}>{siloLabel(s.key)}</option>)}
          </Select>
        </Field>
        <Field label="How many kg?" hint={`This silo holds ${formatKg(stockKg)}.`}><Input numeric value={v.kg ?? ""} onChange={(e) => setV((p) => ({ ...p, kg: e.target.value }))} /></Field>
        <Field label="Date"><DateInput value={v.date ?? ""} onChange={(d) => setV((p) => ({ ...p, date: d }))} className={inputClass} /></Field>
      </div>
      {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" icon="swap_horiz" disabled={saving}>Move the nuts</Button>
      </div>
    </form>
  );
}
