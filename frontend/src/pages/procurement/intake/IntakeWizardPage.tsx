import { useNavigate, useParams, Navigate, Link } from "react-router-dom";
import { stages, stageById, rejectStage } from "../../../data/stages";
import { StageForm } from "../../../components/StageForm";
import { DecisionBranch } from "../../../components/DecisionBranch";
import { DECISION_BRANCHES } from "../../../domain/decisions";
import { useTracking } from "../../../state/TrackingContext";

const btnPrimary =
  "inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold transition-all shadow-sm disabled:opacity-40 disabled:pointer-events-none";
const btnSecondary =
  "inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white border border-warmstone-200 text-warmstone-700 text-[13px] font-semibold hover:bg-warmstone-50 transition-all";
const btnDanger =
  "inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-danger-700 hover:bg-danger-800 text-white text-[13px] font-bold transition-all shadow-sm";

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
      <div className="space-y-5">
        <div>
          <p className="text-[11px] font-bold text-warmstone-500 uppercase tracking-wider mb-1.5">
            New RCN receipt · {id} · Branch outcome
          </p>
          <h1 className="text-2xl font-bold text-warmstone-900 tracking-tight">{rejectStage.title}</h1>
        </div>
        <div className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs">
          <StageForm
            stage={rejectStage}
            values={values}
            onFieldChange={(fieldName, value) => setStageField(id, "n-reject", fieldName, value)}
            onFieldBlur={() => flushStage(id, "n-reject")}
          />
        </div>
        <div className="flex items-center justify-between">
          <button className={btnSecondary} onClick={() => navigate(`/procurement/receipts/new/${id}/n-qfs`)}>
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Back to Quality analysis
          </button>
          <button className={btnDanger} onClick={() => navigate(`/procurement/receipts/${id}`)}>
            Confirm rejection
            <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
          </button>
        </div>
      </div>
    );
  }

  const stage = stageById[stageId];
  if (!stage) return <Navigate to={`/procurement/receipts/new/${id}/${stages[0].id}`} replace />;

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
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-bold text-warmstone-500 uppercase tracking-wider mb-1.5">
          New RCN receipt · {id} · Step {stage.num ?? "—"} of {stages.length} · {stage.phase}
        </p>
        <h1 className="text-2xl font-bold text-warmstone-900 tracking-tight">{stage.title}</h1>
      </div>

      <div className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs">
        <StageForm
          stage={stage}
          values={values}
          onFieldChange={(fieldName, value) => setStageField(id, stageId, fieldName, value)}
          onFieldBlur={() => flushStage(id, stageId)}
        />
        {branchOptions && (
          <div className="mt-4">
            <DecisionBranch branches={branchOptions} chosen={chosen} onChoose={(b) => setBranch(id, stageId, b)} />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        {prev ? (
          <button className={btnSecondary} onClick={() => navigate(`/procurement/receipts/new/${id}/${prev.id}`)}>
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Back
          </button>
        ) : (
          <span />
        )}
        <button className={btnPrimary} onClick={handleNext} disabled={nextDisabled}>
          {stageId === "n-xferdec" ? "Finish — open record" : "Continue"}
          <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
        </button>
      </div>

      <p className="text-xs text-warmstone-400">
        <Link to={`/procurement/receipts/${id}`} className="text-brand-700 hover:text-brand-800 font-medium">
          Open full record
        </Link>
      </p>
    </div>
  );
}
