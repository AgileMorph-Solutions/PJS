import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { SiteFieldChangeRecord } from "@anagroci/contract/types/receipt";
import type { ChangeLogRecord } from "@anagroci/contract/types/changeLog";
import { checkValue } from "@anagroci/contract/domain/fieldRules";
import { isMoneyField } from "@anagroci/contract/domain/currency";
import { formatDateTime } from "@anagroci/contract/domain/dateFormat";
import { stages, rejectStage } from "../../data/stages";
import { DataTable, type Column } from "../ui/DataTable";
import { FilterBar } from "../ui/FilterBar";
import { Pill } from "../ui/Pill";
import { Avatar } from "../ui/Avatar";
import { useTableSearch } from "../ui/useTableSearch";
import { Value, VIA } from "../receipt/FieldHistory";

const STAGES = new Map([...stages, rejectStage].map((s) => [s.id, s]));

/** One line of the Logs page, whichever log it came from. */
interface Row {
  key: string;
  at: string;
  by: string;
  approvedBy: string | null;
  via: keyof typeof VIA;
  area: string;
  record: string;
  recordSub?: string;
  href?: string;
  field: string;
  fieldSub: string;
  oldValue: string | null;
  newValue: string | null;
  format?: "date" | "datetime" | "money";
  /** Only a truck's step values have field rules to check. */
  check?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const formatOf = (v: string | null) => (v && ISO_DATETIME.test(v) ? "datetime" : v && ISO_DATE.test(v) ? "date" : undefined);

const ACTION = { create: "Created", update: "Changed", delete: "Deleted" } as const;

/** Where a logged record opens, when it has a page of its own at this site. */
function hrefOf(c: ChangeLogRecord, siteSlug: string): string | undefined {
  const first = c.recordId?.split(" · ")[0];
  if (!first) return undefined;
  const at = (path: string) => `/${siteSlug}/${path}/${encodeURIComponent(first)}`;
  if (c.entity === "TransferRequest" || c.entity === "TransferRequestLine") return at("transfers");
  if (c.entity === "Receipt" || c.entity === "ReceiptBranch") return at("receipts");
  if (c.entity === "DeliveryPlan") return at("delivery-plans");
  return undefined;
}

function fromTruck(c: SiteFieldChangeRecord, siteSlug: string): Row {
  const issue = checkValue(c.stageId, c.label, c.newValue ?? "");
  const field = STAGES.get(c.stageId)?.fields.find((f) => f.n === c.label);
  return {
    key: `t${c.id}`, at: c.at, by: c.by, approvedBy: c.approvedBy, via: c.via, area: "Truck steps",
    record: c.receiptId, recordSub: c.vehicleNo, href: `/${siteSlug}/receipts/${encodeURIComponent(c.receiptId)}`,
    field: c.label, fieldSub: STAGES.get(c.stageId)?.title ?? c.stageId, oldValue: c.oldValue, newValue: c.newValue,
    format: isMoneyField(c.stageId, c.label) ? "money" : field?.format === "date" || field?.format === "datetime" ? field.format : undefined, check: issue?.message,
  };
}

function fromLog(c: ChangeLogRecord, siteSlug: string): Row {
  return {
    key: `c${c.id}`, at: c.at, by: c.by, approvedBy: null, via: c.via, area: c.area,
    record: c.recordId ?? `${c.entityLabel} (several)`, href: hrefOf(c, siteSlug),
    // A whole-record row says what happened to it ("Created", "Deleted"); a field row names the field.
    field: c.fieldLabel ?? ACTION[c.action], fieldSub: c.entityLabel,
    oldValue: c.oldValue, newValue: c.newValue, format: formatOf(c.newValue) ?? formatOf(c.oldValue),
  };
}

/**
 * The Logs page's one list: a truck's step changes (FieldChangeRecord, by their workbook labels) and every other saved
 * change (the change log), newest first. Read-only: both logs are written by the saves themselves.
 */
export function ActivityLog({ truck, other, loading, error, siteSlug }: {
  truck: SiteFieldChangeRecord[];
  other: ChangeLogRecord[];
  loading: boolean;
  error: string | null;
  siteSlug: string;
}) {
  const rows = useMemo(
    () => [...truck.map((c) => fromTruck(c, siteSlug)), ...other.map((c) => fromLog(c, siteSlug))].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)),
    [truck, other, siteSlug]
  );
  const search = useTableSearch(rows, (r) => [r.record, r.recordSub, r.field, r.fieldSub, r.by, r.oldValue, r.newValue, r.area]);

  const columns: Column<Row>[] = useMemo(() => [
    {
      label: "Area", nowrap: true, filter: { value: (r) => r.area, kind: "select" },
      render: (r) => <span className="text-warmstone-700">{r.area}</span>,
    },
    {
      label: "Record", nowrap: true, filter: { value: (r) => r.record, kind: "select" },
      render: (r) => {
        const body = <>{r.record}{r.recordSub && <span className="block text-[12px] font-normal text-warmstone-500">{r.recordSub}</span>}</>;
        return r.href
          ? <Link to={r.href} className="font-semibold text-brand-700 hover:text-brand-800">{body}</Link>
          : <span className="font-semibold text-warmstone-800">{body}</span>;
      },
    },
    {
      label: "When", nowrap: true, filter: { value: (r) => r.at.slice(0, 10), kind: "date" },
      render: (r) => <span className="tabular-nums text-warmstone-700">{formatDateTime(r.at)}</span>,
    },
    {
      label: "Who", nowrap: true, filter: { value: (r) => r.by, kind: "select" },
      render: (r) => (
        <span className="inline-flex items-center gap-2">
          <Avatar name={r.by} />
          <span>
            {r.by}
            {r.approvedBy && <span className="block text-[11px] text-warmstone-500">approved by {r.approvedBy}</span>}
          </span>
        </span>
      ),
    },
    {
      label: "Field", filter: { value: (r) => r.fieldSub, kind: "select" },
      render: (r) => (
        <div className="min-w-0">
          <div className="font-semibold text-warmstone-900">{r.field}</div>
          <div className="text-[12px] text-warmstone-500">{r.fieldSub}</div>
        </div>
      ),
    },
    {
      label: "Change",
      render: (r) => r.oldValue === null && r.newValue === null ? <span className="text-warmstone-400">-</span> : (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Value value={r.oldValue} format={r.format} strike={r.oldValue !== null && r.oldValue !== ""} />
          <span className="material-symbols-outlined text-[16px] text-warmstone-400" aria-label="changed to">arrow_forward</span>
          <Value value={r.newValue} format={r.format} />
        </span>
      ),
    },
    {
      label: "How", nowrap: true, filter: { value: (r) => VIA[r.via]?.label ?? r.via, kind: "select" },
      render: (r) => <Pill tone={VIA[r.via]?.tone ?? "system"} label={VIA[r.via]?.label ?? r.via} />,
    },
    {
      label: "Check", filter: { value: (r) => (r.check ? "Saved with a warning" : "Within the rules"), kind: "select" },
      render: (r) => r.check ? (
        <span className="block max-w-xs">
          <Pill tone="decision" label="Saved with a warning" />
          <span className="mt-0.5 block text-[12px] text-warmstone-500">{r.check}</span>
        </span>
      ) : <span className="text-warmstone-400">-</span>,
    },
  ], []);

  if (error) return <p role="alert" className="px-1 text-[13px] text-danger-700">Couldn't load the logs: {error}</p>;

  return (
    <div className="space-y-3">
      <FilterBar>
        <input placeholder="Search record, field, person or value…" value={search.q} onChange={(e) => search.setQ(e.target.value)} className="w-full sm:w-72" />
      </FilterBar>
      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-12 rounded-xl bg-warmstone-100 animate-pulse" />)}
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={search.filtered}
          keyFn={(r) => r.key}
          emptyTitle={rows.length === 0 ? "No changes recorded yet" : "No changes match"}
          emptyHint={rows.length === 0 ? "Every saved change at this warehouse shows here, with who made it and when." : "Try a different search or clear the column filters."}
        />
      )}
    </div>
  );
}
