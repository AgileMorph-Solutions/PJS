import { useState, type FormEvent } from "react";
import { ReviewBar } from "./ReviewBar";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Input";
import { Pill } from "../ui/Pill";
import { api, ApiError } from "../../repository/api";
import {
  DEFAULT_SAMPLE_G, MOISTURE_DECISION_LABELS, canTakeMoistureCheck, moistureCheckError, qualityFigures,
  type MoistureDecision,
} from "@anagroci/contract/domain/rcnReceipt";
import { formatDateTime } from "@anagroci/contract/domain/dateFormat";
import type { MoistureCheck, MoistureCheckInput, RcnReceipt } from "@anagroci/contract/types/rcnReceipt";

/**
 * Step 2 of a load, the client's "2. Input RCN Quality report": "is this load dry enough?" The QFS Officer's check waits
 * for the Incharge; an Incharge's or Admin's own applies at once (the server decides, by role; `direct` only words the
 * button).
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
          <b>On hold:</b> moisture was {current.moisture} %. Take a new sample once the load has dried.
        </p>
      )}

      {current && <CheckDetails check={current} />}
      {/* Always open (any order); only a check already waiting for approval holds a new one back. */}
      {canTakeMoistureCheck(receipt.status) && (
        canEnter ? <MoistureForm receiptId={receipt.id} direct={direct} onSaved={onChanged} /> : !current && <p className="text-[13px] text-warmstone-500">Waiting for the QFS Officer's check.</p>
      )}

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
                {formatDateTime(c.submittedAt)} · moisture {c.moisture} % · {MOISTURE_DECISION_LABELS[c.decision]} · {c.submittedBy}
                {c.status === "rejected" && <span className="text-danger-700"> · rejected by {c.reviewedBy}: {c.rejectReason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The client's "2. Input RCN Quality report" columns, in its order and in its words, so the form reads like the sheet:
 * Nut Count, Moisture, Sample Weight, then the cut test's grams.
 */
const SHEET_FIELDS: { key: keyof MoistureCheckInput; label: string; placeholder?: string }[] = [
  { key: "nutCount", label: "Nut Count", placeholder: "e.g. 180" },
  { key: "moisture", label: "Moisture (%)", placeholder: "e.g. 9.8" },
  { key: "sampleG", label: "Sample Weight (g)" },
  { key: "gkG", label: "GK (g)" },
  { key: "spotG", label: "Spot (g)" },
  { key: "immatureG", label: "Immature (g)" },
  { key: "oilG", label: "Oil (g)" },
  { key: "rejectionG", label: "Rejection (g)" },
  { key: "voidsG", label: "Voids (g)" },
  { key: "shellG", label: "Shell (g)" },
  { key: "fruitWasteG", label: "Fruit Waste (g)" },
];

/** The sheet's formula columns, worked out with its own factor (contract qualityFigures); "-" until their parts are in. */
function FiguresRow({ values }: { values: Parameters<typeof qualityFigures>[0] }) {
  const f = qualityFigures(values);
  const lbs = (n: number | null) => (n === null ? "-" : n.toFixed(2));
  const pct = (n: number | null) => (n === null ? "-" : `${n.toFixed(2)} %`);
  const items: [string, string][] = [
    ["KOR (lbs)", lbs(f.kor)], ["SHOT (lbs)", lbs(f.shot)], ["FOT (lbs)", lbs(f.fot)],
    ["Fruit Waste %", pct(f.fruitWastePct)], ["GK-Yield %", pct(f.gkYieldPct)], ["Total Yield %", pct(f.totalYieldPct)],
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-xl bg-warmstone-50 border border-warmstone-200 px-3 py-2">
          <span className="block text-[11px] font-semibold text-warmstone-500">{label}</span>
          <span className="block text-[13px] font-bold text-warmstone-900 tabular-nums">{value}</span>
        </div>
      ))}
    </div>
  );
}

function MoistureForm({ receiptId, direct, onSaved }: { receiptId: string; direct: boolean; onSaved: () => void }) {
  const [v, setV] = useState<MoistureCheckInput>({ sampleG: DEFAULT_SAMPLE_G });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof MoistureCheckInput) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [key]: e.target.value }));

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

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {SHEET_FIELDS.map((f) => (
          <Field key={f.key} label={f.label}>
            <Input numeric value={v[f.key] ?? ""} onChange={set(f.key)} placeholder={f.placeholder} />
          </Field>
        ))}
      </div>

      <div>
        <p className="text-[12px] font-semibold text-warmstone-700 mb-1.5">Worked out</p>
        <FiguresRow values={v} />
      </div>

      <div>
        <p className="text-[12px] font-semibold text-warmstone-700 mb-1.5">Result</p>
        <div className="flex flex-wrap gap-2">
          {(["ok", "hold"] as MoistureDecision[]).map((d) => {
            const on = v.decision === d;
            const tone = d === "ok" ? "border-success-600 bg-success-50 text-success-800" : "border-danger-600 bg-danger-50 text-danger-700";
            return (
              <button
                key={d} type="button" aria-pressed={on}
                onClick={() => setV((p) => ({ ...p, decision: d }))}
                className={`px-4 py-2 rounded-xl border text-[13px] font-semibold transition-colors ${on ? tone : "border-warmstone-200 bg-white text-warmstone-800 hover:bg-warmstone-50"}`}
              >
                {d === "ok" ? "OK · dry enough" : "Hold · too wet, check again"}
              </button>
            );
          })}
        </div>
      </div>

      {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
      <div className="flex items-center justify-end gap-3">
        {!direct && <span className="text-[12px] text-warmstone-500">The Warehouse Incharge approves it before it counts.</span>}
        <Button type="submit" icon={direct ? "check" : "send"} disabled={saving}>{direct ? "Save quality check" : "Send for approval"}</Button>
      </div>
    </form>
  );
}

/** A saved check, as its row in the quality report: the sheet's columns in order, then what they work out to. */
function CheckDetails({ check }: { check: MoistureCheck }) {
  const values: Record<string, string | undefined> = { nutCount: check.nutCount, moisture: check.moisture, sampleG: check.sampleG, ...check.grams };
  return (
    <div className="rounded-xl border border-warmstone-200 bg-white p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={check.decision === "ok" ? "entry" : "gap"} label={MOISTURE_DECISION_LABELS[check.decision]} />
        <Pill tone={check.status === "approved" ? "term" : "decision"} label={check.status === "approved" ? "Approved" : "Waiting for approval"} />
        <span className="text-[12px] text-warmstone-500">
          by {check.submittedBy}, {formatDateTime(check.submittedAt)}
          {check.status === "approved" && check.reviewedBy && check.reviewedBy !== check.submittedBy && ` · approved by ${check.reviewedBy}`}
        </span>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-2">
        {SHEET_FIELDS.map((f) => (
          <div key={f.key}>
            <dt className="text-[11px] font-semibold text-warmstone-500">{f.label}</dt>
            <dd className="text-[13px] font-medium text-warmstone-900 tabular-nums">{values[f.key] || "-"}</dd>
          </div>
        ))}
      </dl>
      <FiguresRow values={values} />
    </div>
  );
}
