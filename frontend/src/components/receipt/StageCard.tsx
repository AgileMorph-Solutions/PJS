import { useState, type SyntheticEvent } from "react";
import type { ReceiptRecord } from "../../types/receipt";
import type { Stage } from "../../types/stage";
import { isStageBlank, missingStageFields } from "../../domain/receiptStatus";
import { decisionBranchesFor, stageForSite } from "../../domain/decisions";
import { productionReadinessGaps, productionReadinessNotice } from "@anagroci/contract/domain/productionBatch";
import { derivedRuleFor, followingTotals, prefillSuggestions } from "@anagroci/contract/domain/receiptMath";
import { planPrefill } from "@anagroci/contract/domain/deliveryPlan";
import { LOCKED_DECISIONS, LOCKED_STAGES } from "@anagroci/contract/domain/recordLock";
import { FICHE_STAGE } from "@anagroci/contract/domain/fiche";
import { YARD_DRYING_STAGE } from "@anagroci/contract/domain/warehouseActivityStages";
import { passBlocked } from "@anagroci/contract/domain/phaseGate";
import { FINALISED_WHEN_LABEL } from "@anagroci/contract/domain/binFinalise";
import { dryingPhase } from "@anagroci/contract/domain/sunDrying";
import { canSeeField, canSetPrice, whoChangesRecorded } from "@anagroci/contract/data/roles";
import { dispatchedNotes, hiddenOnRecord, stageDifferences, TRANSFER_FIELD_LABELS, TRANSFER_STAGE_TITLES, typedLabelsOnRecord } from "@anagroci/contract/domain/transferReception";
import { TransferDifferences } from "./TransferDifferences";
import { api } from "../../repository/api";
import { StageForm } from "../StageForm";
import { DecisionBranch } from "../DecisionBranch";
import { Pill } from "../ui/Pill";
import { Button } from "../ui/Button";
import { DryingPanel } from "./DryingPanel";
import { FichePanel } from "./FichePanel";
import { PricePanel } from "./PricePanel";
import { StageAuthor } from "./StageAuthor";
import { binFieldWarning } from "./binPicker";
import { originFieldProps } from "./originPicker";
import { arrivalFieldChoices } from "./arrivalPickers";
import { otherActivityChoices, warehouseFieldChoices } from "./warehousePicker";
import type { StageCardsContext } from "./useStageCards";

const SUBMISSION_STATUS: Record<string, string> = { submitted: "waiting for approval", approved: "approved", rejected: "rejected" };

interface Props {
  receipt: ReceiptRecord;
  ctx: StageCardsContext;
  /** The stage as stages.ts has it; the receipt's own site may reword it (Send to production? at a Central warehouse). */
  stage: Stage;
  done: boolean;
  isActive: boolean;
  open: boolean;
  onToggle: (e: SyntheticEvent<HTMLDetailsElement>) => void;
  /** Shown for the record only, never edited here: what a Lot recorded per Lot before warehouse activities moved to Bins. */
  readOnly?: boolean;
}

/**
 * One stage of a truck's record as an open/close card: its form, its decision, and the few stages with a panel of their
 * own (the fiche, drying, the price, finalising the Bin). The reception record and the Warehouse activities page both
 * draw their stages with it, so a stage looks and behaves the same wherever it is filled in.
 */
