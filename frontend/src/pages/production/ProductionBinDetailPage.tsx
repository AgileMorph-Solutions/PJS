import { useParams, Link } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { StatBlock } from "../../components/ui/StatBlock";
import { ProductionStageAccordion, type AccordionStep } from "../../components/production/ProductionStageAccordion";
import { ProductionTableBody } from "../../components/production/ProductionTableSection";
import { useProductionBin, useBinPhaseProgress } from "../../state/TrackingContext";
import { api } from "../../repository/api";
import type { BtmIntake, ProductionLot, BinStockRow, BinPhaseStep } from "../../repository/api";
import { productionTableById } from "@anagroci/contract/data/productionTables";

/** The Bin is the physical identity a set of cashews is actually tracked by — the pivot both the
 * BTM intake spine and the Lot production spine hang off. This page is the featured production
 * entry point: a real Phase 1-2 stage tracker (fraction-based — a Bin has many BTMs feeding it, so
 * "done" per step is honestly "X of Y BTMs", never a misleading single checkmark), then the Lots
 * cooked from it, each opening its OWN Phase 3-8 tracker (see LotDetailPage) — a Bin doesn't have
 * one Phase 3-8 walk, every Lot cooked from it has its own.
 */
export function ProductionBinDetailPage() {
  const { binNo } = useParams<{ binNo: string }>();
  const { row, loading } = useProductionBin(binNo);
  const { steps: phaseSteps, loading: phaseLoading } = useBinPhaseProgress(binNo);

  if (loading) return <div className="p-10 text-warmstone-400 text-sm">Loading…</div>;
  if (!row) return <div className="p-10 text-warmstone-400 text-sm">Bin "{binNo}" not found.</div>;

  const latestBalance = row.stock.length ? row.stock[row.stock.length - 1]!.running_balance : null;

  // Furthest-reached-plus-one, over the aggregate steps — same "active" rule as the record-level
  // accordions, applied to fractions: a step counts as reached once it has ANY progress at all.
  const lastReachedIndex = phaseSteps.reduce((max: number, s: BinPhaseStep, i: number) => (s.doneCount > 0 ? i : max), -1);
  const activeTableId = phaseSteps[lastReachedIndex + 1]?.tableId;

  const accordionSteps: AccordionStep[] = phaseSteps.map((s) => {
    const table = productionTableById[s.tableId];
    return {
      id: s.tableId,
      title: s.label,
      phase: s.phase,
      badge: { kind: "fraction", doneCount: s.doneCount, totalCount: s.totalCount },
      active: s.tableId === activeTableId,
      body:
        s.kind === "direct" ? (
          // This Bin's own rows for a Bin-spine table (silos-stock-row, wholes-manual-calibration,
          // offloading-bin-report) — a real per-row view + add-form, same as everywhere else.
          <ProductionTableBody
            idPrefix={`${row.binNo}-${s.tableId}`}
            title={s.label}
            fields={table.fields}
            load={() => api.listBinTableRows(row.binNo, s.tableId)}
            submitLabel={`Add ${s.label.toLowerCase()} row`}
            onSubmit={async (values) => { await api.addBinTableRow(row.binNo, s.tableId, values); }}
          />
        ) : (
          // Aggregate (BTM-spine) step: this Bin's rows for this table live one-per-BTM, not as a
          // single Bin-level list — recorded against a specific BTM, so adding/viewing them here
          // isn't meaningful without picking which BTM. Point at the BTM list below instead of
          // faking a merged view or a write with no BTM to attach it to.
          <p className="text-[13px] text-warmstone-600">
            {s.doneCount} of {s.totalCount} BTMs feeding this Bin have {s.label.toLowerCase()} recorded.
            Open a BTM below to view or add its rows.
          </p>
        ),
    };
  });

  const btmColumns: Column<BtmIntake>[] = [
    { label: "BTM No", render: (r) => <span className="font-mono text-[12.5px]">{r.btmNo}</span> },
    { label: "Recorded", filter: { value: (r) => r.createdAt, kind: "date" }, render: (r) => new Date(r.createdAt).toLocaleDateString() },
  ];
  const lotColumns: Column<ProductionLot>[] = [
    { label: "Lot No", render: (r) => <span className="font-mono text-[12.5px]">{r.lotNo}</span> },
    { label: "Created", filter: { value: (r) => r.createdAt, kind: "date" }, render: (r) => new Date(r.createdAt).toLocaleDateString() },
  ];
  const stockColumns: Column<BinStockRow>[] = [
    { label: "Date", filter: { value: (r) => r.date, kind: "date" }, render: (r) => r.date },
    { label: "Type", filter: { value: (r) => r.movement_type }, render: (r) => r.movement_type },
    { label: "In", filter: { value: (r) => r.qty_in, kind: "number" }, render: (r) => r.qty_in },
    { label: "Out", filter: { value: (r) => r.qty_out, kind: "number" }, render: (r) => r.qty_out },
    { label: "Running balance", filter: { value: (r) => r.running_balance, kind: "number" }, render: (r) => <span className="font-semibold tabular-nums">{r.running_balance}</span> },
  ];

  return (
    <div className="space-y-5">
      <div className="text-[13px] text-warmstone-500">
        <Link to="/production/bins" className="hover:text-brand-700">Bins</Link>
        <span className="mx-1.5">/</span>
        <span className="font-mono">{row.binNo}</span>
      </div>

      <PageHeader kicker="Production · Bin" title={row.binNo} lede="The unique identity a physical set of cashews is tracked by - every BTM lands in exactly one Bin, and every Lot is cooked from exactly one." />

      <div className="grid sm:grid-cols-3 gap-4">
        <StatBlock icon="local_shipping" label="BTMs in" value={String(row.btmIntakes.length)} />
        <StatBlock icon="science" label="Lots out" value={String(row.lots.length)} />
        <StatBlock icon="scale" label="Running balance (kg)" value={latestBalance ?? "-"} tone={latestBalance ? "success" : "default"} />
      </div>

      <div className="flex items-center justify-between px-1">
        <h2 className="text-base font-bold text-warmstone-900 flex items-center gap-2">
          <span className="material-symbols-outlined text-[19px] text-brand-700">fact_check</span>
          Intake &amp; calibration stages
        </h2>
        <span className="text-xs font-medium text-warmstone-500">{phaseSteps.length} stages, aggregated across this Bin's BTMs</span>
      </div>
      {!phaseLoading && <ProductionStageAccordion steps={accordionSteps} />}

      <div className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs">
        <h3 className="text-[15px] font-bold text-warmstone-900 mb-3">BTMs in</h3>
        <DataTable columns={btmColumns} rows={row.btmIntakes} keyFn={(r) => r.btmNo} rowHref={(r) => `/production/btm/${encodeURIComponent(r.btmNo)}`} emptyTitle="No BTMs yet" />
      </div>

      <div className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs">
        <h3 className="text-[15px] font-bold text-warmstone-900 mb-3">Lots cooked from this Bin - each opens its own Phase 3-8 tracker</h3>
        <DataTable columns={lotColumns} rows={row.lots} keyFn={(r) => r.lotNo} rowHref={(r) => `/production/lots/${encodeURIComponent(r.lotNo)}`} emptyTitle="No Lots cooked from this Bin yet" />
      </div>

      <div className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs">
        <h3 className="text-[15px] font-bold text-warmstone-900 mb-3">Running stock</h3>
        <DataTable columns={stockColumns} rows={row.stock} keyFn={(r) => `${r.date}-${r.movement_type}-${r.running_balance}`} emptyTitle="No movements recorded yet" />
      </div>
    </div>
  );
}
