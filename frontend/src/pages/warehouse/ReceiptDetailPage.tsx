import { Fragment, useMemo, useState } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { useTracking, useReceiptLinks } from "../../state/TrackingContext";
import { useSite } from "../../state/SiteContext";
import { useCanEditDirectly, useMe } from "../../state/AuthContext";
import { useSubmissions } from "../../state/userManagement";
import { SubmissionCard } from "../../components/SubmissionCard";
import { SubmissionReview } from "../../components/SubmissionReview";
import { deriveStatus, getStageProgress, isStageBlank } from "../../domain/receiptStatus";
import { DECISION_BRANCHES } from "../../domain/decisions";
import { stages, rejectStage, RECEPTION_STEPS } from "../../data/stages";
import { computeDerivedFields } from "../../domain/receiptMath";
import { StageForm } from "../../components/StageForm";
import { DecisionBranch } from "../../components/DecisionBranch";
import { ReceiptStatusPill } from "../../components/ReceiptStatusPill";
import { LotJourney } from "../../components/receipt/LotJourney";
import { LotOverview } from "../../components/receipt/LotOverview";
import { DownstreamRecords } from "../../components/receipt/DownstreamRecords";
import { buildJourney } from "../../components/receipt/lotJourney";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { usePagination } from "../../components/ui/usePagination";
import { Pagination } from "../../components/ui/Pagination";

/**
 * ONE component for both sites — a receipt is a single record whether it's at Bouaké or Yakro, and
 * this page deliberately shows cross-site linked records by design (see useReceiptLinks /
 * receiptLinks's own header on why /api/receipts/:id/links never accepts ?warehouse=). Only the
 * breadcrumb/back-link below is site-aware — everything else is exactly what the pre-split
 * ReceiptDetailPage was.
 */
