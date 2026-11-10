import { useState, type FormEvent } from "react";
import { Button } from "../ui/Button";
import { inputClass } from "../ui/Input";
import { Pill } from "../ui/Pill";
import { api, ApiError } from "../../repository/api";
import {
  CUT_TEST_GRAMS, DEFAULT_SAMPLE_G, MOISTURE_DECISION_LABELS, canTakeMoistureCheck, moistureCheckError, moistureKor,
  type MoistureDecision,
} from "@anagroci/contract/domain/rcnReceipt";
import { formatDateTime } from "@anagroci/contract/domain/dateFormat";
import type { MoistureCheck, MoistureCheckInput, RcnReceipt } from "@anagroci/contract/types/rcnReceipt";

const formatKor = (kor: number | null) => (kor === null ? "-" : kor.toFixed(2));

/**
 * Step 2 of a load: "is this load dry enough?" The QFS Officer's check waits for the Incharge; an
 * Incharge's or Admin's own applies at once (the server decides, by role; `direct` only words the button).
 */
export function MoistureCard({ receipt, canEnter, canReview, direct, onChanged }: {
  receipt: RcnReceipt;
  canEnter: boolean;
  canReview: boolean;
  direct: boolean;
  onChanged: () => void;
}) {
  const checks = receipt.moistureChecks;
  const pending = checks.find((c) => c.status === "submitted");
  const current = pending ?? checks.filter((c) => c.status === "approved").at(-1);
  const earlier = checks.filter((c) => c !== current).reverse();

  return (
    <div className="space-y-4">
      {receipt.status === "on_hold" && current && (
        <p className="rounded-xl border border-danger-200 bg-danger-50 text-danger-800 px-4 py-3 text-[12px]">
          <b>On hold:</b> moisture was {current.moisture} %. Weighing stays locked; take a new sample once the load has dried.
        </p>
      )}

      {canTakeMoistureCheck(receipt.status) ? (
        canEnter ? <MoistureForm receiptId={receipt.id} direct={direct} onSaved={onChanged} /> : <p className="text-[13px] text-warmstone-500">Waiting for the QFS Officer's check.</p>
      ) : current ? (
        <CheckDetails check={current} />
      ) : null}

      {pending && (canReview ? (
        <ReviewBar
          applies={pending.decision === "ok" ? "the load moves to Waiting for weighing." : "the load goes On hold."}
          onApprove={() => api.approveMoistureCheck(pending.id)}
          onReject={(reason) => api.rejectMoistureCheck(pending.id, reason)}
          onDone={onChanged}
        />
      ) : (
        <p className="rounded-xl border border-ambernut-200 bg-ambernut-50 text-ambernut-900 px-4 py-3 text-[12px]">Submitted. Waiting for the Warehouse Incharge to approve.</p>
      ))}

      {earlier.length > 0 && (
        <div>
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-warmstone-500 mb-1.5">Earlier checks</h4>
          <ul className="space-y-1 text-[12px] text-warmstone-700">
            {earlier.map((c) => (
              <li key={c.id}>
                {formatDateTime(c.submittedAt)} · moisture {c.moisture} %, {MOISTURE_DECISION_LABELS[c.decision]} · {c.submittedBy}
                {c.status === "rejected" && <span className="text-danger-700"> · rejected by {c.reviewedBy}: {c.rejectReason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MoistureForm({ receiptId, direct, onSaved }: { receiptId: string; direct: boolean; onSaved: () => void }) {
  const [v, setV] = useState<MoistureCheckInput>({ sampleG: DEFAULT_SAMPLE_G });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof MoistureCheckInput) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [key]: e.target.value }));

  const kor = moistureKor(v);
  const gramsTotal = CUT_TEST_GRAMS.reduce((n, [key]) => n + (Number(v[key]) || 0), 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = moistureCheckError(v);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      await api.submitMoistureCheck(receiptId, v);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSaving(false);
    }
  }

  const numberInput = (key: keyof MoistureCheckInput, placeholder?: string) => (
    <input inputMode="decimal" className={`${inputClass} tabular-nums`} value={v[key] ?? ""} onChange={set(key)} placeholder={placeholder} />
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="block text-[12px] font-semibold text-warmstone-700 mb-1.5">Moisture %</span>
          {numberInput("moisture", "e.g. 8.3")}
          <span className="block mt-1 text-[12px] text-warmstone-500">Between 0 and 20.</span>
        </label>
        <label className="block">
          <span className="block text-[12px] font-semibold text-warmstone-700 mb-1.5">Nut count</span>
          {numberInput("nutCount", "e.g. 173")}
        </label>
      </div>

      <fieldset className="rounded-xl border border-warmstone-200 bg-white p-4">
        <legend className="px-1 text-[12px] font-semibold text-warmstone-700">Cut test, grams (optional)</legend>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="block text-[12px] text-warmstone-600 mb-1">Sample weight</span>
            {numberInput("sampleG")}
          </label>
          {CUT_TEST_GRAMS.map(([key, label]) => (
            <label key={key} className="block">
              <span className="block text-[12px] text-warmstone-600 mb-1">{label}</span>
              {numberInput(key)}
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px]">
          <span className="text-warmstone-500">Parts add up to {gramsTotal.toLocaleString("en-US")} g{v.sampleG ? ` of ${v.sampleG} g` : ""}</span>
          <span className="rounded-lg bg-brand-50 border border-brand-200 px-3 py-1.5 text-brand-800">
            KOR <b className="tabular-nums">{formatKor(kor)}</b> lbs
            {kor === null && <span className="text-warmstone-500"> · needs good kernel, spotted and immature</span>}
          </span>
        </div>
      </fieldset>

      <div>
        <span className="block text-[12px] font-semibold text-warmstone-700 mb-1.5">Decision</span>
        <div className="grid sm:grid-cols-2 gap-3">
          {(["ok", "hold"] as MoistureDecision[]).map((d) => {
            const on = v.decision === d;
            return (
              <label key={d} className={`flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer bg-white ${on ? (d === "ok" ? "border-success-600 bg-success-50" : "border-danger-600 bg-danger-50") : "border-warmstone-200 hover:bg-warmstone-50"}`}>
                <input type="radio" name="decision" className="mt-0.5" checked={on} onChange={() => setV((p) => ({ ...p, decision: d }))} />
                <span>
                  <span className="block font-semibold text-[13px]">{MOISTURE_DECISION_LABELS[d]}</span>
                  <span className="block text-[12px] text-warmstone-500">{d === "ok" ? "Dry enough: the load goes on to weighing." : "Too wet: the load is put on hold and re-checked later."}</span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
      <div className="flex items-center justify-end gap-3">
        <span className="text-[12px] text-warmstone-500">{direct ? "Saved at once, no approval needed." : "The Warehouse Incharge must approve it before it counts."}</span>
        <Button type="submit" icon={direct ? "check" : "send"} disabled={saving}>{direct ? "Save moisture check" : "Send for approval"}</Button>
      </div>
    </form>
  );
}

function CheckDetails({ check }: { check: MoistureCheck }) {
  const row = (label: string, value: string) => (
    <div className="flex justify-between gap-3 py-1 border-b border-warmstone-100 last:border-0">
      <dt className="text-warmstone-500">{label}</dt>
      <dd className="font-mono font-semibold text-warmstone-900">{value}</dd>
    </div>
  );
  return (
    <div className="rounded-xl border border-warmstone-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={check.decision === "ok" ? "entry" : "gap"} label={MOISTURE_DECISION_LABELS[check.decision]} />
        <Pill tone={check.status === "approved" ? "term" : "decision"} label={check.status === "approved" ? "Approved" : "Waiting for approval"} />
        <span className="text-[12px] text-warmstone-500">
          by {check.submittedBy}, {formatDateTime(check.submittedAt)}
          {check.status === "approved" && check.reviewedBy && check.reviewedBy !== check.submittedBy && ` · approved by ${check.reviewedBy}`}
        </span>
      </div>
      <dl className="grid sm:grid-cols-2 gap-x-6 text-[12px]">
        {row("Moisture", `${check.moisture} %`)}
        {row("Nut count", check.nutCount)}
        {row("KOR (lbs)", formatKor(check.kor))}
        {check.sampleG && row("Sample", `${check.sampleG} g`)}
        {CUT_TEST_GRAMS.filter(([key]) => check.grams[key] !== undefined).map(([key, label]) => row(label, `${check.grams[key]} g`))}
      </dl>
    </div>
  );
}

/** The Incharge's approve / reject of a submitted check; shared by the moisture check and QC-2 (SizingSection). */
export function ReviewBar({ applies, onApprove, onReject, onDone }: {
  /** What approving does, as the end of "Approving applies it: …". */
  applies: string;
  onApprove: () => Promise<unknown>;
  onReject: (reason: string) => Promise<unknown>;
  onDone: () => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(call: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await call();
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border-2 border-ambernut-300 bg-ambernut-50 p-4 space-y-3">
      <p className="text-[13px] text-ambernut-900">
        <b>Needs your approval.</b> Approving applies it: {applies} Rejecting applies nothing.
      </p>
      {rejecting && (
        <input className={inputClass} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is it rejected? (required)" />
      )}
      {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
      <div className="flex flex-wrap gap-2 justify-end">
        {rejecting ? (
          <>
            <Button variant="secondary" onClick={() => setRejecting(false)} disabled={busy}>Cancel</Button>
            <Button variant="danger" icon="close" disabled={busy || !reason.trim()} onClick={() => run(() => onReject(reason.trim()))}>Reject this check</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setRejecting(true)} disabled={busy}>Reject…</Button>
            <Button icon="check" disabled={busy} onClick={() => run(onApprove)}>Approve this check</Button>
          </>
        )}
      </div>
    </div>
  );
}
