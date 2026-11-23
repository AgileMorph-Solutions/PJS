import { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useTracking } from "../../state/TrackingContext";
import { useSite } from "../../state/SiteContext";
import { useBin } from "../../state/useBins";
import { DryingPanel } from "../../components/receipt/DryingPanel";
import { BinStageCard } from "../../components/warehouse/BinStageCard";
import { otherActivityChoices } from "../../components/receipt/warehousePicker";
import { stageById } from "../../data/stages";
import { BIN_STAGE_IDS } from "@anagroci/contract/domain/warehouseActivityStages";
import { api } from "../../repository/api";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { buttonClass } from "../../components/ui/Button";
import { formatKg } from "../../components/production/batchUi";
import { binsAtSite } from "@anagroci/contract/domain/binNumber";
import { siteTypeOf } from "@anagroci/contract/domain/siteType";
import { formatDate } from "@anagroci/contract/domain/dateFormat";
import type { LotInBin } from "@anagroci/contract/domain/productionBatch";

/** Why a Lot in the Bin adds no kg: shown rather than guessed (contract warehouseBinStock). */
const LOT_STATE: Record<LotInBin["state"], string> = {
  in_bin: "",
  weight_not_recorded: "no GRN weight recorded",
  split_across_bins: "recorded across several Bins",
  weighed_with_other_lots: "weighed with other Lots on its truck",
};

/**
 * One Bin's warehouse activities (22 Nov 2026). What is in it — its Lots and what moved in and out — then what is done to it:
 * sun drying from this Bin (into a new Bin, or straight to production), the labour activities, and the last step: a transfer
 * to the Central warehouse from a Unit one, production at a Central one. Its stock is worked out from all of these, never typed.
 */
