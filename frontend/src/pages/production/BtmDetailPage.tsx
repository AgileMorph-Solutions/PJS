import { useParams, Link } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { Pill } from "../../components/ui/Pill";
import { ProductionStageAccordion, type AccordionStep } from "../../components/production/ProductionStageAccordion";
import { ProductionTableBody } from "../../components/production/ProductionTableSection";
import { useBtmIntake } from "../../state/TrackingContext";
import { api } from "../../repository/api";
import { productionTableById } from "@anagroci/contract/data/productionTables";
import { BTM_STATUS_LABELS, getBtmTableProgress } from "@anagroci/contract/domain/productionStatus";

const STATUS_TONE: Record<string, string> = {
  planned: "system", received: "entry", quality_checked: "entry",
  reconciled: "entry", calibrated: "term", quality_hold: "gap",
};

/** A BTM is a single record too (like a Lot, like a procurement Receipt) — same accordion
 * treatment, scoped to its 4 Phase 1-2 tables. */
export function BtmDetailPage() {
  const { btmNo } = useParams<{ btmNo: string }>();
  const { row, loading, refetch } = useBtmIntake(btmNo);

  if (loading) return <div className="p-10 text-warmstone-400 text-sm">Loading…</div>;
  if (!row) return <div className="p-10 text-warmstone-400 text-sm">BTM "{btmNo}" not found.</div>;

  const progress = getBtmTableProgress(row.tables);

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
          idPrefix={`${row.btmNo}-${s.tableId}`}
          title={s.label}
          fields={table.fields}
          load={() => api.listBtmTableRows(row.btmNo, s.tableId)}
          submitLabel={`Add ${s.label.toLowerCase()} row`}
          onSubmit={async (values) => {
            await api.addBtmTableRow(row.btmNo, s.tableId, row.binNo, values);
            await refetch();
          }}
        />
      ),
    };
  });

  return (
    <div className="space-y-5">
      <div className="text-[13px] text-warmstone-500">
        <Link to="/production/btm" className="hover:text-brand-700">BTM Intake</Link>
        <span className="mx-1.5">/</span>
        <span className="font-mono">{row.btmNo}</span>
      </div>

      <PageHeader
        kicker="Production · BTM"
        title={`BTM ${row.btmNo}`}
        lede={`Destination Bin: ${row.binNo}`}
        actions={<Pill tone={STATUS_TONE[row.status] ?? "system"} label={BTM_STATUS_LABELS[row.status as keyof typeof BTM_STATUS_LABELS] ?? row.status} />}
      />
      <Link to={`/production/bins/${encodeURIComponent(row.binNo)}`} className="inline-block -mt-3 text-[13px] text-brand-700 hover:text-brand-800 font-semibold">
        View Bin {row.binNo} →
      </Link>

      <div className="flex items-center justify-between px-1">
        <h2 className="text-base font-bold text-warmstone-900 flex items-center gap-2">
          <span className="material-symbols-outlined text-[19px] text-brand-700">fact_check</span>
          Intake stages
        </h2>
        <span className="text-xs font-medium text-warmstone-500">{progress.totalCount} stages, any order</span>
      </div>

      <ProductionStageAccordion steps={steps} />
    </div>
  );
}
