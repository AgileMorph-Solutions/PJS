import { useMemo, useState } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { useTracking, useReceiptLinks } from "../../state/TrackingContext";
import { deriveStatus, getStageProgress, isStageBlank } from "../../domain/receiptStatus";
import { DECISION_BRANCHES } from "../../domain/decisions";
import { stages, rejectStage } from "../../data/stages";
import { StageForm } from "../../components/StageForm";
import { DecisionBranch } from "../../components/DecisionBranch";
import { ReceiptStatusPill } from "../../components/ReceiptStatusPill";
import { StatBlock } from "../../components/ui/StatBlock";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { usePagination } from "../../components/ui/usePagination";
import { Pagination } from "../../components/ui/Pagination";

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
  const timelinePage = usePagination(receipt ? [...receipt.timeline].reverse() : []);
  const { links, loading: linksLoading } = useReceiptLinks(receipt?.id);

  if (!receipt) return <Navigate to="/procurement/receipts" replace />;

  const status = deriveStatus(receipt);
  const { doneIds, doneCount, activeStage } = getStageProgress(receipt);

  // Once a Lot exists, that's the record's real-world identity from here on — the receipt id
  // stays as the underlying record key, but the page leads with what a warehouse user actually
  // calls it.
  const primaryLabel = receipt.lotNo ? `Lot ${receipt.lotNo}` : receipt.id;

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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-6">
          <StatBlock icon="scale" label="Net weight" value={netWt ? `${netWt} kg` : "—"} sub={netWt ? "Weighed" : "Not yet weighed"} />
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
            <span className="text-xs font-medium text-warmstone-500">{stages.length} stages, any order</span>
          </div>

          {stages.map((stage) => {
            const done = doneIds.has(stage.id);
            const isActive = stage.id === activeStage?.id;
            const branchOptions = DECISION_BRANCHES[stage.id];
            const chosen = receipt.branches[stage.id];
            const values = receipt.stageData[stage.id] ?? {};
            const blank = done && isStageBlank(values);

            return (
              <details
                key={stage.id}
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
              <p className="text-xs text-warmstone-500 leading-relaxed">Open the stage below to record it.</p>
            </div>
          )}

          {(linksLoading || links) && (
            <LinkedRecordsCard links={links} loading={linksLoading} />
          )}

          {receipt.binNo && (
            <CollapsibleCard title="Also in this Bin" meta={otherInSameBin.length}>
              <div className="mb-3">
                <Link
                  to={`/masters/bins/${receipt.binNo}`}
                  className="text-xs font-bold text-brand-700 bg-brand-50 border border-brand-200 px-2.5 py-0.5 rounded-md hover:bg-brand-100 transition-colors"
                >
                  View Bin {receipt.binNo}
                </Link>
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
            </CollapsibleCard>
          )}

          <CollapsibleCard title="Activity timeline" meta={receipt.timeline.length}>
            {receipt.timeline.length === 0 && <p className="text-[12.5px] text-warmstone-400">Nothing recorded yet.</p>}
            <ul className="space-y-3">
              {timelinePage.pageRows.map((e, i) => (
                <li key={i} className="flex flex-col gap-1 pb-3 border-b border-warmstone-100 last:border-0 last:pb-0">
                  <ReceiptStatusPill status={e.status} />
                  <span className="text-[11px] text-warmstone-400">{new Date(e.at).toLocaleString()}</span>
                  {e.note && <p className="text-[12px] text-warmstone-500">{e.note}</p>}
                </li>
              ))}
            </ul>
            <Pagination state={timelinePage} />
          </CollapsibleCard>
        </div>
      </div>
    </div>
  );
}

/**
 * Cross-references this receipt to drying jobs / transfer receipts about the same physical batch,
 * joined server-side on FICHE (see backend/src/services/receiptLinks.ts's header for why FICHE and
 * not Lot/Bin). Three honest states beyond "found something": still checking, no FICHE recorded at
 * all, and a FICHE recorded but nothing matches it yet (the batch likely hasn't moved past this
 * stage) — none of them look like a broken card.
 */
function LinkedRecordsCard({
  links,
  loading,
}: {
  links: import("../../repository/api").ReceiptLinks | null;
  loading: boolean;
}) {
  return (
    <CollapsibleCard
      title="Linked records"
      meta={loading ? "checking…" : links?.fiche ? `FICHE ${links.fiche}` : "no FICHE"}
      defaultOpen={!loading && Boolean(links?.fiche)}
    >
      {loading || !links ? (
        <p className="text-[12.5px] text-warmstone-400 animate-pulse">Checking linked records…</p>
      ) : !links.fiche ? (
        <p className="text-[12.5px] text-warmstone-500">
          No FICHE (paper docket) number recorded on this receipt yet — that's the one identifier that
          actually carries across the drying report and the transfer ledger, so there's nothing to
          cross-reference until it's captured.
        </p>
      ) : links.dryingJobs.length === 0 && links.transfers.length === 0 ? (
        <p className="text-[12.5px] text-warmstone-500">
          FICHE {links.fiche} is recorded, but no drying job or warehouse transfer matches it yet —
          this batch likely hasn't moved past this stage.
        </p>
      ) : (
        <div className="space-y-3.5">
          <div className="space-y-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-warmstone-400">
              Lot &amp; Bin observed elsewhere
            </p>
            {/* Per-source, deliberately never merged into one "the bin" — the same batch is
                genuinely in a different bin at each stage (received vs. moved for drying). */}
            <ul className="space-y-1">
              {links.transfers.map((t) => (
                <li key={`t-${t.sn}`} className="text-[12.5px] text-warmstone-700">
                  Lot {t.lotNo || "—"} · Bin {t.binNo || "—"}{" "}
                  <span className="text-warmstone-400">— transfer SN {t.sn}</span>
                </li>
              ))}
              {links.dryingJobs.map((d) => (
                <li key={`d-${d.id}`} className="text-[12.5px] text-warmstone-700">
                  Lot {d.lotNo || "—"} · Bin {d.bin || "—"}{" "}
                  <span className="text-warmstone-400">— drying {d.id}</span>
                </li>
              ))}
            </ul>
          </div>

          {links.transfers.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-warmstone-400">Warehouse transfers</p>
                <Link to="/jute/transfers" className="text-[11px] font-semibold text-brand-700 hover:text-brand-800">
                  View all
                </Link>
              </div>
              <ul className="space-y-1.5">
                {links.transfers.map((t) => (
                  <li
                    key={t.sn}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-warmstone-50 text-xs font-medium text-warmstone-700"
                  >
                    <span>SN {t.sn} · {t.sourceWarehouse}</span>
                    <span className="text-warmstone-400">{t.receivedDate || "—"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {links.dryingJobs.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-warmstone-400">Drying jobs</p>
                <Link to="/procurement/drying" className="text-[11px] font-semibold text-brand-700 hover:text-brand-800">
                  View all
                </Link>
              </div>
              <ul className="space-y-1.5">
                {links.dryingJobs.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-warmstone-50 text-xs font-medium text-warmstone-700"
                  >
                    <span>{d.id} · {d.status}</span>
                    <span className="text-warmstone-400">{d.date || "—"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </CollapsibleCard>
  );
}
