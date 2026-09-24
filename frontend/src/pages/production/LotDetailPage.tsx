import { useParams, Link } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { Pill } from "../../components/ui/Pill";
import { ProductionStageAccordion, type AccordionStep } from "../../components/production/ProductionStageAccordion";
import { ProductionTableBody } from "../../components/production/ProductionTableSection";
import { useLot } from "../../state/TrackingContext";
import { api } from "../../repository/api";
import { productionTableById } from "@anagroci/contract/data/productionTables";
import { LOT_STATUS_LABELS, getLotTableProgress } from "@anagroci/contract/domain/productionStatus";

const STATUS_TONE: Record<string, string> = {
  cooking: "system", shelled: "entry", in_borma: "entry",
  peeling: "entry", packed: "term", dispatched: "term",
};

/** A Lot is a single record (like a procurement Receipt), so its 13-table traceability spine
 * (Cook → Shell → Borma → Peel → Pack) gets the exact same accordion treatment as Receipt Detail's
 * "Delivery stages" — checkmark/number badge, phase subtitle, furthest-reached step auto-open. */
export function LotDetailPage() {
  const { lotNo } = useParams<{ lotNo: string }>();
  const { row, loading, refetch } = useLot(lotNo);

  if (loading) return <div className="p-10 text-warmstone-400 text-sm">Loading…</div>;
  if (!row) return <div className="p-10 text-warmstone-400 text-sm">Lot "{lotNo}" not found.</div>;

  const progress = getLotTableProgress(row.tables);

  const steps: AccordionStep[] = progress.steps.map((s, i) => {
    const table = productionTableById[s.tableId];
    return {
      id: s.tableId,
      title: s.label,
      phase: s.phase,
      badge: s.done ? { kind: "check" } : { kind: "number", index: i + 1 },
      active: s.tableId === progress.activeTableId,
      body: (
        <ProductionTableBody
          idPrefix={`${row.lotNo}-${s.tableId}`}
          title={s.label}
          fields={table.fields}
          load={() => api.listLotTableRows(row.lotNo, s.tableId)}
          submitLabel={`Add ${s.label.toLowerCase()} row`}
          onSubmit={async (values) => {
            await api.addLotTableRow(row.lotNo, s.tableId, values);
            await refetch();
          }}
        />
      ),
    };
  });

  return (
    <div className="space-y-5">
      <div className="text-[13px] text-warmstone-500">
        <Link to="/production/lots" className="hover:text-brand-700">Lots</Link>
        <span className="mx-1.5">/</span>
        <span className="font-mono">{row.lotNo}</span>
      </div>

      <PageHeader
        kicker="Production · Lot"
        title={row.lotNo}
        lede={`Bin: ${row.binNo}`}
        actions={<Pill tone={STATUS_TONE[row.status] ?? "system"} label={LOT_STATUS_LABELS[row.status as keyof typeof LOT_STATUS_LABELS] ?? row.status} />}
      />
      <Link to={`/production/bins/${encodeURIComponent(row.binNo)}`} className="inline-block -mt-3 text-[13px] text-brand-700 hover:text-brand-800 font-semibold">
        View Bin {row.binNo} →
      </Link>

      <div className="flex items-center justify-between px-1">
        <h2 className="text-base font-bold text-warmstone-900 flex items-center gap-2">
          <span className="material-symbols-outlined text-[19px] text-brand-700">fact_check</span>
          Processing stages
        </h2>
        <span className="text-xs font-medium text-warmstone-500">{progress.totalCount} stages, any order</span>
      </div>

      <ProductionStageAccordion steps={steps} />
    </div>
  );
}
