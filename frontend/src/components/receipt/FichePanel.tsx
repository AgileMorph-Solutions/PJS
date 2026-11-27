import { useRef, useState, type ReactNode } from "react";
import type { FicheOriginHint, FichePlaceLevel, FicheSuggestion, FicheView } from "@anagroci/contract/domain/fiche";
import { FICHE_FILLED_FIELDS, FICHE_GUESSED_FIELDS } from "@anagroci/contract/domain/fiche";
import { formatDateTime } from "@anagroci/contract/domain/dateFormat";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { ProgressBar } from "../ui/ProgressBar";
import type { FicheBusy, FicheError, FicheProgress } from "../../state/useFiche";

interface Props {
  view: FicheView | null;
  /** The URL the kept file is served at (api.ficheFileUrl), or undefined when none is kept. */
  fileUrl?: string;
  busy: FicheBusy;
  /** Where an upload has got to, while one is going. */
  progress: FicheProgress | null;
  /** False until the fiche has been asked for: nothing is offered over a fiche not seen yet. */
  loaded: boolean;
  error: FicheError | null;
  /** Does again what failed (the same file, the read, or loading the fiche). */
  onRetry: () => void;
  onDismissError: () => void;
  /** Upload / replace / use values. False shows the kept fiche only (a locked record, or someone who can't edit the step). */
  canEdit: boolean;
  /** The step's current values, compared with what the fiche says. */
  values: Record<string, string>;
  onUpload: (file: File) => void;
  onReread: () => void;
  /** Puts these values into their fields (one field, or every field that differs from the fiche). */
  onUse: (values: Record<string, FicheSuggestion>) => void;
  /** Adds a town to Masters › Origins and puts it in ORIGIN: the person's answer to "not in Origins". Rejects with the master's reason. */
  onAddOrigin: (name: string) => Promise<void>;
}

const LABELS: Record<string, string> = { FICHE: "Fiche", "FICHE CODE": "CCA supplier code", "SUPPLIERS NAME": "Supplier", ORIGIN: "Origin" };

type RowState = "match" | "different" | "empty" | "unread";

/**
 * The CCA fiche on the Verify supplier documents step: the uploaded photo or PDF on the left, and on the right each field the
 * fiche fills, what the fiche says beside what the form says. The form follows the fiche (the server puts its values in on
 * upload); where that changed a value, the old one is shown with "Put back". A place not in Masters › Origins is only added
 * there by the person's own click (contract domain/fiche.ts).
 */