export function WarehouseActivityDetailPage() {
  const { binCode = "" } = useParams();
  const site = useSite();
  const { masters, receipts, refreshMasters } = useTracking();
  const { bin, loading, error, refetch } = useBin(binCode, site.warehouseName);
  const central = siteTypeOf(masters.warehouses, masters.aliases, site.warehouseName) === "CENTRAL";
  const listHref = `/${site.slug}/warehouse-activities`;
  // This warehouse's Bins: where dried RCN can go, and where a move can go to.
  const siteBins = useMemo(() => binsAtSite(masters.binInfo ?? [], masters.warehouses, masters.aliases, site.warehouseName), [masters.binInfo, masters.warehouses, masters.aliases, site.warehouseName]);
  const visible = useMemo(() => new Set(receipts.map((r) => r.id)), [receipts]);
  const dryTypes = useMemo(() => [...new Set(["SUN DRYING", ...(bin?.dryings ?? []).map((d) => (d.dryType ?? "").trim()).filter(Boolean)])], [bin?.dryings]);

  const lotColumns: Column<LotInBin>[] = [
    {
      label: "Lot",
      nowrap: true,
      render: (l) => (visible.has(l.receiptId)
        ? <Link to={`/${site.slug}/receipts/${l.receiptId}`} className="font-medium text-brand-700 hover:text-brand-800">{l.lotNo || l.receiptId}</Link>
        : <span className="font-medium text-warmstone-900">{l.lotNo || l.receiptId}</span>),
    },
    { label: "Arrived", nowrap: true, render: (l) => formatDate(l.arrivalDate) || "-" },
    {
      label: "Kg",
      align: "right",
      nowrap: true,
      render: (l) => (l.kg !== undefined
        ? <span className="tabular-nums">{formatKg(l.kg)}{l.kgShared ? <span className="text-warmstone-500"> (share of its truck)</span> : null}{l.sentKg ? <span className="text-warmstone-500"> ({formatKg(l.sentKg)} already sent on a BKT)</span> : null}</span>
        : <span className="text-warmstone-500">{LOT_STATE[l.state]}</span>),
    },
  ];


  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-[13px] text-warmstone-500">
        <Link to={listHref} className="hover:text-warmstone-900 font-medium transition-colors">Warehouse activities · {site.sublabel}</Link>
        <span className="material-symbols-outlined text-[16px] text-warmstone-300">chevron_right</span>
        <span className="font-bold text-warmstone-900">Bin {binCode}</span>
      </div>

      {!bin ? (
        loading ? <p className="text-[13px] text-warmstone-500">Loading Bin {binCode}…</p> : (
          <EmptyState title={`Bin ${binCode} isn't one of this warehouse's`} hint={error ?? "Check the Bin code, or open it from the Warehouse activities list."} />
        )
      ) : (
        <>
          {!bin.store && (
            <p role="status" className="flex items-start gap-2 rounded-xl border border-ambernut-200 bg-ambernut-50 px-4 py-3 text-[13px] text-ambernut-900">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-ambernut-700">warning</span>
              <span>This Bin has no warehouse. An admin sets it in Masters › Bins; until then nothing can be recorded on it.</span>
            </p>
          )}
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="space-y-1.5">
              <h1 className="text-2xl font-bold tracking-tight text-warmstone-900">Bin {bin.binCode}</h1>
              <p className="text-sm leading-relaxed text-warmstone-500">
                {[bin.store && `Warehouse ${bin.store}`, `${bin.lots.length} Lot${bin.lots.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="bg-warmstone-50 border border-warmstone-200 rounded-xl p-4 min-w-[11rem]">
                <p className="text-[11px] font-bold uppercase tracking-wider text-warmstone-500">In the Bin now</p>
                <p className={`text-xl font-bold tracking-tight tabular-nums ${bin.kg < 0 ? "text-danger-700" : "text-warmstone-900"}`}>{formatKg(bin.kg)}</p>
                {bin.issuedKg > 0 && <p className="text-[11px] text-warmstone-500 tabular-nums">{formatKg(bin.issuedKg)} taken by production</p>}
              </div>
              {central ? (
                <Link to="/production/runs/new" className={buttonClass("primary")}>
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px]">precision_manufacturing</span>
                  Send to production
                </Link>
              ) : (
                <Link to={`/${site.slug}/transfers?bin=${encodeURIComponent(bin.binCode)}`} className={buttonClass("primary")}>
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px]">local_shipping</span>
                  Send on a transfer
                </Link>
              )}
            </div>
          </div>

          <CollapsibleCard title="Sun drying" meta="From this Bin to the drying yard, then into a new Bin — or straight to production" defaultOpen>
            <div className="pt-3">
              <DryingPanel
                scope={{ kind: "bin", binCode: bin.binCode, warehouse: site.warehouseName, binKg: bin.kg }}
                batches={bin.dryings}
                dryTypes={dryTypes}
                bins={siteBins}
                canEdit={Boolean(bin.store)}
                onChanged={() => void refetch()}
              />
            </div>
          </CollapsibleCard>


          {/* The Bin's own forms, each saved on its own and not tied to the other (team, 23 Nov 2026). */}
          {BIN_STAGE_IDS.map((id) => (
            <BinStageCard
              key={id}
              stage={stageById[id]!}
              binCode={bin.binCode}
              view={bin.stages[id]}
              choices={otherActivityChoices(id, siteBins, masters.warehouses)}
              onChoicesOpen={refreshMasters}
              canEdit={Boolean(bin.store)}
              onSave={(fields) => api.saveBinStage(bin.binCode, site.warehouseName, id, fields).then(() => void refetch())}
            />
          ))}

          {/* The Lots only (team, 23 Nov 2026): what is in the Bin, when it arrived and how much. */}
          <CollapsibleCard title="What is in the Bin" meta={`${bin.lots.length} Lot${bin.lots.length === 1 ? "" : "s"}`} defaultOpen>
            <div className="pt-3">
              <DataTable columns={lotColumns} rows={bin.lots} keyFn={(l) => `${l.receiptId}-${l.transferId ?? ""}`} emptyTitle="No Lot in this Bin" emptyHint="A Lot is in its Bin once its GRN is complete." pageSize={10} />
            </div>
          </CollapsibleCard>
        </>
      )}
    </div>
  );
}
