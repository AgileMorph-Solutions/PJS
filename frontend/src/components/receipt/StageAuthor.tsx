import type { FieldChangeRecord } from "@anagroci/contract/types/receipt";
import { formatDateTime } from "@anagroci/contract/domain/dateFormat";
import { Avatar } from "../ui/Avatar";

/** How the first values got in decides the label. An approved form names its submitter in `by` (and the approver in
 * `approvedBy`); only an approval logged before that link existed has just the approver, so it says so. */
const labelFor = (c: FieldChangeRecord) =>
  c.via === "import" ? "Uploaded" : c.via === "approval" && !c.approvedBy ? "Approved" : "Entered";

/** Display names carry the role and site in brackets ("Koné Seydou (QFS Officer, Bouaké)"): the name reads bold, the rest muted. */
function splitName(display: string) {
  const m = /^(.*?)\s*\((.+)\)$/.exec(display);
  return m ? { name: m[1]!, detail: m[2]! } : { name: display, detail: "" };
}

function Person({ label, who, at }: { label: string; who: string; at?: string }) {
  const { name, detail } = splitName(who);
  const sub = [detail, at && formatDateTime(at)].filter(Boolean).join(" · ");
  return (
    <>
      <dt className="pt-px text-[10px] font-bold uppercase tracking-wider text-warmstone-400">{label}</dt>
      <dd className="min-w-0">
        <div className="text-[12.5px] font-semibold text-warmstone-800 truncate">{name}</div>
        {sub && <div className="text-[11px] text-warmstone-400 tabular-nums truncate">{sub}</div>}
      </dd>
    </>
  );
}

/**
 * Who filled this step in, who approved it, and who last touched it, for a stage card's header — from the same change log
 * as the History tab (`changes` is this stage's rows, newest first; `values` the stage as it stands). Renders nothing for a
 * stage with no logged edits, e.g. one imported before the log existed: there is no "who" to show, and guessing one would be
 * inventing it.
 */
export function StageAuthor({ changes, values }: { changes: FieldChangeRecord[]; values: Record<string, string> }) {
  if (changes.length === 0) return null;
  const latest = changes[0]!;
  const first = changes[changes.length - 1]!;
  // The oldest logged change is only the entry if the log saw the whole step being filled in. A seeded truck's values
  // predate the log, so a later one-field correction must not be shown as "Entered by" whoever made it.
  const logged = new Set(changes.map((c) => c.label));
  const entryOnRecord = Object.entries(values).every(([label, v]) => v.trim() === "" || logged.has(label));
  if (!entryOnRecord) {
    return (
      <>
        <div className="hidden sm:flex items-start gap-3 shrink-0 max-w-80 pl-4 border-l border-warmstone-100">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 items-baseline">
            <Person label="Last edit" who={latest.by} at={latest.at} />
            {latest.approvedBy && <Person label="Approved" who={latest.approvedBy} />}
          </dl>
          <Avatar name={latest.by} size="md" />
        </div>
        <p className="sm:hidden basis-full pl-11.5 -mt-2 text-[11px] text-warmstone-500">
          Last edit by <span className="font-semibold text-warmstone-700">{splitName(latest.by).name}</span> · {formatDateTime(latest.at)}
        </p>
      </>
    );
  }
  // Several fields saved together share a minute and a person; that's the first entry again, not a later edit.
  const laterEdit = latest.by !== first.by || formatDateTime(latest.at) !== formatDateTime(first.at);

  return (
    <>
      <div className="hidden sm:flex items-start gap-3 shrink-0 max-w-80 pl-4 border-l border-warmstone-100">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 items-baseline">
          <Person label={labelFor(first)} who={first.by} at={first.at} />
          {first.approvedBy && <Person label="Approved" who={first.approvedBy} />}
          {laterEdit && <Person label="Last edit" who={latest.by} at={latest.at} />}
        </dl>
        <Avatar name={first.by} size="md" />
      </div>
      {/* No room for a right-hand column on a phone: one line under the phase instead. */}
      <p className="sm:hidden basis-full pl-11.5 -mt-2 text-[11px] text-warmstone-500">
        {labelFor(first)} by <span className="font-semibold text-warmstone-700">{splitName(first.by).name}</span> · {formatDateTime(first.at)}
        {first.approvedBy && <> · approved by {splitName(first.approvedBy).name}</>}
      </p>
    </>
  );
}