export function StageCard({ receipt, ctx, stage: rawStage, done, isActive, open, onToggle, readOnly = false }: Props) {
  const { tracking, me, canEdit: mayEdit, rules, derived: savedDerived, links, refetchLinks, dryTypes, binOptions, storeNames, fiche, plan, siteType, changesByStage, straightToProduction, submission } = ctx;
  const { setBranch, flushStage, masters, refresh, refreshMasters } = tracking;
  const canEdit = mayEdit && !readOnly;
  const [finaliseBusy, setFinaliseBusy] = useState(false);
  const [finaliseError, setFinaliseError] = useState<string | null>(null);

  // A truck from the Unit warehouse: the same steps, the documents step named for what it checks there (no supplier).
  // Its quality readings are the received ones, so they say so (TRANSFER_FIELD_LABELS).
  const forSite = stageForSite(rawStage, siteType);
  const relabel = receipt.transfer ? TRANSFER_FIELD_LABELS[forSite.id] : undefined;
  const stage = receipt.transfer
    ? {
      ...forSite,
      title: TRANSFER_STAGE_TITLES[forSite.id] ?? forSite.title,
      fields: relabel ? forSite.fields.map((f) => (relabel[f.n] ? { ...f, label: relabel[f.n] } : f)) : forSite.fields,
    }
    : forSite;
  // What the Unit warehouse dispatched, under the field it is compared with, and the step's differences below the form.
  const transferNotes = receipt.transfer ? dispatchedNotes(receipt.transfer, stage.id) : undefined;
  const differences = receipt.transfer ? stageDifferences({ ...receipt, transfer: receipt.transfer }, stage.id) : [];
  const branchOptions = decisionBranchesFor(stage.id, siteType);
  const chosen = receipt.branches[stage.id];
  // A Branch Manager / QFS Officer types their form's fields here, into a draft submitted for approval, never saved one by
  // one: the card reads their draft (or what they submitted) over the truck's values, and KOR follows what they type.
  const mine = !canEdit && submission.covers(stage.id);
  const values = mine ? submission.values[stage.id] ?? {} : rules.valuesOf(stage.id);
  const derived = mine ? submission.derived : savedDerived;
  // Why Pass can't be chosen yet: from the truck for the Incharge, from what the QFS Officer has typed for them — the same
  // message, so the person measuring sees what the decision still waits for, and it clears as they fill it in (23 Nov 2026).
  const passReason = mine ? passBlocked(submission.values) : rules.passBlocked;
  // The yard drying card is the drying panel, not these fields: an older "No" left it present but empty, never "not filled in".
  const blank = done && stage.id !== YARD_DRYING_STAGE && isStageBlank(values);
  // What this person is shown of the step: the same list the form gets, so the tick only waits for fields they can see.
  const hiddenFields = [...stage.fields.filter((f) => !canSeeField(me.role, stage.id, f.n)).map((f) => f.n), ...hiddenOnRecord(receipt, stage.id)];
  // A step is ticked only once every field on it is filled (Nov 2026), not the moment one value lands in it. The yard
  // drying card is its own panel of drying batches, not these fields, so it keeps its own done.
  const missing = done && !blank && stage.id !== YARD_DRYING_STAGE
    ? missingStageFields(stage.id, stage.fields.filter((f) => !hiddenFields.includes(f.n)), values, derived[stage.id], chosen)
    : [];
  const incomplete = missing.length > 0;
  const gate = rules.gateOf(stage.id);
  const lockedMessage = canEdit && !gate.open ? gate.message : undefined;
  const readinessGaps = stage.id === "n-xferdec" && siteType === "CENTRAL" ? productionReadinessGaps(receipt, links?.dryingBatches) : [];
  const binFinalised = (receipt.stageData["n-bin"]?.["Bin allocation date"] ?? "").trim() !== "";
  // Bin Number is a dropdown of this site's Bins: one Bin per Lot, and a Bin that already holds Lots stays in the list.
  const binWarning = stage.id === "n-bin" ? binFieldWarning(receipt.stageData["n-bin"]?.["Bin Number"], binOptions, storeNames) : undefined;
  const onFieldChange = (fieldName: string, value: string) => {
    if (mine) return submission.setField(stage.id, fieldName, value);
    rules.change(stage.id, fieldName, value);
    // A count changed: the bag totals that follow it change with it, in the same save, so they move as it is typed. A change
    // to a total itself doesn't refill it, so it can be emptied and retyped (the server refills an empty one on save).
    if (derivedRuleFor(stage.id, fieldName)?.editable) return;
    const before = receipt.stageData;
    const after = { ...before, [stage.id]: { ...before[stage.id], [fieldName]: value } };
    for (const [label, v] of Object.entries(followingTotals(before, after)[stage.id] ?? {})) rules.change(stage.id, label, v);
  };
  // Once submitted, the person's own values say what they are waiting for; everything else reads as everyone sees it.
  // A value already recorded on their form is locked, and says whom to ask: only the Incharge or an Admin changes it.
  const sentNotes = mine
    ? Object.fromEntries(stage.fields.flatMap((f) => {
      const st = submission.sentStatus(stage.id, f.n);
      const sent = st ? `Sent by you · ${SUBMISSION_STATUS[st] ?? st}.` : "";
      if (submission.lockedForMe(stage.id, f.n)) return [[f.n, `${sent || "Recorded."} Only ${whoChangesRecorded(stage.id, f.n)} can change it: ask them if it needs correcting.`]];
      return sent ? [[f.n, sent]] : [];
    }))
    : undefined;
  const yardBin = [...(links?.dryingBatches ?? [])].filter((b) => b.source === "entered" && dryingPhase(b.status) === "passed" && b.destinationBinNo).sort((a, b) => a.sn - b.sn).at(-1)?.destinationBinNo ?? undefined;

  // What is already known elsewhere — the plan the truck arrived against, the net weight, the Lot — offered
  // beside the empty field. Nothing is written until the person takes it.
  const suggestions = {
    ...prefillSuggestions(receipt.stageData, stage.id),
    ...planPrefill(plan, receipt.stageData, stage.id),
    // Last, so the paper the truck actually arrived with wins over what the plan expected.
    ...(stage.id === FICHE_STAGE ? fiche.view?.suggestions : {}),
    ...(stage.id === "n-bin" && receipt.lotNo && !(values["Linked Lot Number(s)"] ?? "").trim()
      ? { "Linked Lot Number(s)": { value: receipt.lotNo, from: "this receipt's Lot" } }
      : {}),
    // A truck dried straight off the truck on the yard gets its Bin when the dried RCN is re-bagged: that Bin is offered.
    ...(stage.id === "n-bin" && yardBin && !(values["Bin Number"] ?? "").trim()
      ? { "Bin Number": { value: yardBin, from: "where its drying on the yard put it" } }
      : {}),
  };

  return (
    <details
      id={`stage-${stage.id}`}
      open={open}
      onToggle={onToggle}
      className={`bg-white rounded-2xl overflow-hidden transition-all ${
        isActive ? "border-2 border-brand-700 shadow-md shadow-brand-700/10" : "border border-warmstone-200 shadow-xs"
      }`}
    >
      <summary
        className={`list-none cursor-pointer p-4.5 flex flex-wrap sm:flex-nowrap items-center gap-3.5 transition-colors ${
          isActive ? "bg-gradient-to-r from-brand-50 via-white to-white" : "hover:bg-warmstone-50"
        }`}
      >
        <span
          className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center font-bold text-sm ${
            blank || incomplete
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
          ) : incomplete ? (
            <span className="material-symbols-outlined text-[18px]">pending</span>
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
            {lockedMessage && <Pill tone="system" label={`Locked · finish ${gate.waitingFor} first`} />}
            {blank && (
              <span className="px-2.5 py-0.5 rounded-full bg-ambernut-100 text-ambernut-800 text-[11px] font-bold">
                Reached, not filled in
              </span>
            )}
            {incomplete && (
              <span title={`Still to fill: ${missing.join(", ")}`} className="px-2.5 py-0.5 rounded-full bg-ambernut-100 text-ambernut-800 text-[11px] font-bold">
                Incomplete · missing {missing.length <= 2 ? missing.join(", ") : `${missing.slice(0, 2).join(", ")} and ${missing.length - 2} more`}
              </span>
            )}
            {stage.kind === "decision" && chosen && (
              <span className="px-2 py-0.5 rounded-full bg-success-100 text-success-800 text-[11px] font-semibold">
                {branchOptions?.find((b) => b.id === chosen)?.label ?? chosen}
              </span>
            )}
          </div>
          <p className="text-[12px] text-warmstone-500 mt-0.5">{stage.phase}</p>
        </div>
        <StageAuthor changes={changesByStage.get(stage.id) ?? []} values={values} />
      </summary>
      <div className="px-5 pb-5 pt-1 border-t border-warmstone-100 bg-warmstone-50/60">
        <div className="pt-4">
          {stage.id === "n-drying" && lockedMessage ? (
            <p role="status" className="flex items-start gap-2 rounded-xl border border-warmstone-200 bg-warmstone-100 px-3 py-2 text-[13px] text-warmstone-800">
              <span className="material-symbols-outlined text-[18px] text-warmstone-500">lock</span>
              {lockedMessage}
            </p>
          ) : stage.id === "n-drying" ? (
            <DryingPanel
              scope={{ kind: "truck", receipt }}
              batches={[...(links?.dryingBatches ?? [])].sort((a, b) => a.sn - b.sn)}
              dryTypes={dryTypes}
              bins={binOptions}
              onBinsOpen={refreshMasters}
              canEdit={canEdit}
              onChanged={() => { void refresh(); refetchLinks(); }}
            />
          ) : (
            <>
            {stage.id === FICHE_STAGE && (
              <FichePanel
                view={fiche.view}
                fileUrl={fiche.view?.document ? api.ficheFileUrl(receipt.id, fiche.view.document.uploadedAt) : undefined}
                busy={fiche.busy}
                progress={fiche.progress}
                loaded={fiche.loaded}
                error={fiche.error}
                onRetry={fiche.retry}
                onDismissError={fiche.dismissError}
                canEdit={canEdit && !receipt.lockedAt && !lockedMessage}
                values={values}
                // What was typed but not yet sent is saved first, so what the fiche replaces is what the person really had.
                onUpload={(file) => void flushStage(receipt.id, stage.id).then(() => fiche.upload(file))}
                onReread={() => void fiche.reread()}
                onUse={(picked) => {
                  for (const [label, s] of Object.entries(picked)) onFieldChange(label, s.value);
                  void flushStage(receipt.id, stage.id);
                }}
                // The person accepted a town that isn't in Origins: the master's own checks (a second spelling is refused) decide.
                onAddOrigin={async (name) => {
                  const added = (await api.createOrigin(name)) as { name: string };
                  onFieldChange("ORIGIN", added.name);
                  await flushStage(receipt.id, stage.id);
                  // The full refresh, not refreshMasters: that one skips a re-read made moments ago, and the new town must show.
                  await refresh();
                }}
              />
            )}
            <StageForm
              stage={stage}
              values={values}
              derived={derived[stage.id]}
              suggestions={suggestions}
              choices={{ ...(stage.id === "n-bin" ? { "Bin Number": binOptions } : {}), ...warehouseFieldChoices(stage.id, masters.warehouses), ...otherActivityChoices(stage.id, binOptions, masters.warehouses), ...arrivalFieldChoices(stage.id, values, masters), ...originFieldProps(stage.id, values, masters.origins).choices }}
              onChoicesOpen={refreshMasters}
              issues={rules.issuesOf(stage.id)}
              lockedMessage={lockedMessage}
              warnings={stage.id === "n-bin" ? (binWarning ? { "Bin Number": binWarning } : undefined) : originFieldProps(stage.id, values, masters.origins).warnings}
              onFieldChange={onFieldChange}
              onFieldBlur={mine ? undefined : () => flushStage(receipt.id, stage.id)}
              readOnly={!canEdit || (Boolean(receipt.lockedAt) && LOCKED_STAGES.has(stage.id)) || (stage.id === "n-bin" && (binFinalised || !receipt.lotNo))}
              editable={mine ? submission.editableIn(stage.id) : undefined}
              notes={transferNotes || sentNotes ? { ...transferNotes, ...sentNotes } : undefined}
              typed={typedLabelsOnRecord(receipt, stage.id)}
              hidden={hiddenFields}
            />
            {receipt.transfer && <TransferDifferences rows={differences} from={receipt.transfer.fromWarehouse} />}
            </>
          )}
          {stage.id === "n-bin" && straightToProduction && !(values["Bin Number"] ?? "").trim() && (
            <p role="status" className="mb-3 flex items-start gap-2 rounded-xl border border-warmstone-200 bg-warmstone-100 px-3 py-2 text-[13px] text-warmstone-800">
              <span className="material-symbols-outlined text-[18px] text-warmstone-500">precision_manufacturing</span>
              No Bin: this truck was sent straight to production from the drying yard. Its GRN can be completed without one.
            </p>
          )}
          {/* The server refuses a Bin before a Lot (assertLotBeforeBin), and a refused save reloads over the pick —
              so the field is locked until the Lot exists, and says why instead of silently emptying. */}
          {stage.id === "n-bin" && canEdit && !receipt.lotNo && (
            <p className="mt-3 text-[12px] text-ambernut-700 font-semibold">
              A Bin can only be allocated once this truck has a Lot Number. The Lot is issued when the truck passes the quality check (QFS).
            </p>
          )}
          {/* The Branch Manager sets the price here directly; an Admin edits it in the form above like any field. */}
          {stage.id === "n-grn" && canSetPrice(me.role) && !canEdit && (
            <PricePanel receipt={receipt} onSaved={() => void refresh()} />
          )}
          {stage.id === "n-bin" && canEdit && !binFinalised && !receipt.lockedAt && Boolean(receipt.lotNo && receipt.stageData["n-bin"]?.["Bin Number"]) && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                icon="task_alt"
                disabled={finaliseBusy || !(receipt.stageData["n-bin"]?.[FINALISED_WHEN_LABEL] ?? "").trim()}
                onClick={() => {
                  setFinaliseBusy(true); setFinaliseError(null);
                  // The step's own edits (the Same day / Next day just picked) reach the server before Finalise reads them.
                  flushStage(receipt.id, stage.id)
                    .then(() => api.finaliseBin(receipt.id)).then(() => refresh())
                    .catch((e) => setFinaliseError(e instanceof Error ? e.message : String(e))).finally(() => setFinaliseBusy(false));
                }}
              >
                Finalise bin allocation
              </Button>
              <span className="text-[12px] text-warmstone-500">
                {(receipt.stageData["n-bin"]?.[FINALISED_WHEN_LABEL] ?? "").trim()
                  ? "Stamps today's date and your name. After this the bin step is closed until an Admin reopens it."
                  : "Choose Same day or Next day above first."}
              </span>
              {/* Shown here, by the button: the page's lock banner only appears once the Bin IS finalised. */}
              {finaliseError && <span role="alert" className="w-full text-[12px] text-danger-700">{finaliseError}</span>}
            </div>
          )}
          {branchOptions && stage.id !== "n-drying" && (
            <div className="mt-4">
              <DecisionBranch
                branches={branchOptions} chosen={chosen} onChoose={(b) => setBranch(receipt.id, stage.id, b)}
                readOnly={!canEdit || Boolean(lockedMessage) || (Boolean(receipt.lockedAt) && LOCKED_DECISIONS.has(stage.id))}
                unavailable={
                  stage.id === "n-xferdec" && readinessGaps.length ? ["production"]
                    : stage.id === "n-qfs" && passReason ? ["pass"] : undefined
                }
                notice={
                  stage.id === "n-xferdec" && canEdit ? productionReadinessNotice(readinessGaps)
                    : stage.id === "n-qfs" && (mine || (canEdit && !lockedMessage)) ? passReason : undefined
                }
              />
            </div>
          )}
        </div>
      </div>
    </details>
  );
}
