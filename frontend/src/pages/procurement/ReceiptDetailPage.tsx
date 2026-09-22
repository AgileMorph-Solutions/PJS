import { useMemo, useState } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { useTracking } from "../../state/TrackingContext";
import { deriveStatus } from "../../domain/receiptStatus";
import { DECISION_BRANCHES } from "../../domain/decisions";
import { stages, rejectStage } from "../../data/stages";
import { StageForm } from "../../components/StageForm";
import { DecisionBranch } from "../../components/DecisionBranch";
import { ReceiptStatusPill } from "../../components/ReceiptStatusPill";

/** Real fields only — no invented Crop Year/Harvest Batch/security-seal chrome. Pulled straight
 * out of the actual stage data the record already has, or left out if the record doesn't have it
 * yet (never a placeholder number). */
function realStat(values: Record<string, string> | undefined, label: string): string | undefined {
  const v = values?.[label];
  return v && v.trim() ? v : undefined;
}

export function ReceiptDetailPage() {
  const { id = "" } = useParams();
  const { receipts, getReceipt, setStageField, setBranch, flushStage } = useTracking();
  const receipt = getReceipt(id);
  const [copied, setCopied] = useState(false);

  const otherInSameBin = useMemo(
    () => (receipt?.binNo ? receipts.filter((r) => r.binNo === receipt.binNo && r.id !== receipt.id) : []),
    [receipts, receipt?.binNo, receipt?.id]
  );

  if (!receipt) return <Navigate to="/procurement/receipts" replace />;

  const status = deriveStatus(receipt);
  const completedIds = new Set(Object.keys(receipt.stageData));
  const isDone = (stageId: string, kind: string) =>
    kind === "decision" ? receipt.branches[stageId] !== undefined : completedIds.has(stageId);
  const doneCount = stages.filter((s) => isDone(s.id, s.kind)).length;
  // "Active" = the stage right after the FURTHEST one this receipt has actually reached, not the
  // first gap scanning from the start. n-delplan ("Create delivery plan") is a real gap — the
  // client's own OFFLOADINGS sheet never captured it, so it's blank on nearly every imported
  // receipt — and a naive first-undone scan would anchor "current progress" on it even for
  // receipts that are already through drying, which is exactly backwards.
  const lastDoneIndex = stages.reduce((max, s, i) => (isDone(s.id, s.kind) ? i : max), -1);
  const activeStageId = stages[lastDoneIndex + 1]?.id;

  // Once a Lot exists, that's the record's real-world identity from here on — the receipt id
  // stays as the underlying record key, but the page leads with what a warehouse user actually
  // calls it.
  const primaryLabel = receipt.lotNo ? `Lot ${receipt.lotNo}` : receipt.id;
  const activeStage = stages.find((s) => s.id === activeStageId);

  const netWt = realStat(receipt.stageData["n-netwt"], "NET WT KGS");
  const sacs = realStat(receipt.stageData["n-unload"], "SACS (bags)");
  const bonSacs = realStat(receipt.stageData["n-unload"], "BON SACS (good bags)");
  const moisture = realStat(receipt.stageData["n-qfs"], "MOIS. (moisture)");
  const kor = realStat(receipt.stageData["n-qfs"], "KOR");
  const qfsBranch = receipt.branches["n-qfs"];
  // The three decision stages sit in their natural position within `stages` (n-qfs between
  // n-verify and n-gross, etc.), so "the record's current stage is a decision" is exactly "there's
  // an unmade decision waiting right here" — no separate lookahead needed.
  const pendingDecision = activeStage?.kind === "decision" ? activeStage : undefined;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-[13px] text-warmstone-500">
        <Link to="/procurement/receipts" className="hover:text-warmstone-900 font-medium transition-colors">
          RCN Receipts
        </Link>
        <span className="material-symbols-outlined text-[14px] text-warmstone-300">chevron_right</span>
        <span className="font-bold text-warmstone-900 bg-warmstone-100 px-2.5 py-0.5 rounded-md border border-warmstone-200">
          {receipt.id}
        </span>
        {receipt.supplierName && <span className="text-warmstone-500">· {receipt.supplierName}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white border border-warmstone-200 text-warmstone-700 text-xs font-semibold hover:bg-warmstone-50 transition-all shadow-xs"
          >
            <span className="material-symbols-outlined text-[16px]">print</span>
            Print
          </button>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(window.location.href);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white border border-warmstone-200 text-warmstone-700 text-xs font-semibold hover:bg-warmstone-50 transition-all shadow-xs"
          >
            <span className="material-symbols-outlined text-[16px]">{copied ? "check" : "link"}</span>
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      </div>

      {/* Hero summary */}
      <div className="bg-white rounded-2xl border border-warmstone-200 p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-warmstone-100">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-ambernut-100 text-ambernut-800 text-xs font-semibold border border-ambernut-200">
              <span className="w-2 h-2 rounded-full bg-ambernut-600" />
              {receipt.warehouse || "Warehouse not set"} · {receipt.source === "imported" ? "Imported from workbook" : "Entered manually"}
            </div>
            <h1 className="text-2xl lg:text-3xl font-bold text-warmstone-900 tracking-tight flex items-center gap-3 flex-wrap">
              {primaryLabel}
              <ReceiptStatusPill status={status} />
            </h1>
            <p className="text-sm text-warmstone-500">
              {receipt.supplierName || "No supplier yet"} · {receipt.vehicleNo ? `vehicle ${receipt.vehicleNo}` : "no vehicle no."}
              {receipt.lotNo && ` · from receipt ${receipt.id}`}
              {receipt.binNo && ` · Bin ${receipt.binNo}`}
            </p>
          </div>

          <div className="bg-warmstone-50 border border-warmstone-200 rounded-2xl p-4 min-w-[300px] lg:w-96">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-warmstone-500">Current progress</span>
              <span className="text-xs font-bold text-brand-700 bg-brand-50 border border-brand-200 px-2.5 py-0.5 rounded-full">
                {doneCount} of {stages.length} stages
              </span>
            </div>
            <div className="text-sm font-bold text-warmstone-900 mb-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-brand-700">arrow_forward</span>
              <span>{activeStage ? activeStage.title : "All real-workbook stages recorded"}</span>
            </div>
            <div className="w-full bg-warmstone-200 h-2.5 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-brand-500 to-brand-700 h-full rounded-full transition-all duration-500"
                style={{ width: `${stages.length ? Math.round((doneCount / stages.length) * 100) : 0}%` }}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-6">
          <StatBlock icon="scale" label="Net weight" value={netWt ? `${netWt} kg` : "—"} sub={netWt ? "From n-netwt stage" : "Not yet weighed"} />
          <StatBlock
            icon="inventory_2"
            label="Bag count"
            value={sacs ?? "—"}
            sub={bonSacs ? `${bonSacs} good bags` : sacs ? "Bags unloaded" : "Not yet unloaded"}
          />
          <StatBlock
            icon="science"
            label="Quality inspection"
            value={qfsBranch === "pass" ? "Passed" : qfsBranch === "fail" ? "Failed" : "Pending"}
            sub={moisture ? `${moisture}% moisture${kor ? ` · KOR ${kor}` : ""}` : "No QFS result yet"}
            tone={qfsBranch === "pass" ? "success" : qfsBranch === "fail" ? "danger" : "default"}
          />
          <StatBlock icon="local_shipping" label="Vehicle" value={receipt.vehicleNo || "—"} sub={receipt.warehouse || "No warehouse yet"} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: the real ~16-stage process, one card per stage */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-base font-bold text-warmstone-900 flex items-center gap-2">
              <span className="material-symbols-outlined text-[19px] text-brand-700">fact_check</span>
              Delivery stages
            </h2>
            <span className="text-xs font-medium text-warmstone-500">
              The real process — {stages.length} stages, filled in any order
            </span>
          </div>

          {stages.map((stage) => {
            const done = isDone(stage.id, stage.kind);
            const isActive = stage.id === activeStageId;
            const branchOptions = DECISION_BRANCHES[stage.id];
            const chosen = receipt.branches[stage.id];
            const values = receipt.stageData[stage.id] ?? {};

            return (
              <details
                key={stage.id}
                open={done || stage.kind === "decision" || isActive}
                className={`bg-white rounded-2xl overflow-hidden transition-all ${
                  isActive ? "border-2 border-brand-700 shadow-md shadow-brand-700/10" : "border border-warmstone-200 shadow-xs"
                }`}
              >
                <summary
                  className={`list-none cursor-pointer p-4.5 flex items-center gap-3.5 transition-colors ${
                    isActive ? "bg-gradient-to-r from-brand-50 via-white to-white" : "hover:bg-warmstone-50"
                  }`}
                >
                  <span
                    className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center font-bold text-sm ${
                      done
                        ? "bg-success-100 text-success-700 border border-success-200"
                        : isActive
                          ? "bg-brand-700 text-white ring-4 ring-brand-100"
                          : "bg-warmstone-100 text-warmstone-400"
                    }`}
                  >
                    {done ? <span className="material-symbols-outlined text-[18px]">check</span> : stage.num ?? "•"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-warmstone-900">{stage.title}</span>
                      {isActive && (
                        <span className="px-2.5 py-0.5 rounded-full bg-brand-700 text-white text-[11px] font-bold">In progress</span>
                      )}
                      {stage.kind === "decision" && chosen && (
                        <span className="px-2 py-0.5 rounded-full bg-success-100 text-success-800 text-[11px] font-semibold">
                          {DECISION_BRANCHES[stage.id]?.find((b) => b.id === chosen)?.label ?? chosen}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-warmstone-500 mt-0.5">{stage.phase}</p>
                  </div>
                </summary>
                <div className="px-5 pb-5 pt-1 border-t border-warmstone-100 bg-warmstone-50/60">
                  <div className="pt-4">
                    <StageForm
                      stage={stage}
                      values={values}
                      onFieldChange={(fieldName, value) => setStageField(receipt.id, stage.id, fieldName, value)}
                      onFieldBlur={() => flushStage(receipt.id, stage.id)}
                    />
                    {branchOptions && (
                      <div className="mt-4">
                        <DecisionBranch branches={branchOptions} chosen={chosen} onChoose={(b) => setBranch(receipt.id, stage.id, b)} />
                      </div>
                    )}
                  </div>
                </div>
              </details>
            );
          })}

          {receipt.branches["n-qfs"] === "fail" && (
            <details open className="bg-white rounded-2xl overflow-hidden border-2 border-danger-600 shadow-md shadow-danger-600/10">
              <summary className="list-none cursor-pointer p-4.5 flex items-center gap-3.5 bg-danger-50">
                <span className="w-8 h-8 shrink-0 rounded-full bg-danger-600 text-white flex items-center justify-center">
                  <span className="material-symbols-outlined text-[18px]">cancel</span>
                </span>
                <div>
                  <span className="text-sm font-bold text-warmstone-900">{rejectStage.title}</span>
                  <p className="text-xs text-warmstone-500 mt-0.5">{rejectStage.phase}</p>
                </div>
              </summary>
              <div className="px-5 pb-5 pt-4 border-t border-warmstone-100 bg-warmstone-50/60">
                <StageForm
                  stage={rejectStage}
                  values={receipt.stageData["n-reject"] ?? {}}
                  onFieldChange={(fieldName, value) => setStageField(receipt.id, "n-reject", fieldName, value)}
                  onFieldBlur={() => flushStage(receipt.id, "n-reject")}
                />
              </div>
            </details>
          )}

          {/* Real domain rule, not decoration — the same "one truck = one Lot, a Bin holds many
              Lots" rule documented throughout this app's data model. Uses this receipt's own real
              lot/bin, or stays generic before they're assigned. */}
          <div className="bg-brand-50 rounded-2xl border border-brand-200 p-4.5 flex items-start gap-3.5">
            <div className="w-9 h-9 rounded-xl bg-brand-700 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
              <span className="material-symbols-outlined text-[20px]">lightbulb</span>
            </div>
            <div className="space-y-1 text-xs">
              <div className="text-sm font-bold text-warmstone-900">Lot vs. Bin</div>
              <p className="text-warmstone-600 leading-relaxed">
                <strong className="text-warmstone-900 font-semibold">The Lot Number</strong> belongs to this one truck —{" "}
                {receipt.lotNo ? <strong className="text-warmstone-900">{receipt.lotNo}</strong> : "not assigned yet"}. One truck is
                always exactly one Lot.
                <br />
                <strong className="text-warmstone-900 font-semibold">The Bin</strong> is the physical storage location —{" "}
                {receipt.binNo ? <strong className="text-warmstone-900">{receipt.binNo}</strong> : "not allocated yet"} — and can hold
                RCN from many different Lots and trucks at once.
              </p>
            </div>
          </div>
        </div>

        {/* Right: real cross-references only */}
        <div className="lg:col-span-4 space-y-5 lg:sticky lg:top-20">
          {pendingDecision && (
            <div className="bg-white rounded-2xl border border-warmstone-200 p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-warmstone-500">Next action</span>
                <span className="px-2 py-0.5 rounded-full bg-ambernut-100 text-ambernut-800 text-[11px] font-bold border border-ambernut-200">
                  Decision needed
                </span>
              </div>
              <p className="text-xs text-warmstone-500 leading-relaxed">
                This receipt has reached a decision point that hasn't been made yet — open the stage below to record it.
              </p>
            </div>
          )}

          {receipt.binNo && (
            <div className="bg-white rounded-2xl border border-warmstone-200 p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-warmstone-100">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-brand-700 text-[20px]">warehouse</span>
                  <span className="text-xs font-bold uppercase tracking-wider text-warmstone-500">Also in this Bin</span>
                </div>
                <span className="text-xs font-bold text-brand-700 bg-brand-50 border border-brand-200 px-2.5 py-0.5 rounded-md">
                  {receipt.binNo}
                </span>
              </div>
              {otherInSameBin.length === 0 ? (
                <p className="text-[12.5px] text-warmstone-500">No other receipts share this Bin right now.</p>
              ) : (
                <ul className="space-y-1.5">
                  {otherInSameBin.slice(0, 6).map((r) => (
                    <li key={r.id}>
                      <Link
                        to={`/procurement/receipts/${r.id}`}
                        className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-warmstone-50 hover:bg-warmstone-100 text-xs font-medium text-warmstone-700 transition-colors"
                      >
                        <span>{r.lotNo ? `Lot ${r.lotNo}` : r.id}</span>
                        <ReceiptStatusPill status={deriveStatus(r)} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="bg-white rounded-2xl border border-warmstone-200 p-5 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wider text-warmstone-500 mb-3">Activity timeline</h3>
            {receipt.timeline.length === 0 && <p className="text-[12.5px] text-warmstone-400">Nothing recorded yet.</p>}
            <ul className="space-y-3">
              {[...receipt.timeline].reverse().map((e, i) => (
                <li key={i} className="flex flex-col gap-1 pb-3 border-b border-warmstone-100 last:border-0 last:pb-0">
                  <ReceiptStatusPill status={e.status} />
                  <span className="text-[11px] text-warmstone-400">{new Date(e.at).toLocaleString()}</span>
                  {e.note && <p className="text-[12px] text-warmstone-500">{e.note}</p>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBlock({
  icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: string;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "success" | "danger";
}) {
  const toneCls =
    tone === "success"
      ? "bg-success-50 border-success-200 [&_.stat-label]:text-success-700 [&_.stat-value]:text-success-900 [&_.stat-sub]:text-success-700 [&_.stat-icon]:text-success-700"
      : tone === "danger"
        ? "bg-danger-50 border-danger-200 [&_.stat-label]:text-danger-700 [&_.stat-value]:text-danger-900 [&_.stat-sub]:text-danger-700 [&_.stat-icon]:text-danger-700"
        : "bg-warmstone-50 border-warmstone-200 hover:bg-warmstone-100";
  return (
    <div className={`rounded-xl p-4 border transition-all ${toneCls}`}>
      <div className="flex items-center justify-between text-xs font-bold text-warmstone-500 stat-label uppercase mb-1">
        <span>{label}</span>
        <span className="material-symbols-outlined text-[19px] text-brand-700 stat-icon">{icon}</span>
      </div>
      <div className="text-xl font-bold text-warmstone-900 tracking-tight tabular-nums stat-value">{value}</div>
      {sub && <div className="text-xs text-warmstone-500 mt-0.5 font-medium stat-sub">{sub}</div>}
    </div>
  );
}
