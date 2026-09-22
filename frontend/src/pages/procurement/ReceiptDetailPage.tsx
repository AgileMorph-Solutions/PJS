import { useParams, Link, Navigate } from "react-router-dom";
import { useTracking } from "../../state/TrackingContext";
import { deriveStatus } from "../../domain/receiptStatus";
import { DECISION_BRANCHES } from "../../domain/decisions";
import { stages, rejectStage } from "../../data/stages";
import { StageForm } from "../../components/StageForm";
import { DecisionBranch } from "../../components/DecisionBranch";
import { ReceiptStatusPill } from "../../components/ReceiptStatusPill";

export function ReceiptDetailPage() {
  const { id = "" } = useParams();
  const { getReceipt, setStageField, setBranch, flushStage } = useTracking();
  const receipt = getReceipt(id);

  if (!receipt) return <Navigate to="/procurement/receipts" replace />;

  const status = deriveStatus(receipt);
  const completedIds = new Set(Object.keys(receipt.stageData));
  // Once a Lot exists, that's the record's real-world identity from here on — the receipt id
  // stays as the underlying record key, but the page leads with what a warehouse user actually
  // calls it.
  const primaryLabel = receipt.lotNo ? `Lot ${receipt.lotNo}` : receipt.id;

  return (
    <>
      <div className="page-header-row">
        <div>
          <p className="kicker">
            <Link to="/procurement/receipts">RCN Receipts</Link> / {receipt.id}
            {receipt.lotNo ? ` (Lot ${receipt.lotNo})` : ""}
          </p>
          <h2 className="page-title" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {primaryLabel}
            <ReceiptStatusPill status={status} />
          </h2>
          <p className="page-lede">
            {receipt.supplierName || "No supplier yet"} · {receipt.vehicleNo ? `vehicle ${receipt.vehicleNo}` : "no vehicle no."} ·{" "}
            {receipt.warehouse || "no warehouse"}
            {receipt.lotNo ? ` · from receipt ${receipt.id}` : ""}
            {receipt.binNo ? ` · Bin ${receipt.binNo}` : ""}
          </p>
        </div>
      </div>

      <div className="receipt-layout">
        <div className="receipt-stages">
          {stages.map((stage) => {
            const done = completedIds.has(stage.id);
            const branchOptions = DECISION_BRANCHES[stage.id];
            const chosen = receipt.branches[stage.id];
            const values = receipt.stageData[stage.id] ?? {};
            return (
              <details className="stage-section" key={stage.id} open={done || stage.kind === "decision"}>
                <summary>
                  <span className={`stage-dot ${done ? "done" : ""}`} />
                  {stage.num && <span className="num">{stage.num}</span>}
                  {stage.title}
                  <span className="stage-phase-tag">{stage.phase}</span>
                </summary>
                <div className="stage-section-body">
                  <StageForm
                    stage={stage}
                    values={values}
                    onFieldChange={(fieldName, value) => setStageField(receipt.id, stage.id, fieldName, value)}
                    onFieldBlur={() => flushStage(receipt.id, stage.id)}
                  />
                  {branchOptions && (
                    <DecisionBranch
                      branches={branchOptions}
                      chosen={chosen}
                      onChoose={(b) => setBranch(receipt.id, stage.id, b)}
                    />
                  )}
                </div>
              </details>
            );
          })}

          {receipt.branches["n-qfs"] === "fail" && (
            <details className="stage-section rejected" open>
              <summary>
                <span className="stage-dot done" />
                {rejectStage.title}
                <span className="stage-phase-tag">{rejectStage.phase}</span>
              </summary>
              <div className="stage-section-body">
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

        <aside className="receipt-timeline">
          <h3>Activity timeline</h3>
          {receipt.timeline.length === 0 && <p className="stage-note">Nothing recorded yet.</p>}
          <ul className="timeline-list">
            {[...receipt.timeline].reverse().map((e, i) => (
              <li key={i}>
                <ReceiptStatusPill status={e.status} />
                <span className="timeline-at">{new Date(e.at).toLocaleString()}</span>
                {e.note && <p className="timeline-note">{e.note}</p>}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </>
  );
}