export function ReceiptDetailPage() {
  const { id = "" } = useParams();
  const site = useSite();
  const { receipts, getReceipt, setStageField, setBranch, flushStage } = useTracking();
  const receipt = getReceipt(id);
  const me = useMe();
  // Warehouse Incharge/admin edit stages directly; a Branch Manager / QFS Officer sees them
  // read-only and submits their own form (SubmissionCard) for approval instead.
  const canEdit = useCanEditDirectly();
  const submissions = useSubmissions({ receiptId: id });
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"overview" | "stages" | "activity">("overview");

  const otherInSameBin = useMemo(
    () => (receipt?.binNo ? receipts.filter((r) => r.binNo === receipt.binNo && r.id !== receipt.id) : []),
    [receipts, receipt?.binNo, receipt?.id]
  );
  const timelinePage = usePagination(receipt ? [...receipt.timeline].reverse() : []);
  // What the system calculates from the readings as they stand — shown at once, so a net weight
  // follows the tare weight as it is typed rather than appearing after the server has saved it.
  const derived = useMemo(() => (receipt ? computeDerivedFields(receipt.stageData) : {}), [receipt]);
  const { links, loading: linksLoading } = useReceiptLinks(receipt?.id);

  if (!receipt) return <Navigate to={`/${site.slug}/receipts`} replace />;
  // Opened by an old REC-2026-NNNN id (a bookmark, an export, a printed form): carry on at the new one.
  if (receipt.id !== id) return <Navigate to={`/${site.slug}/receipts/${receipt.id}`} replace />;

  const status = deriveStatus(receipt);
  const { doneIds, doneCount, activeStage } = getStageProgress(receipt);
  const journey = buildJourney(receipt, links);

  // Once a Lot exists, that's the record's real-world identity from here on — the receipt id
  // stays as the underlying record key, but the page leads with what a warehouse user actually
  // calls it.
  const primaryLabel = receipt.lotNo ? `Lot ${receipt.lotNo}` : receipt.id;

  // The three decision stages sit in their natural position within `stages` (n-qfs between
  // n-verify and n-gross, etc.), so "the record's current stage is a decision" is exactly "there's
  // an unmade decision waiting right here" — no separate lookahead needed.
  const pendingDecision = activeStage?.kind === "decision" ? activeStage : undefined;

  // The receipt's own site (r.warehouse) may not match the section it's being viewed from — a
  // linked/cross-site view is by design (see this page's own header comment), so the breadcrumb
  // names whichever section this URL actually belongs to, not a guess from the record itself.
  const backHref = `/${site.slug}/receipts`;


  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-[13px] text-warmstone-500">
        <Link to={backHref} className="hover:text-warmstone-900 font-medium transition-colors">
          Reception · {site.sublabel}
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
              {receipt.warehouse || "Warehouse not set"}
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

          <div className="bg-warmstone-50 border border-warmstone-200 rounded-2xl p-4 w-full lg:w-96">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-warmstone-500">Current progress</span>
              <span className="text-xs font-bold text-brand-700 bg-brand-50 border border-brand-200 px-2.5 py-0.5 rounded-full">
                {doneCount} of {stages.length} stages
              </span>
            </div>
            <div className="text-sm font-bold text-warmstone-900 mb-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-brand-700">arrow_forward</span>
              <span>{activeStage ? activeStage.title : "All stages recorded"}</span>
            </div>
            <div className="w-full bg-warmstone-200 h-2.5 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-brand-500 to-brand-700 h-full rounded-full transition-all duration-500"
                style={{ width: `${stages.length ? Math.round((doneCount / stages.length) * 100) : 0}%` }}
              />
            </div>
          </div>
        </div>

        <div className="pt-6">
          <LotJourney steps={journey} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-warmstone-200 overflow-x-auto">
        {([
          ["overview", "Overview", "dashboard"],
          ["stages", "Stages & entry", "fact_check"],
          ["activity", `Activity (${receipt.timeline.length})`, "history"],
        ] as const).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === id ? "border-brand-700 text-brand-700" : "border-transparent text-warmstone-500 hover:text-warmstone-800 hover:border-warmstone-200"
            }`}
          >
            <span className="material-symbols-outlined text-[17px]">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-6">
          <LotOverview receipt={receipt} links={links} othersInBin={otherInSameBin} siteSlug={site.slug} />
          <div>
            <h2 className="text-base font-bold text-warmstone-900 flex items-center gap-2 mb-3 px-1">
              <span className="material-symbols-outlined text-[19px] text-brand-700">account_tree</span>
              Everything recorded against {receipt.lotNo ? `Lot ${receipt.lotNo}` : "this receipt"}
            </h2>
            <DownstreamRecords links={links} loading={linksLoading} />
          </div>
        </div>
      )}

      {tab === "stages" && (
        <div className="space-y-4 max-w-4xl">
          {!canEdit && <SubmissionCard receipt={receipt} role={me.role} />}
          {pendingDecision && canEdit && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-ambernut-50 border border-ambernut-200 text-[13px] text-ambernut-900">
              <span className="material-symbols-outlined text-[18px]">flag</span>
              <span><strong>Decision needed:</strong> {pendingDecision.title} - open it below to record it.</span>
            </div>
          )}

          {stages.map((stage, stageIndex) => {
            // The reception stages are grouped into the seven steps the team works through
            // (Arrival → Weight → Quality → Unloading → Lot → Bin → GRN); a heading marks where each
            // starts, and the stages after GRN carry on under their own.
            const stepIndex = RECEPTION_STEPS.findIndex((st) => st.stageIds.includes(stage.id));
            const step = stepIndex >= 0 ? RECEPTION_STEPS[stepIndex] : undefined;
            const startsStep = step?.stageIds[0] === stage.id;
            const startsLater =
              !step && stageIndex > 0 && RECEPTION_STEPS.some((st) => st.stageIds.includes(stages[stageIndex - 1]!.id));
            const done = doneIds.has(stage.id);
            const isActive = stage.id === activeStage?.id;
            const branchOptions = DECISION_BRANCHES[stage.id];
            const chosen = receipt.branches[stage.id];
            const values = receipt.stageData[stage.id] ?? {};
            const blank = done && isStageBlank(values);

            return (
              <Fragment key={stage.id}>
              {(startsStep || startsLater) && (
                <h3 className="px-1 pt-2 text-[11px] font-bold text-warmstone-400 uppercase tracking-wider">
                  {startsStep ? `Step ${stepIndex + 1} · ${step!.title}` : "After reception"}
                </h3>
              )}
              <details
                open={isActive}
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
                      blank
                        ? "bg-ambernut-100 text-ambernut-700 border border-ambernut-200"
                        : done
                          ? "bg-success-100 text-success-700 border border-success-200"
                          : isActive
                            ? "bg-brand-700 text-white ring-4 ring-brand-100"
                            : "bg-warmstone-100 text-warmstone-400"
                    }`}
                  >
                    {blank ? (
                      <span className="material-symbols-outlined text-[18px]">warning</span>
                    ) : done ? (
                      <span className="material-symbols-outlined text-[18px]">check</span>
                    ) : (
                      (stage.num ?? "•")
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-warmstone-900">{stage.title}</span>
                      {isActive && (
                        <span className="px-2.5 py-0.5 rounded-full bg-brand-700 text-white text-[11px] font-bold">In progress</span>
                      )}
                      {blank && (
                        <span className="px-2.5 py-0.5 rounded-full bg-ambernut-100 text-ambernut-800 text-[11px] font-bold">
                          Reached, not filled in
                        </span>
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
                      derived={derived[stage.id]}
                      onFieldChange={(fieldName, value) => setStageField(receipt.id, stage.id, fieldName, value)}
                      onFieldBlur={() => flushStage(receipt.id, stage.id)}
                      readOnly={!canEdit}
                    />
                    {branchOptions && (
                      <div className="mt-4">
                        <DecisionBranch branches={branchOptions} chosen={chosen} onChoose={(b) => setBranch(receipt.id, stage.id, b)} readOnly={!canEdit} />
                      </div>
                    )}
                  </div>
                </div>
              </details>
              </Fragment>
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
                  readOnly={!canEdit}
                />
              </div>
            </details>
          )}

          {canEdit && submissions.rows.length > 0 && (
            <CollapsibleCard
              title="Submissions"
              meta={`${submissions.rows.filter((r) => r.status === "submitted").length} waiting`}
              defaultOpen={submissions.rows.some((r) => r.status === "submitted")}
            >
              <div className="space-y-5 pt-3">
                {submissions.rows.map((sub) => (
                  <div key={sub.id} className="pb-5 border-b border-warmstone-100 last:border-0 last:pb-0">
                    <SubmissionReview submission={sub} receipt={receipt} onDone={() => void submissions.refetch()} />
                  </div>
                ))}
              </div>
            </CollapsibleCard>
          )}
        </div>
      )}

      {tab === "activity" && (
        <div className="max-w-2xl bg-white border border-warmstone-200 rounded-2xl shadow-xs p-5">
          {receipt.timeline.length === 0 && <p className="text-[12.5px] text-warmstone-400">Nothing recorded yet.</p>}
          <ul className="space-y-3">
            {timelinePage.pageRows.map((e, i) => (
              <li key={i} className="flex flex-col gap-1 pb-3 border-b border-warmstone-100 last:border-0 last:pb-0">
                <ReceiptStatusPill status={e.status} />
                <span className="text-[11px] text-warmstone-400">
                  {new Date(e.at).toLocaleString()}{e.actor ? ` · ${e.actor}` : ""}
                </span>
                {e.note && <p className="text-[12px] text-warmstone-500">{e.note}</p>}
              </li>
            ))}
          </ul>
          <Pagination state={timelinePage} />
        </div>
      )}
    </div>
  );
}
