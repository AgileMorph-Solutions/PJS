import { useEffect, useMemo, useRef, useState } from "react";
import type { Stage } from "../../types/stage";
import type { BinStageView } from "@anagroci/contract/domain/warehouseActivityStages";
import { issuesByLabel, recordIssues } from "@anagroci/contract/domain/fieldRules";
import { todayIso } from "@anagroci/contract/domain/dateFormat";
import { StageForm } from "../StageForm";
import { AuthorPanel } from "../receipt/StageAuthor";
import { nowStamp } from "../ui/DateTimeInput";

interface Props {
  stage: Stage;
  /** The Bin the form is on: the ledger's Linked Lot/Bin starts as it. */
  binCode: string;
  /** The form as saved; null when nobody has filled it in yet. */
  view: BinStageView | null;
  /** Closed lists per field (the Bins and warehouse codes of Other warehouse activities). */
  choices?: Record<string, readonly string[]>;
  onChoicesOpen?: () => void;
  canEdit: boolean;
  /** Saves the fields that changed. Rejects with the server's reason. */
  onSave: (fields: Record<string, string>) => Promise<void>;
}

/** The ledger's own notes on a Bin: the truck's speak of "this truck" and of a record that locks, neither true here. */
const LEDGER_NOTES: Record<string, string> = {
  "Date/time": "When it happened: now unless you change it. It can't be in the future.",
  Location: "Fills itself with this warehouse when saved.",
  "Linked Lot/Bin": "This Bin unless you pick another.",
  "Performed by": "Fills itself with your name when saved.",
};

/** How long after the last keystroke the changed fields are saved: one request for a burst of typing, not one per key. */
const SAVE_AFTER_MS = 700;

/**
 * One of a Bin's own forms — Other warehouse activities, or the Activity ledger (team, 23 Nov 2026) — drawn like a truck's
 * stage card: the stage's own fields through StageForm, saved as they are typed, with who entered and last changed it.
 */
export function BinStageCard({ stage, binCode, view, choices, onChoicesOpen, canEdit, onSave }: Props) {
  const saved = useMemo(() => view?.values ?? {}, [view]);
  // The ledger starts at now and at this Bin (team, 23 Nov 2026): shown filled in, changeable, saved with the rest.
  const withDefaults = (v: Record<string, string>) => (stage.id === "n-ledger"
    ? { ...v, "Date/time": v["Date/time"] || nowStamp(), "Linked Lot/Bin": v["Linked Lot/Bin"] || binCode }
    : v);
  const [draft, setDraft] = useState<Record<string, string>>(() => withDefaults(saved));
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What the server holds now replaces the draft once a save has come back (it may have filled the ledger's own fields).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(withDefaults(saved)), [saved]);

  // Only what the person typed is sent: a default the form shows on its own waits until they fill something else in.
  const typed = () => Object.fromEntries(Object.entries(draft).filter(([label, v]) => (saved[label] ?? "") !== v));
  const changed = () => {
    const fields = typed();
    const own = Object.keys(fields).some((l) => !(stage.id === "n-ledger" && (l === "Date/time" || l === "Linked Lot/Bin") && !saved[l]));
    return own ? fields : {};
  };
  function flush() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const fields = changed();
    if (!Object.keys(fields).length) return;
    setError(null);
    onSave(fields).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }
  useEffect(() => {
    if (!Object.keys(changed()).length) return;
    timer.current = setTimeout(flush, SAVE_AFTER_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const filled = Object.values(saved).some((v) => v.trim() !== "");
  const issues = useMemo(() => issuesByLabel(recordIssues({ [stage.id]: draft }, { today: todayIso() }), stage.id), [draft, stage.id]);

  return (
    <details open className="bg-white rounded-2xl overflow-hidden border border-warmstone-200 shadow-xs">
      <summary className="list-none cursor-pointer p-4.5 flex flex-wrap sm:flex-nowrap items-center gap-3.5 hover:bg-warmstone-50">
        <span className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center font-bold text-[13px] ${filled ? "bg-success-100 text-success-700 border border-success-200" : "bg-warmstone-100 text-warmstone-400"}`}>
          {filled ? <span className="material-symbols-outlined text-[18px]">check</span> : (stage.num ?? "•")}
        </span>
        <div className="min-w-0 flex-1">
          <span className="font-sans text-[13px] font-bold text-warmstone-900">{stage.title}</span>
          <p className="text-[12px] text-warmstone-500 mt-0.5">{stage.phase}</p>
        </div>
        <AuthorPanel
          entered={view?.enteredBy ? { by: view.enteredBy, at: view.enteredAt } : undefined}
          edited={view?.editedBy ? { by: view.editedBy, at: view.editedAt } : undefined}
        />
      </summary>
      <div className="px-5 pb-5 pt-4 border-t border-warmstone-100 bg-warmstone-50/60 space-y-3">
        <StageForm
          stage={stage}
          values={draft}
          choices={choices}
          onChoicesOpen={onChoicesOpen}
          issues={issues}
          notes={stage.id === "n-ledger" ? LEDGER_NOTES : undefined}
          onFieldChange={(label, value) => setDraft((d) => ({ ...d, [label]: value }))}
          onFieldBlur={flush}
          readOnly={!canEdit}
        />
        {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
      </div>
    </details>
  );
}
