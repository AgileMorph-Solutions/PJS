import { useMemo, useState } from "react";
import type { Stage } from "../types/stage";
import { fieldShortLabel, isNumericField, issuesByLabel, recordIssues } from "@anagroci/contract/domain/fieldRules";
import { formatDate, formatDateTime, todayIso } from "@anagroci/contract/domain/dateFormat";
import { StageForm } from "./StageForm";
import { CollapsibleCard } from "./ui/CollapsibleCard";
import { DataTable, type Column } from "./ui/DataTable";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";

/** One saved entry: its values by field label, and who entered and last changed it. */
export interface LedgerEntry {
  id: number;
  values: Record<string, string>;
  enteredBy: string | null;
  enteredAt: string;
  editedBy: string | null;
  editedAt: string;
}

interface Props {
  /** The stage whose fields each entry holds (stages.ts): the form and the table's columns. */
  stage: Stage;
  /** Most recent first. */
  entries: LedgerEntry[];
  /** What a new entry starts with (now, this Bin, this warehouse): shown filled in and changeable. Called for each new entry. */
  defaults?: () => Record<string, string>;
  /** Closed lists per field: a searchable dropdown. */
  choices?: Record<string, readonly string[]>;
  onChoicesOpen?: () => void;
  /** A line under a field, in place of the stage's own note. */
  notes?: Record<string, string>;
  canEdit: boolean;
  /** Saves a new entry. Rejects with the server's reason. */
  onAdd: (fields: Record<string, string>) => Promise<void>;
  /** Saves the fields of an entry that changed. Rejects with the server's reason. */
  onUpdate: (id: number, fields: Record<string, string>) => Promise<void>;
  /** Rows per page of the table. */
  pageSize?: number;
}

const cell = (format: Stage["fields"][number]["format"], v: string | undefined) =>
  !v?.trim() ? "-" : format === "datetime" ? formatDateTime(v) : format === "date" ? formatDate(v) : v;

/**
 * A stage kept as a ledger (26 Nov 2026, user: "saved as a ledger, multiple entries in a table below with pagination"): a form
 * for a new entry, drawn by StageForm from the stage's own fields, and every entry so far in a table under it, most recent
 * first. Picking an entry's edit button loads it into the form to change it. Generic over the stage, so any stage that is
 * recorded many times over (a Bin's other activities, its activity ledger) uses this one component.
 */
export function StageEntryLedger({ stage, entries, defaults, choices, onChoicesOpen, notes, canEdit, onAdd, onUpdate, pageSize = 10 }: Props) {
  const fresh = () => defaults?.() ?? {};
  // What the form started from — the defaults of a new entry, or the entry being changed — kept, since "now" moves on.
  const [base, setBase] = useState<Record<string, string>>(fresh);
  const [draft, setDraft] = useState<Record<string, string>>(base);
  const [editing, setEditing] = useState<LedgerEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const issues = useMemo(() => issuesByLabel(recordIssues({ [stage.id]: draft }, { today: todayIso() }), stage.id), [draft, stage.id]);

  const start = (entry: LedgerEntry | null) => {
    const from = entry ? { ...entry.values } : fresh();
    setEditing(entry);
    setBase(from);
    setDraft(from);
    setError(null);
  };
  // A new entry needs something of the person's own, not only what it starts with; a change needs a field that changed.
  const changed = Object.fromEntries(Object.entries(draft).filter(([label, v]) => (base[label] ?? "").trim() !== v.trim()));
  const toSend = editing ? changed : Object.fromEntries(Object.entries(draft).filter(([, v]) => v.trim() !== ""));
  const ready = Object.keys(changed).length > 0;

  async function save() {
    setBusy(true); setError(null);
    try {
      if (editing) await onUpdate(editing.id, toSend); else await onAdd(toSend);
      start(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Short headings, the full label on hover (26 Nov 2026, user: the table was far too wide), and only the fields some entry
  // has filled in: a column that is blank on every row says nothing and pushes the rest off the screen.
  const used = stage.fields.filter((f) => entries.some((e) => (e.values[f.n] ?? "").trim() !== ""));
  const columns: Column<LedgerEntry>[] = [
    ...used.map((f): Column<LedgerEntry> => ({
      label: fieldShortLabel(stage.id, f.n),
      title: f.label ?? f.n,
      nowrap: f.format === "datetime" || f.format === "date",
      align: isNumericField(stage.id, f.n) ? "right" : undefined,
      render: (e) => cell(f.format, e.values[f.n]),
      filter: { value: (e) => e.values[f.n] ?? "" },
    })),
    {
      label: "Entered",
      title: "Who entered it and when; who last changed it",
      nowrap: true,
      render: (e) => (
        <span className="text-[12px] text-warmstone-500">
          {e.enteredBy ?? "-"}<br />{formatDateTime(e.enteredAt)}
          {e.editedBy && e.editedAt !== e.enteredAt ? <><br />changed by {e.editedBy}</> : null}
        </span>
      ),
    },
    ...(canEdit ? [{ label: "", render: (e: LedgerEntry) => <IconButton icon="edit" label={`Change entry ${e.id}`} onClick={() => start(e)} /> }] : []),
  ];

  return (
    <CollapsibleCard title={stage.title} meta={`${entries.length} entr${entries.length === 1 ? "y" : "ies"} · ${stage.phase}`} defaultOpen>
      <div className="pt-3 space-y-5">
        {canEdit && (
          <form
            className="rounded-xl border border-warmstone-200 bg-warmstone-50/60 p-4 space-y-4"
            onSubmit={(e) => { e.preventDefault(); if (ready && !busy) void save(); }}
          >
            <h3 className="text-[13px] font-bold text-warmstone-900">{editing ? `Change the entry of ${formatDateTime(editing.enteredAt)}` : "New entry"}</h3>
            <StageForm
              stage={stage}
              values={draft}
              choices={choices}
              onChoicesOpen={onChoicesOpen}
              issues={issues}
              notes={notes}
              onFieldChange={(label, value) => setDraft((d) => ({ ...d, [label]: value }))}
            />
            {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
            <div className="flex items-center gap-3">
              {editing && <Button variant="secondary" onClick={() => start(null)}>Cancel</Button>}
              <Button type="submit" icon={editing ? "save" : "add"} disabled={busy || !ready}>
                {busy ? "Saving…" : editing ? "Save changes" : "Add entry"}
              </Button>
            </div>
          </form>
        )}
        <DataTable
          columns={columns}
          rows={entries}
          keyFn={(e) => String(e.id)}
          emptyTitle="No entries yet"
          emptyHint={canEdit ? "Fill in the form above and add the first one." : undefined}
          pageSize={pageSize}
        />
      </div>
    </CollapsibleCard>
  );
}
