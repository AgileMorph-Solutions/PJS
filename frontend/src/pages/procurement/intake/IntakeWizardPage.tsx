import { useNavigate, useParams, Navigate, Link } from "react-router-dom";
import { stages, stageById, rejectStage } from "../../../data/stages";
import { StageForm } from "../../../components/StageForm";
import { DecisionBranch } from "../../../components/DecisionBranch";
import { DECISION_BRANCHES } from "../../../domain/decisions";
import { useTracking } from "../../../state/TrackingContext";

/** Guided "new RCN receipt" intake — one stage at a time, in order, scoped to a single receipt id.
 * The receipt detail page is the canonical record view; this is just a friendlier on-ramp for a
 * gate operator entering a brand-new truck arrival end to end. */
export function IntakeWizardPage() {
  const { id = "", stageId = "" } = useParams();
  const navigate = useNavigate();
  const { getReceipt, setStageField, setBranch, flushStage } = useTracking();
  const receipt = getReceipt(id);

  if (!receipt) return <Navigate to="/procurement/receipts" replace />;

  if (stageId === "n-reject") {
    const values = receipt.stageData["n-reject"] ?? {};
    return (
      <>
        <p className="kicker">New RCN receipt · {id} · Branch outcome</p>
        <h2 className="page-title">{rejectStage.title}</h2>
        <div className="card">
          <StageForm
            stage={rejectStage}
            values={values}
            onFieldChange={(fieldName, value) => setStageField(id, "n-reject", fieldName, value)}
                    onFieldBlur={() => flushStage(id, "n-reject")}
          />
        </div>
        <div className="stage-actions">
          <button className="btn btn-secondary" onClick={() => navigate(`/procurement/receipts/new/${id}/n-qfs`)}>
            ← Back to Quality analysis
          </button>
          <button className="btn btn-danger" onClick={() => navigate(`/procurement/receipts/${id}`)}>
            Confirm rejection →
          </button>
        </div>
      </>
    );
  }

  const stage = stageById[stageId];
  if (!stage) return <Navigate to={`/procurement/receipts/new/${id}/n-delplan`} replace />;

  const idx = stages.findIndex((s) => s.id === stageId);
  const prev = idx > 0 ? stages[idx - 1] : null;
  const next = idx >= 0 && idx < stages.length - 1 ? stages[idx + 1] : null;
  const branchOptions = DECISION_BRANCHES[stageId];
  const chosen = receipt.branches[stageId];
  const values = receipt.stageData[stageId] ?? {};

  function handleNext() {
    if (stageId === "n-qfs" && chosen === "fail") {
      navigate(`/procurement/receipts/new/${id}/n-reject`);
      return;
    }
    if (stageId === "n-xferdec") {
      navigate(`/procurement/receipts/${id}`);
      return;
    }
    if (next) navigate(`/procurement/receipts/new/${id}/${next.id}`);
  }

  const nextDisabled = Boolean(branchOptions) && !chosen;

  return (
    <>
      <p className="kicker">
        New RCN receipt · {id} · Step {stage.num ?? "—"} of {stages.length} · {stage.phase}
      </p>
      <h2 className="page-title">{stage.title}</h2>

      <div className="card">
        <StageForm
          stage={stage}
          values={values}
          onFieldChange={(fieldName, value) => setStageField(id, stageId, fieldName, value)}
                    onFieldBlur={() => flushStage(id, stageId)}
        />
        {branchOptions && (
          <DecisionBranch branches={branchOptions} chosen={chosen} onChoose={(b) => setBranch(id, stageId, b)} />
        )}
      </div>

      <div className="stage-actions">
        {prev ? (
          <button className="btn btn-secondary" onClick={() => navigate(`/procurement/receipts/new/${id}/${prev.id}`)}>
            ← Back
          </button>
        ) : (
          <span />
        )}
        <button className="btn btn-primary" onClick={handleNext} disabled={nextDisabled}>
          {stageId === "n-xferdec" ? "Finish → open record" : "Continue →"}
        </button>
      </div>

      <p style={{ marginTop: 24, fontSize: 12, color: "var(--ink-soft)" }}>
        <Link to={`/procurement/receipts/${id}`}>Skip to the full record →</Link>
      </p>
    </>
  );
}