export function FichePanel({ view, fileUrl, busy, progress, loaded, error, onRetry, onDismissError, canEdit, values, onUpload, onReread, onUse, onAddOrigin }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const doc = view?.document ?? null;
  const reading = doc?.reading ?? null;
  const offered = view?.suggestions ?? {};
  const replaced = view?.replaced ?? {};
  const putBack = (label: string) => onUse({ [label]: { value: replaced[label]!, from: "before the fiche" } });

  const picker = (
    <input
      ref={input} type="file" accept="image/*,application/pdf" className="hidden"
      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onUpload(f); }}
    />
  );

  const problem = error && <ErrorNotice error={error} canRetry={canEdit || error.retry === "load"} busy={busy !== null} onRetry={onRetry} onDismiss={onDismissError} />;

  if (!loaded) {
    return canEdit ? (
      <p role="status" className="mb-4 flex items-center gap-2 text-[12px] text-warmstone-500">
        <span aria-hidden="true" className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
        Loading the fiche…
      </p>
    ) : null;
  }

  if (!doc) {
    // The fiche couldn't be loaded: say so, rather than offer to upload over one that may be there.
    if (error?.retry === "load") return <div className="mb-4">{problem}</div>;
    if (!canEdit) return null;
    return (
      <div className="mb-4 flex flex-wrap items-center gap-4 p-4 border border-dashed border-warmstone-300 rounded-2xl bg-warmstone-50/60">
        {picker}
        <span aria-hidden="true" className="material-symbols-outlined text-[28px] text-warmstone-400">document_scanner</span>
        <div className="min-w-0 flex-1">
          <h4 className="text-[13px] font-bold text-warmstone-900">Upload the CCA fiche</h4>
          <p className="text-[12px] text-warmstone-500 mt-0.5">A photo or a PDF scan. The form is filled in from it: fiche number, CCA supplier code, supplier and origin.</p>
        </div>
        {busy === null && (
          <Button variant="secondary" icon="upload" onClick={() => input.current?.click()}>Upload fiche</Button>
        )}
        {progress && <div className="basis-full"><UploadProgress progress={progress} /></div>}
        {problem && <div className="basis-full">{problem}</div>}
      </div>
    );
  }

  const rows = FICHE_FILLED_FIELDS.map((label) => {
    const fromFiche = offered[label];
    const inForm = (values[label] ?? "").trim();
    const state: RowState = !fromFiche ? "unread" : !inForm ? "empty" : inForm === fromFiche.value ? "match" : "different";
    return { label, fromFiche, inForm, state };
  });
  const toFix = Object.fromEntries(rows.filter((r) => r.fromFiche && (r.state === "empty" || r.state === "different")).map((r) => [r.label, r.fromFiche!]));
  const fixCount = Object.keys(toFix).length;
  const readable = reading?.isCcaTransferFiche && !doc.readError;
  // Origin is the person's (contract domain/fiche.ts): shown here, set only by its own click, never by "Use all".
  const originHint = view?.originHint ?? null;

  return (
    <div className="mb-4 bg-white border border-warmstone-200 rounded-2xl shadow-xs overflow-hidden">
      {picker}
      <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-3 border-b border-warmstone-100">
        <div className="min-w-0 flex-1">
          <h4 className="text-[13px] font-bold text-warmstone-900">CCA fiche</h4>
          <p className="text-[11px] text-warmstone-500 mt-0.5 truncate">
            {doc.fileName} · {formatDateTime(doc.uploadedAt)}{doc.uploadedBy ? ` · ${doc.uploadedBy}` : ""}
          </p>
        </div>
        {canEdit && <Button variant="secondary" icon="upload" disabled={busy !== null} onClick={() => input.current?.click()}>Replace fiche</Button>}
      </div>

      <div className="grid md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-5 p-5">
        <FilePreview url={fileUrl} mimeType={doc.mimeType} fileName={doc.fileName} />

        <div className="min-w-0 space-y-3">
          {problem}
          {progress ? (
            <UploadProgress progress={progress} />
          ) : busy === "read" ? (
            <p role="status" className="flex items-center gap-2 text-[13px] text-warmstone-700">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
              Reading the fiche…
            </p>
          ) : doc.readError ? (
            <Notice text={doc.readError} action={canEdit ? <Button variant="secondary" icon="refresh" onClick={onReread}>Read again</Button> : null} />
          ) : !reading ? (
            <Notice text="This fiche hasn't been read yet." action={canEdit ? <Button variant="secondary" icon="refresh" onClick={onReread}>Read the fiche</Button> : null} />
          ) : !reading.isCcaTransferFiche ? (
            <Notice text="This isn't a CCA Fiche de Transfert, so nothing was read. Check you uploaded the right document." />
          ) : reading.subPrefecture === undefined && canEdit ? (
            // Read before the fiche's places were asked for (20 Nov 2026): reading it again adds the Origin row.
            <Notice text="Read this fiche again to see where it says the RCN came from." action={<Button variant="secondary" icon="refresh" onClick={onReread}>Read again</Button>} />
          ) : null}

          {readable && busy === null && (
            <>
              {(view?.filled?.length ?? 0) > 0 && (
                <p className="flex items-start gap-1.5 text-[12px] font-semibold text-success-700">
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">check_circle</span>
                  Filled in from the fiche: {view!.filled!.map((l) => LABELS[l] ?? l).join(", ")}. Check them against the photo.
                </p>
              )}
              {Object.keys(replaced).length > 0 && (
                <p className="flex items-start gap-1.5 text-[12px] font-semibold text-ambernut-700">
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">info</span>
                  The fiche differs from what the form had for {Object.keys(replaced).map((l) => LABELS[l] ?? l).join(", ")}. The old value is shown below; put it back if the fiche is wrong.
                </p>
              )}
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-warmstone-500">
                    <th className="pb-2 font-bold">Field</th>
                    <th className="pb-2 font-bold">On the fiche</th>
                    <th className="pb-2 font-bold">In the form</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-warmstone-100">
                  {rows.map((r) => (
                    <tr key={r.label} className="align-top">
                      <td className="py-2 pr-3 text-warmstone-700 font-semibold whitespace-nowrap">{LABELS[r.label]}</td>
                      <td className="py-2 pr-3 font-medium text-warmstone-900 tabular-nums">
                        {r.fromFiche?.value ?? <span className="font-normal text-warmstone-500">{r.label === "SUPPLIERS NAME" ? "Not known yet" : "Couldn't read"}</span>}
                        {/* Not printed on the fiche: say where it came from, so it isn't taken for what the paper says. */}
                        {r.fromFiche && FICHE_GUESSED_FIELDS.includes(r.label) && <p className="mt-0.5 text-[11px] font-normal text-warmstone-500">From earlier trucks with CCA code {offered["FICHE CODE"]?.value ?? "-"}</p>}
                      </td>
                      <td className="py-2">
                        <FormCell state={r.state} inForm={r.inForm} canFix={canEdit} onFix={() => r.fromFiche && onUse({ [r.label]: r.fromFiche })} />
                        <WasCell was={replaced[r.label]} inForm={r.inForm} canFix={canEdit} onPutBack={() => putBack(r.label)} />
                      </td>
                    </tr>
                  ))}
                  {originHint && (
                    <OriginRow
                      hint={originHint} inForm={(values["ORIGIN"] ?? "").trim()} canFix={canEdit} was={replaced["ORIGIN"]}
                      onUse={(origin) => onUse({ ORIGIN: { value: origin, from: "the fiche" } })} onPutBack={() => putBack("ORIGIN")} onAdd={onAddOrigin}
                    />
                  )}
                </tbody>
              </table>

              {rows.find((r) => r.label === "SUPPLIERS NAME")?.state === "unread" && (
                <p className="text-[12px] text-warmstone-500">
                  No earlier truck used this CCA supplier code, so pick the supplier in the form below{reading?.storeName ? ` (the fiche names the store ${reading.storeName})` : ""}.
                </p>
              )}

              {canEdit && fixCount > 1 && (
                <Button icon="auto_fix_high" onClick={() => onUse(toFix)}>Use all {fixCount} values from the fiche</Button>
              )}
              {fixCount === 0 && rows.some((r) => r.state === "match") && (
                <p className="flex items-center gap-1.5 text-[12px] font-semibold text-success-700">
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">check_circle</span>
                  The form matches the fiche.
                </p>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  );
}

/** The uploaded file itself: a photo shown whole, a PDF in the browser's own viewer. Click to open it full size. */
function FilePreview({ url, mimeType, fileName }: { url?: string; mimeType: string; fileName: string }) {
  if (!url) return null;
  return (
    <div className="space-y-1.5">
      <div className="h-80 rounded-xl border border-warmstone-200 bg-warmstone-50 overflow-hidden">
        {mimeType === "application/pdf" ? (
          <iframe src={`${url}#toolbar=0&navpanes=0&view=FitH`} title={`Fiche: ${fileName}`} className="w-full h-full" />
        ) : (
          <a href={url} target="_blank" rel="noreferrer" aria-label={`Open ${fileName} full size`}>
            <img src={url} alt="The uploaded fiche" className="w-full h-full object-contain" />
          </a>
        )}
      </div>
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:text-brand-800">
        <span aria-hidden="true" className="material-symbols-outlined text-[16px]">open_in_new</span>
        Open full size
      </a>
    </div>
  );
}

function FormCell({ state, inForm, canFix, onFix }: { state: RowState; inForm: string; canFix: boolean; onFix: () => void }) {
  const fix = (label: string) => canFix && (
    <button type="button" onClick={onFix} className="ml-2 text-[12px] font-semibold text-brand-700 hover:text-brand-800">{label}</button>
  );
  switch (state) {
    case "match":
      return (
        <span className="inline-flex items-center gap-1 text-success-700 font-medium tabular-nums">
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">check_circle</span>{inForm}
        </span>
      );
    case "different":
      return (
        <span className="inline-flex flex-wrap items-center gap-1 text-ambernut-700 font-medium tabular-nums">
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">error</span>{inForm}
          <span className="font-normal">· different</span>
          {fix("Use the fiche's")}
        </span>
      );
    case "empty":
      return <span className="text-warmstone-500">Empty{fix("Fill in")}</span>;
    default:
      return <span className="text-warmstone-800 tabular-nums">{inForm || "-"}</span>;
  }
}

/** What a field held before the fiche's value went in, while the form still differs from it: "was X · Put back". */
function WasCell({ was, inForm, canFix, onPutBack }: { was?: string; inForm: string; canFix: boolean; onPutBack: () => void }) {
  if (!was || was === inForm) return null;
  return (
    <span className="mt-0.5 block text-[11px] text-warmstone-500">
      Was <span className="font-medium text-warmstone-700">{was}</span> before the fiche
      {canFix && <button type="button" onClick={onPutBack} className="ml-2 text-[12px] font-semibold text-brand-700 hover:text-brand-800">Put back</button>}
    </span>
  );
}

const LEVEL_WORD: Record<FichePlaceLevel, string> = { "Sub-prefecture": "sub-prefecture", Department: "department", Village: "village" };

/**
 * Origin: the fiche's places beside the form's Origin. A town in Masters › Origins is filled in like the other fields; one
 * letter off is asked as "did you mean"; a place not in Origins is warned about, and the person may add it to the master and
 * use it — never done without that click.
 */
function OriginRow({ hint, inForm, canFix, was, onUse, onPutBack, onAdd }: {
  hint: FicheOriginHint; inForm: string; canFix: boolean; was?: string;
  onUse: (origin: string) => void; onPutBack: () => void; onAdd: (name: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  // Said once the town is in the master: the row then reads as any matched Origin, and this says what just happened.
  const [added, setAdded] = useState<string | null>(null);
  const said = hint.places.map((p) => `${LEVEL_WORD[p.level]} ${p.name}`).join(" · ");
  const m = hint.match;
  const state: RowState = !m || !m.exact ? "unread" : !inForm ? "empty" : inForm === m.origin ? "match" : "different";
  const add = (name: string) => {
    setAdding(name); setAddError(null); setAdded(null);
    onAdd(name).then(() => setAdded(name), (e) => setAddError(e instanceof Error ? e.message : String(e))).finally(() => setAdding(null));
  };
  return (
    <tr className="align-top">
      <td className="py-2 pr-3 text-warmstone-700 font-semibold whitespace-nowrap">Origin</td>
      <td className="py-2 pr-3">
        {m?.exact
          ? <span className="font-medium text-warmstone-900">{m.origin}</span>
          : <span className="font-medium text-warmstone-900">{hint.places[0]!.name}</span>}
        <p className="text-[11px] text-warmstone-500 mt-0.5">Fiche says {said}</p>
      </td>
      <td className="py-2">
        {m?.exact ? (
          <>
            <FormCell state={state} inForm={inForm} canFix={canFix} onFix={() => onUse(m.origin)} />
            <WasCell was={was} inForm={inForm} canFix={canFix} onPutBack={onPutBack} />
            {added && (
              <p role="status" className="flex items-start gap-1 mt-1 text-[12px] font-semibold text-success-700">
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">check_circle</span>
                Added {added} to Masters › Origins and used it.
              </p>
            )}
          </>
        ) : (
          <div className="space-y-1">
            <span className="text-warmstone-800">{inForm || "Empty"}</span>
            <p className="flex items-start gap-1 text-[12px] font-semibold text-ambernut-700">
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">warning</span>
              Not in Masters › Origins.
            </p>
            {canFix && m && (
              <button type="button" onClick={() => onUse(m.origin)} className="block text-[12px] font-semibold text-brand-700 hover:text-brand-800">
                Did you mean {m.origin}? Use it
              </button>
            )}
            {/* Only the place that is the Origin (the village, or what stands in for a blank one) — see ficheOriginHint. */}
            {canFix && (() => {
              const name = hint.places[0]!.name;
              return (
                <button
                  type="button" disabled={adding !== null} onClick={() => add(name)}
                  className="block text-left text-[12px] font-semibold text-brand-700 hover:text-brand-800 disabled:opacity-50"
                >
                  {adding === name ? `Adding ${name}…` : `Add ${name} to Origins and use it`}
                </button>
              );
            })()}
            {addError && <p role="alert" className="text-[12px] text-danger-700">{addError}</p>}
          </div>
        )}
      </td>
    </tr>
  );
}

function Notice({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="flex items-start gap-1.5 text-[12px] font-semibold text-ambernut-700">
        <span aria-hidden="true" className="material-symbols-outlined text-[16px]">info</span>{text}
      </p>
      {action}
    </div>
  );
}

/** How far along each step of an upload is, as a share of the whole bar: reading the fiche takes the last stretch. */
const PROGRESS_STEPS: Record<FicheProgress["phase"], { label: string; from: number; to: number }> = {
  preparing: { label: "Getting the photo ready…", from: 0, to: 5 },
  sending: { label: "Uploading", from: 5, to: 80 },
  reading: { label: "Uploaded. Reading the fiche… this can take up to a minute.", from: 85, to: 85 },
};

/** The upload's progress bar (26 Nov 2026, user): measured while the file is sent, then held while the server reads it. */
function UploadProgress({ progress }: { progress: FicheProgress }) {
  const step = PROGRESS_STEPS[progress.phase];
  const sent = progress.phase === "sending" ? progress.sent : 0;
  const pct = Math.round(step.from + (step.to - step.from) * sent);
  return (
    <div role="status" className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-[12px] text-warmstone-700">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
          {progress.phase === "sending" ? `${step.label}… ${Math.round(sent * 100)}%` : step.label}
        </span>
        <span className="tabular-nums text-warmstone-500">{pct}%</span>
      </div>
      <ProgressBar value={pct} max={100} label="Fiche upload" />
    </div>
  );
}

/** What went wrong, with "Try again" when doing it again can help (not for a file of the wrong kind: another file is the fix). */
function ErrorNotice({ error, canRetry, busy, onRetry, onDismiss }: { error: FicheError; canRetry: boolean; busy: boolean; onRetry: () => void; onDismiss: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-start gap-3 rounded-xl border border-danger-200 bg-danger-50 px-3 py-2.5">
      <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-danger-700">error</span>
      <p className="min-w-[12rem] flex-1 text-[12px] text-danger-700">{error.message}</p>
      {error.retry && canRetry && <Button variant="secondary" icon="refresh" disabled={busy} onClick={onRetry}>Try again</Button>}
      <IconButton icon="close" label="Dismiss this message" onClick={onDismiss} />
    </div>
  );
}
