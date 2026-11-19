import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { FieldChangeRecord, SiteFieldChangeRecord } from "@anagroci/contract/types/receipt";
import { checkValue } from "@anagroci/contract/domain/fieldRules";
import type { StageField } from "@anagroci/contract/types/stage";
import { formatDate, formatDateTime } from "@anagroci/contract/domain/dateFormat";
import { stages, rejectStage } from "../../data/stages";
import { DataTable, type Column } from "../ui/DataTable";
import { FilterBar } from "../ui/FilterBar";
import { Pill } from "../ui/Pill";
import { Avatar } from "../ui/Avatar";
import { useTableSearch } from "../ui/useTableSearch";

const STAGES = new Map([...stages, rejectStage].map((s) => [s.id, s]));
const fieldOf = (c: FieldChangeRecord): StageField | undefined => STAGES.get(c.stageId)?.fields.find((f) => f.n === c.label);

/** How a change was saved, as a pill. Shared with the Logs page's other changes (components/logs), which add "System". */
export const VIA: Record<FieldChangeRecord["via"] | "system", { label: string; tone: string }> = {
  direct: { label: "Edited", tone: "system" },
  approval: { label: "Approved form", tone: "decision" },
  import: { label: "Upload", tone: "term" },
  system: { label: "System", tone: "system" },
};

/** Dates are stored ISO; show them the one way the app shows dates. Empty means the field was blank. */
export function Value({ value, format, strike }: { value: string | null; format?: StageField["format"]; strike?: boolean }) {
  if (value === null || value === "") return <span className="italic text-warmstone-400">empty</span>;
  const shown = format === "date" ? formatDate(value) : format === "datetime" ? formatDateTime(value) : value;
  return <span className={strike ? "text-warmstone-500 line-through decoration-warmstone-300" : "font-semibold text-warmstone-900"}>{shown}</span>;
}

type Change = FieldChangeRecord & Partial<Pick<SiteFieldChangeRecord, "receiptId" | "vehicleNo">>;

interface Props {
  /** The truck's whole change log (useFieldChanges), read once by the page and shared with every stage card, or a warehouse's (Logs page). */
  changes: Change[];
  loading: boolean;
  error: string | null;
  /** Set on the Logs page, where the changes span many trucks: adds a Truck column linking to each. */
  truckHref?: (receiptId: string) => string;
}

/**
 * What the field rules (contract domain/fieldRules.ts) say about the value saved, worked out from the rules rather than
 * stored, so it can't disagree with them. The rules only warn, so every value was saved.
 */
const WARNED = { label: "Saved with a warning", tone: "decision" } as const;
const checkOf = (c: Change) => checkValue(c.stageId, c.label, c.newValue ?? "");

/**
 * Every saved edit on this truck: who, when, which field, old → new. Read straight from the server's change log; fields the
 * viewer's role may not see (price and amount for the Warehouse Incharge) are already removed from the response there.
 */
export function FieldHistory({ changes, loading, error, truckHref }: Props) {
  const search = useTableSearch(changes, (c) => [c.label, STAGES.get(c.stageId)?.title, c.by, c.oldValue, c.newValue, c.receiptId, c.vehicleNo]);

  const columns: Column<Change>[] = useMemo(() => [
    ...(truckHref ? [{
      label: "Truck", nowrap: true, filter: { value: (c: Change) => c.receiptId ?? "", kind: "select" as const },
      render: (c: Change) => (
        <Link to={truckHref(c.receiptId ?? "")} className="font-semibold text-brand-700 hover:text-brand-800">
          {c.receiptId}
          {c.vehicleNo && <span className="block text-[12px] font-normal text-warmstone-500">{c.vehicleNo}</span>}
        </Link>
      ),
    }] : []),
    {
      label: "When", nowrap: true, filter: { value: (c) => c.at.slice(0, 10), kind: "date" },
      render: (c) => <span className="tabular-nums text-warmstone-700">{formatDateTime(c.at)}</span>,
    },
    {
      label: "Who", nowrap: true, filter: { value: (c) => c.by, kind: "select" },
      render: (c) => (
        <span className="inline-flex items-center gap-2">
          <Avatar name={c.by} />
          <span>
            {c.by}
            {c.approvedBy && <span className="block text-[11.5px] text-warmstone-500">approved by {c.approvedBy}</span>}
          </span>
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
    {
      label: "Check", filter: { value: (c) => { const i = checkOf(c); return i ? WARNED.label : "Within the rules"; }, kind: "select" },
      render: (c) => {
        const i = checkOf(c);
        if (!i) return <span className="text-warmstone-400">-</span>;
        return (
          <span className="block max-w-xs">
            <Pill tone={WARNED.tone} label={WARNED.label} />
            <span className="mt-0.5 block text-[12px] text-warmstone-500">{i.message}</span>
          </span>
        );
      },
    },
  ], [truckHref]);

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
