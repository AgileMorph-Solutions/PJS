import { useMemo } from "react";
import type { FieldChangeRecord } from "@anagroci/contract/types/receipt";
import type { StageField } from "@anagroci/contract/types/stage";
import { formatDate, formatDateTime } from "@anagroci/contract/domain/dateFormat";
import { stages, rejectStage } from "../../data/stages";
import { DataTable, type Column } from "../ui/DataTable";
import { FilterBar } from "../ui/FilterBar";
import { Pill } from "../ui/Pill";
import { useTableSearch } from "../ui/useTableSearch";
import { useFieldChanges } from "../../state/TrackingContext";

const STAGES = new Map([...stages, rejectStage].map((s) => [s.id, s]));
const fieldOf = (c: FieldChangeRecord): StageField | undefined => STAGES.get(c.stageId)?.fields.find((f) => f.n === c.label);

const VIA: Record<FieldChangeRecord["via"], { label: string; tone: string }> = {
  direct: { label: "Edited", tone: "system" },
  approval: { label: "Approved form", tone: "decision" },
  import: { label: "Upload", tone: "term" },
};

/** Dates are stored ISO; show them the one way the app shows dates. Empty means the field was blank. */
function Value({ value, format, strike }: { value: string | null; format?: StageField["format"]; strike?: boolean }) {
  if (value === null || value === "") return <span className="italic text-warmstone-400">empty</span>;
  const shown = format === "date" ? formatDate(value) : format === "datetime" ? formatDateTime(value) : value;
  return <span className={strike ? "text-warmstone-500 line-through decoration-warmstone-300" : "font-semibold text-warmstone-900"}>{shown}</span>;
}

/**
 * Every saved edit on this truck: who, when, which field, old → new. Read straight from the server's change log; fields the
 * viewer's role may not see (price and amount for the Warehouse Incharge) are already removed from the response there.
 */
export function FieldHistory({ receiptId }: { receiptId: string }) {
  const { changes, loading, error } = useFieldChanges(receiptId);
  const search = useTableSearch(changes, (c) => [c.label, STAGES.get(c.stageId)?.title, c.by, c.oldValue, c.newValue]);

  const columns: Column<FieldChangeRecord>[] = useMemo(() => [
    {
      label: "When", nowrap: true, filter: { value: (c) => c.at.slice(0, 10), kind: "date" },
      render: (c) => <span className="tabular-nums text-warmstone-700">{formatDateTime(c.at)}</span>,
    },
    {
      label: "Who", nowrap: true, filter: { value: (c) => c.by, kind: "select" },
      render: (c) => (
        <span className="inline-flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold grid place-items-center uppercase">{c.by.slice(0, 1)}</span>
          {c.by}
        </span>
      ),
    },
    {
      label: "Field", filter: { value: (c) => STAGES.get(c.stageId)?.title ?? c.stageId, kind: "select" },
      render: (c) => (
        <div className="min-w-0">
          <div className="font-semibold text-warmstone-900">{c.label}</div>
          <div className="text-[12px] text-warmstone-500">{STAGES.get(c.stageId)?.title ?? c.stageId}</div>
        </div>
      ),
    },
    {
      label: "Change",
      render: (c) => {
        const format = fieldOf(c)?.format;
        return (
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Value value={c.oldValue} format={format} strike={c.oldValue !== null && c.oldValue !== ""} />
            <span className="material-symbols-outlined text-[16px] text-warmstone-400" aria-label="changed to">arrow_forward</span>
            <Value value={c.newValue} format={format} />
          </span>
        );
      },
    },
    {
      label: "How", nowrap: true, filter: { value: (c) => VIA[c.via]?.label ?? c.via, kind: "select" },
      render: (c) => <Pill tone={VIA[c.via]?.tone ?? "system"} label={VIA[c.via]?.label ?? c.via} />,
    },
  ], []);

  if (error) return <p role="alert" className="px-1 text-[13px] text-danger-700">Couldn't load the history: {error}</p>;

  return (
    <div className="space-y-3">
      <FilterBar>
        <input placeholder="Search field, step, person or value…" value={search.q} onChange={(e) => search.setQ(e.target.value)} className="w-full sm:w-72" />
      </FilterBar>
      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-12 rounded-xl bg-warmstone-100 animate-pulse" />)}
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={search.filtered}
          keyFn={(c) => String(c.id)}
          emptyTitle={changes.length === 0 ? "No edits recorded yet" : "No edits match"}
          emptyHint={changes.length === 0 ? "Each saved change to a field on this truck shows here, with who made it and when." : "Try a different search or clear the column filters."}
        />
      )}
    </div>
  );
}
