import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, Link, Navigate } from "react-router-dom";
import { useTracking, useOneReceiptPlanInfo } from "../../state/TrackingContext";
import { useSite } from "../../state/SiteContext";
import { useSubmissions } from "../../state/userManagement";
import { SubmissionCard } from "../../components/SubmissionCard";
import { SubmissionReview } from "../../components/SubmissionReview";
import { deriveStatus, getStageProgress } from "../../domain/receiptStatus";
import { stageForSite } from "../../domain/decisions";
import { rejectStage, RECEPTION_STEPS, stageById } from "../../data/stages";
import { receptionStages, legacyLotStages, YARD_DRYING_STAGE } from "@anagroci/contract/domain/warehouseActivityStages";
import { splitBinCodes } from "@anagroci/contract/domain/productionBatch";
import { StageForm } from "../../components/StageForm";
import { ReceiptStatusPill } from "../../components/ReceiptStatusPill";
import { LotJourney } from "../../components/receipt/LotJourney.tsx"; // explicit: LotJourney.tsx and lotJourney.ts differ only by case, which a case-insensitive filesystem (macOS) resolves to the wrong one
import { LotOverview } from "../../components/receipt/LotOverview";
import { ReceiptPlanCard } from "../../components/receipt/ReceiptPlanCard";
import { TruckSummaryCard } from "../../components/receipt/TruckSummaryCard";
import { TransferSentCard } from "../../components/receipt/TransferSentCard";
import { UploadIssuesCard } from "../../components/receipt/UploadIssuesCard";
import { DownstreamRecords } from "../../components/receipt/DownstreamRecords";
import { buildJourney } from "../../components/receipt/lotJourney.ts";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { normalizeSupplierName } from "@anagroci/contract/domain/supplierCode";
import { api } from "../../repository/api";
import { FieldHistory } from "../../components/receipt/FieldHistory";
import { StageAuthor } from "../../components/receipt/StageAuthor";
import { StageCard } from "../../components/receipt/StageCard";
import { useStageCards } from "../../components/receipt/useStageCards";
import { canCorrectRecords, canSeeField } from "@anagroci/contract/data/roles";
import { formatDate } from "@anagroci/contract/domain/dateFormat";
import { useOpenPanels } from "../../components/ui/useOpenPanels";
import { buttonClass } from "../../components/ui/Button";

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
  const { receipts, getReceipt, setStageField, flushStage, refresh } = useTracking();
  const receipt = getReceipt(id);
  // The field rules, the Bins, the linked records and the change log — the same for every stage card (useStageCards).
  const ctx = useStageCards(receipt, { withFiche: true });
  const { me, canEdit, fieldLog, changesByStage, plans, links, linksLoading, siteType } = ctx;
  const submissions = useSubmissions({ receiptId: id });
  const { info: planInfo, refetch: refetchPlanInfo } = useOneReceiptPlanInfo(id, canEdit);
  const [copied, setCopied] = useState(false);
  // ?stage=<id> (e.g. Transfers' "Add Bin" on a Lot with no Bin) opens straight on that stage, expanded and in view.
  const [params] = useSearchParams();
  const focusStage = params.get("stage") ?? undefined;
  const [tab, setTab] = useState<"overview" | "stages" | "history">(focusStage ? "stages" : "overview");
  const [lockError, setLockError] = useState<string | null>(null);
  const [lockBusy, setLockBusy] = useState(false);

  const otherInSameBin = useMemo(
    () => (receipt?.binNo ? receipts.filter((r) => r.binNo === receipt.binNo && r.id !== receipt.id) : []),
    [receipts, receipt?.binNo, receipt?.id]
  );
  // This page is the reception record: gate entry to GRN and stock. What happens to the Lot in the warehouse after that
  // (drying, other activities, the ledger, transfer / production) is on its Warehouse activities page.
  // Stage cards stay open while you type in them, though the first value moves "In progress" on to the next stage.
  const panels = useOpenPanels(receipt ? getStageProgress(receipt, receptionStages).activeStage?.id : undefined, focusStage);
  useEffect(() => {
    if (focusStage) document.getElementById(`stage-${focusStage}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focusStage, receipt?.id]);

  if (!receipt) return <Navigate to={`/${site.slug}/receipts`} replace />;
  const canReopen = canCorrectRecords(me.role);
  // Opened by an old REC-2026-NNNN id (a bookmark, an export, a printed form): carry on at the new one.
  if (receipt.id !== id) return <Navigate to={`/${site.slug}/receipts/${receipt.id}`} replace />;

  const status = deriveStatus(receipt);

  const { doneIds, doneCount, activeStage } = getStageProgress(receipt, receptionStages);
  // The receipt's own site decides how its journey ends, whichever section it is viewed from.
  const journey = buildJourney(receipt, links, siteType);
  // Once Reception has put the Lot in a Bin, its warehouse work carries on on its own page — for the people who record it.
  // Its Bin's page — or the list, when the Lot was recorded across several Bins.
  const lotBins = receipt.branches["n-qfs"] === "fail" ? [] : splitBinCodes(receipt.binNo);
  const activitiesHref = canEdit && lotBins.length
    ? (lotBins.length === 1 ? `/${site.slug}/warehouse-activities/${encodeURIComponent(lotBins[0]!)}` : `/${site.slug}/warehouse-activities`)
    : undefined;
  // The truck's own drying: straight off the truck onto the drying yard, recorded with its unloading (Sameer, 18 Nov 2026).
  const yardStage = { ...stageById[YARD_DRYING_STAGE]!, title: "Unloaded straight onto the drying yard?" };
  const yardDone = receipt.stageData[YARD_DRYING_STAGE] !== undefined || receipt.branches[YARD_DRYING_STAGE] !== undefined;
  // What this Lot recorded per Lot before warehouse activities moved to Bins: kept, and shown for the record.
  const legacy = legacyLotStages(receipt);

  // Once a Lot exists, that's the record's real-world identity from here on — the receipt id
  // stays as the underlying record key, but the page leads with what a warehouse user actually
  // calls it.
  const primaryLabel = receipt.lotNo ? `Lot ${receipt.lotNo}` : receipt.id;

  // A decision stage sits in its natural position among the stages (n-qfs between n-verify and
  // n-gross), so "the record's current stage is a decision" is exactly "there's an unmade decision
  // waiting right here" — no separate lookahead needed.
  const pendingDecision = activeStage?.kind === "decision" ? stageForSite(activeStage, siteType) : undefined;

  // The receipt's own site (r.warehouse) may not match the section it's being viewed from — a
  // linked/cross-site view is by design (see this page's own header comment), so the breadcrumb
  // names whichever section this URL actually belongs to, not a guess from the record itself.
  // A truck from the Unit warehouse is listed on Reception's own tab for those trucks.
  const backHref = receipt.transfer ? `/${site.slug}/receipts/from-unit` : `/${site.slug}/receipts`;


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
        {receipt.supplierName && <span className="text-warmstone-500">· {normalizeSupplierName(receipt.supplierName)}</span>}
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
              {receipt.transfer
                ? `From ${receipt.transfer.fromWarehouse} · ${receipt.transfer.transferId} · sent as ${receipt.transfer.sentAs}`
                : normalizeSupplierName(receipt.supplierName) || "No supplier yet"} · {receipt.vehicleNo ? `vehicle ${receipt.vehicleNo}` : "no vehicle no."}
              {receipt.lotNo && ` · from receipt ${receipt.id}`}
              {receipt.binNo && ` · Bin ${receipt.binNo}`}
            </p>
          </div>

          <div className="bg-warmstone-50 border border-warmstone-200 rounded-2xl p-4 w-full lg:w-96">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-warmstone-500">Current progress</span>
              <span className="text-xs font-bold text-brand-700 bg-brand-50 border border-brand-200 px-2.5 py-0.5 rounded-full">
                {doneCount} of {receptionStages.length} stages
              </span>
            </div>
            <div className="text-sm font-bold text-warmstone-900 mb-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-brand-700">arrow_forward</span>
              <span>{activeStage ? activeStage.title : "Reception complete"}</span>
            </div>
            <div className="w-full bg-warmstone-200 h-2.5 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-brand-500 to-brand-700 h-full rounded-full transition-all duration-500"
                style={{ width: `${receptionStages.length ? Math.round((doneCount / receptionStages.length) * 100) : 0}%` }}
              />
            </div>
            {activitiesHref && (
              <Link to={activitiesHref} className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:text-brand-800">
                Next: Warehouse activities
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </Link>
            )}
          </div>
        </div>

        <div className="pt-6">
          <LotJourney steps={journey} />
        </div>
      </div>

      {/* A complete GRN locks the reception record; a finalised bin closes that step. The Warehouse Incharge or an Admin reopens it,
          with a reason (contract canCorrectRecords, 26 Nov 2026). */}
      {(receipt.lockedAt || (receipt.stageData["n-bin"]?.["Bin allocation date"] ?? "").trim()) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ambernut-200 bg-ambernut-50 px-4 py-3 text-[13px] text-ambernut-900">
          <span className="material-symbols-outlined text-[19px] text-ambernut-700">lock</span>
          <span className="flex-1 min-w-[16rem]">
            {receipt.lockedAt
              ? <>This record is <b>locked</b> since {formatDate(receipt.lockedAt)}{receipt.lockedBy ? ` (${receipt.lockedBy})` : ""}: its GRN is complete. Stock, drying and transfers can still go ahead.</>
              : <>The bin allocation was <b>finalised</b> on {receipt.stageData["n-bin"]?.["Bin allocation date"]}{receipt.stageData["n-bin"]?.["Finalised by"] ? ` by ${receipt.stageData["n-bin"]["Finalised by"]}` : ""}.</>}
            {!canReopen && " The Warehouse Incharge or an Admin can reopen it with a reason."}
          </span>
          {canReopen && (
            <button
              type="button" disabled={lockBusy}
              onClick={() => {
                const reason = window.prompt("Why is this record being reopened? (kept on its timeline)");
                if (!reason?.trim()) return;
                setLockBusy(true); setLockError(null);
                api.reopenRecord(receipt.id, reason.trim()).then(() => refresh()).catch((e) => setLockError(e instanceof Error ? e.message : String(e))).finally(() => setLockBusy(false));
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white border border-ambernut-300 text-ambernut-900 text-[12.5px] font-semibold hover:bg-ambernut-100 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">lock_open</span>Reopen
            </button>
          )}
          {lockError && <span role="alert" className="w-full text-danger-700">{lockError}</span>}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-warmstone-200 overflow-x-auto">
        {([
          ["overview", "Overview", "dashboard"],
          ["stages", "Stages & entry", "fact_check"],
          // The change log is read by Warehouse Incharge / admin only (backend auth/policy.ts keeps it from the narrow roles).
          ...(canEdit ? [["history", "History", "history"] as const] : []),
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
          {receipt.transfer && (
            <TransferSentCard receipt={receipt} transfer={receipt.transfer} bktHref={canEdit ? `/${site.slug}/transfers/${encodeURIComponent(receipt.transfer.transferId)}` : undefined} />
          )}
          <TruckSummaryCard receipt={receipt} />
          {canEdit && <UploadIssuesCard receiptId={receipt.id} />}
          {/* A delivery plan is a supplier's: a truck from the Unit warehouse has none. */}
          {canEdit && !receipt.transfer && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <ReceiptPlanCard receiptId={receipt.id} info={planInfo} plans={plans} siteSlug={site.slug} canEdit={canEdit} onChanged={() => void refetchPlanInfo()} />
            </div>
          )}
          <LotOverview receipt={receipt} links={links} othersInBin={otherInSameBin} siteSlug={site.slug} showPrice={canSeeField(me.role, "n-grn", "PRICE") && !receipt.transfer} />
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
          {!canEdit && <SubmissionCard submission={ctx.submission} fromTransfer={Boolean(receipt.transfer)} />}
          {pendingDecision && canEdit && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-ambernut-50 border border-ambernut-200 text-[13px] text-ambernut-900">
              <span className="material-symbols-outlined text-[18px]">flag</span>
              <span><strong>Decision needed:</strong> {pendingDecision.title} - open it below to record it.</span>
            </div>
          )}

          {receptionStages.map((stage, stageIndex) => {
            // The reception stages are grouped into the seven steps the team works through
            // (Arrival → Weight → Quality → Unloading → Lot → Bin → GRN); a heading marks where each
            // starts, and the stock update after GRN carries on under its own.
            const stepIndex = RECEPTION_STEPS.findIndex((st) => st.stageIds.includes(stage.id));
            const step = stepIndex >= 0 ? RECEPTION_STEPS[stepIndex] : undefined;
            const startsStep = step?.stageIds[0] === stage.id;
            const startsLater =
              !step && stageIndex > 0 && RECEPTION_STEPS.some((st) => st.stageIds.includes(receptionStages[stageIndex - 1]!.id));
            return (
              <Fragment key={stage.id}>
                {(startsStep || startsLater) && (
                  <h3 className="px-1 pt-2 text-[11px] font-bold text-warmstone-400 uppercase tracking-wider">
                    {startsStep ? `Step ${stepIndex + 1} · ${step!.title}` : "After reception"}
                  </h3>
                )}
                <StageCard
                  receipt={receipt}
                  ctx={ctx}
                  stage={stage}
                  done={doneIds.has(stage.id)}
                  isActive={stage.id === activeStage?.id}
                  open={panels.isOpen(stage.id)}
                  onToggle={panels.onToggle(stage.id)}
                />
                {/* Unloading ends here: a truck unloaded onto the drying yard is dried before it gets a Bin. */}
                {stage.id === "n-netwt" && (
                  <StageCard
                    receipt={receipt}
                    ctx={ctx}
                    stage={yardStage}
                    done={yardDone}
                    isActive={false}
                    open={panels.isOpen(YARD_DRYING_STAGE)}
                    onToggle={panels.onToggle(YARD_DRYING_STAGE)}
                  />
                )}
              </Fragment>
            );
          })}

          {receipt.branches["n-qfs"] === "fail" && (
            <details open className="bg-white rounded-2xl overflow-hidden border-2 border-danger-600 shadow-md shadow-danger-600/10">
              <summary className="list-none cursor-pointer p-4.5 flex flex-wrap sm:flex-nowrap items-center gap-3.5 bg-danger-50">
                <span className="w-8 h-8 shrink-0 rounded-full bg-danger-600 text-white flex items-center justify-center">
                  <span className="material-symbols-outlined text-[18px]">cancel</span>
                </span>
                <div>
                  <span className="text-sm font-bold text-warmstone-900">{rejectStage.title}</span>
                  <p className="text-xs text-warmstone-500 mt-0.5">{rejectStage.phase}</p>
                </div>
                <div className="flex-1 hidden sm:block" />
                <StageAuthor changes={changesByStage.get("n-reject") ?? []} values={receipt.stageData["n-reject"] ?? {}} />
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

          {legacy.length > 0 && (
            <>
              <h3 className="px-1 pt-2 text-[11px] font-bold text-warmstone-400 uppercase tracking-wider">Recorded on this Lot before warehouse activities moved to Bins</h3>
              {legacy.map((stage) => (
                <StageCard
                  key={stage.id}
                  receipt={receipt}
                  ctx={ctx}
                  stage={stage}
                  done
                  isActive={false}
                  open={panels.isOpen(stage.id)}
                  onToggle={panels.onToggle(stage.id)}
                  readOnly
                />
              ))}
            </>
          )}

          {activitiesHref && (
            <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-warmstone-200 bg-white px-5 py-4 shadow-xs">
              <span className="w-9 h-9 shrink-0 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center">
                <span className="material-symbols-outlined text-[20px]">warehouse</span>
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[13px] font-bold text-warmstone-900">
                  {lotBins.length === 1 ? `This Lot is in Bin ${lotBins[0]}` : `This Lot is in Bins ${lotBins.join(", ")}`}
                </h3>
                <p className="text-[12px] text-warmstone-500 mt-0.5">
                  From here the work is the Bin's: sun drying, the warehouse activities and {siteType === "CENTRAL" ? "sending to production" : "the transfer"} are recorded on {lotBins.length === 1 ? "its" : "each"} Bin's page.
                </p>
              </div>
              <Link to={activitiesHref} className={buttonClass("primary")}>
                Next: Warehouse activities
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </Link>
            </div>
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

      {tab === "history" && canEdit && <FieldHistory {...fieldLog} />}
    </div>
  );
}
