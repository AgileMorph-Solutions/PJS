import { stages } from "../data/stages";
import { useTracking } from "../state/TrackingContext";
import { Pill } from "./ui/Pill";
import { Button } from "./ui/Button";
import { ProgressBar } from "./ui/ProgressBar";
import type { SubmissionDraft } from "./receipt/useSubmissionDraft";

const STATUS: Record<string, { label: string; tone: string }> = {
  submitted: { label: "Waiting for approval", tone: "decision" },
  approved: { label: "Approved", tone: "entry" },
  rejected: { label: "Rejected", tone: "gap" },
};

/** Opens a stage card and brings it into view (StageCard's own id), so "Go to" lands on the boxes to fill. */
function goTo(stageId: string) {
  const card = document.getElementById(`stage-${stageId}`) as HTMLDetailsElement | null;
  if (!card) return;
  card.open = true;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * The Branch Manager / QFS Officer's form, as a short checklist above the stage cards (team, 23 Nov 2026: the long list of
 * every empty field read as noise). They type their fields in the same cards everyone uses (useSubmissionDraft); this says
 * how far along they are, which step still has boxes to fill (with a jump to it), and submits for the Warehouse Incharge
 * to approve. After an approval what is still empty can be sent again; one waiting holds it; a rejection is final.
 */
export function SubmissionCard({ submission }: { submission: SubmissionDraft }) {
  const { refresh } = useTracking();
  const { form, existing, latest, typed, busy, error } = submission;
  if (!form) return null;
  const status = latest ? STATUS[latest.status] : undefined;

  // Per step of the form: the boxes this person fills (calculated ones aside), how many are done, how many still empty.
  const steps = form.stages.map((s) => {
    const title = stages.find((x) => x.id === s.stageId)?.title ?? s.stageId;
    const empty = submission.editableIn(s.stageId);
    const recorded = s.labels.filter((l) => submission.lockedForMe(s.stageId, l)).length;
    const typedHere = typed.filter((t) => t.stageId === s.stageId).length;
    return { stageId: s.stageId, title, total: recorded + empty.length, done: recorded + typedHere, left: empty.length - typedHere };
  });
  const total = steps.reduce((a, s) => a + s.total, 0);
  const done = steps.reduce((a, s) => a + s.done, 0);
  const waiting = existing?.status === "submitted";
  const rejected = existing?.status === "rejected";
  const canSubmit = !existing && steps.some((s) => s.total > s.done || typed.length > 0);

  return (
    <div className="bg-white border border-warmstone-200 rounded-2xl shadow-xs">
      <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-3">
        <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-brand-700">edit_note</span>
        <h2 className="min-w-0 flex-1 text-[15px] font-bold text-warmstone-900">{form.title}</h2>
        {status && <Pill tone={status.tone} label={status.label} />}
      </div>

      <div className="px-5 pb-5 space-y-4">
        {/* How far along: the boxes on the form, recorded or typed, out of all of them. Not while it waits or was rejected:
            then nothing is the person's to fill and the count would mislead. */}
        {!existing && <div className="space-y-1.5">
          <div className="flex items-baseline justify-between text-[12px]">
            <span className="font-semibold text-warmstone-700">Your form</span>
            <span className="tabular-nums text-warmstone-600">{done} of {total} filled</span>
          </div>
          <ProgressBar value={done} max={total} label="Fields filled on your form" />
        </div>}

        {waiting ? (
          <p role="status" className="text-[13px] text-warmstone-800">Sent. The Warehouse Incharge is checking it — you'll be able to fill anything still empty once it is approved.</p>
        ) : rejected ? (
          <p role="status" className="text-[13px] text-danger-700">
            Rejected{existing!.reviewedBy ? ` by ${existing!.reviewedBy}` : ""}: {existing!.rejectReason}. It can't be sent again — ask the Warehouse Incharge to correct the truck.
          </p>
        ) : done >= total ? (
          <p role="status" className="text-[13px] text-success-700">Everything on your form is recorded. Nothing more to do here.</p>
        ) : (
          <>
            <ol className="grid sm:grid-cols-3 gap-2 text-[12px] text-warmstone-700">
              <li className="flex gap-2"><span className="font-bold text-brand-700">1</span>Fill the empty boxes in the steps below.</li>
              <li className="flex gap-2"><span className="font-bold text-brand-700">2</span>Click Submit for approval.</li>
              <li className="flex gap-2"><span className="font-bold text-brand-700">3</span>The Warehouse Incharge checks and applies it.</li>
            </ol>
            <ul className="divide-y divide-warmstone-100 border border-warmstone-200 rounded-xl">
              {steps.filter((s) => s.total > 0).map((s) => (
                <li key={s.stageId} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                  <span aria-hidden="true" className={`material-symbols-outlined text-[18px] ${s.left > 0 ? "text-ambernut-600" : "text-success-600"}`}>
                    {s.left > 0 ? "radio_button_unchecked" : "check_circle"}
                  </span>
                  <span className="min-w-0 flex-1 font-medium text-warmstone-900">{s.title}</span>
                  <span className="tabular-nums text-warmstone-600">{s.left > 0 ? `${s.left} to fill` : "Done"}</span>
                  {s.left > 0 && (
                    <button type="button" onClick={() => goTo(s.stageId)} className="text-[12px] font-semibold text-brand-700 hover:text-brand-800">Go to</button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {canSubmit && (
          <div className="flex flex-wrap items-center gap-3">
            <Button icon="send" disabled={busy || typed.length === 0} onClick={() => void submission.submit(refresh)}>
              {busy ? "Submitting…" : `Submit for approval${typed.length ? ` (${typed.length})` : ""}`}
            </Button>
            {typed.length === 0 && <span className="text-[12px] text-warmstone-500">Fill in at least one box to submit.</span>}
          </div>
        )}
        {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}

        <p className="flex items-center gap-1.5 text-[12px] text-warmstone-500 border-t border-warmstone-100 pt-3">
          <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-warmstone-400">lock</span>
          Values already recorded are locked. To change one, ask the Warehouse Incharge or an Admin.
        </p>
      </div>
    </div>
  );
}
