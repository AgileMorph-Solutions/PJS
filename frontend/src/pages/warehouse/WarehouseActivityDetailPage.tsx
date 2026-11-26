import { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useTracking } from "../../state/TrackingContext";
import { useSite } from "../../state/SiteContext";
import { useBin } from "../../state/useBins";
import { DryingPanel } from "../../components/receipt/DryingPanel";
import { StageEntryLedger } from "../../components/StageEntryLedger";
import { binLedgerDefaults, BIN_LEDGER_NOTES } from "../../components/warehouse/binLedgers";
import { otherActivityChoices } from "../../components/receipt/warehousePicker";
import { stageById } from "../../data/stages";
import { BIN_STAGE_IDS } from "@anagroci/contract/domain/warehouseActivityStages";
import { api } from "../../repository/api";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { buttonClass } from "../../components/ui/Button";
import { formatKg, formatTonnes } from "../../components/production/batchUi";
import { binsAtSite } from "@anagroci/contract/domain/binNumber";
import { siteTypeOf } from "@anagroci/contract/domain/siteType";
import { averageKgPerBag } from "@anagroci/contract/domain/sunDrying";
import { parseQty } from "@anagroci/contract/domain/receiptMath";
import { formatDate } from "@anagroci/contract/domain/dateFormat";
import { BIN_HISTORY_LABELS, type BinHistoryEntry, type LotInBin } from "@anagroci/contract/domain/productionBatch";

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
  // The average bag of the RCN in this Bin, from each of its Lots' own truck: net weight ÷ bags. Drying estimates the weight
  // issued from it (26 Nov 2026, user). A Lot whose truck isn't visible here, or recorded no bags, is left out.
  const kgPerBag = useMemo(() => {
    const byId = new Map(receipts.map((r) => [r.id, r]));
    return averageKgPerBag((bin?.lots ?? []).map((l) => {
      const sd = byId.get(l.receiptId)?.stageData;
      return { netKg: parseQty(sd?.["n-netwt"]?.["NET WT KGS"]), bags: parseQty(sd?.["n-unload"]?.["SACS (bags)"]) };
    }));
  }, [bin?.lots, receipts]);
  const dryTypes = useMemo(() => [...new Set(["SUN DRYING", ...(bin?.dryings ?? []).map((d) => (d.dryType ?? "").trim()).filter(Boolean)])], [bin?.dryings]);

  // The Bin's history (25 Nov 2026): every Lot ever put in and everything that came in or went out, not only what is in it
  // now. What is in it now is the kg tile above, worked out from all of this.
  const lotLink = (e: BinHistoryEntry) => {
    const name = e.lotNo || e.receiptId;
    if (!name) return null;
    return e.receiptId && visible.has(e.receiptId)
      ? <Link to={`/${site.slug}/receipts/${e.receiptId}`} className="font-medium text-brand-700 hover:text-brand-800">{name}</Link>
      : <span className="font-medium text-warmstone-900">{name}</span>;
  };
  const historyColumns: Column<BinHistoryEntry>[] = [
    { label: "Date", nowrap: true, render: (e) => formatDate(e.date) || "-" },
    {
      label: "What happened",
      render: (e) => <>{BIN_HISTORY_LABELS[e.kind]}{e.dried ? <span className="text-warmstone-500"> · after sun drying</span> : null}</>,
    },
    {
      label: "Lot / reference",
      nowrap: true,
      render: (e) => {
        const lot = lotLink(e);
        const ref = e.ref && e.ref !== e.lotNo ? <span className="text-warmstone-500">{e.ref}</span> : null;
        return lot || ref ? <>{lot}{lot && ref ? " · " : null}{ref}</> : "-";
      },
    },
    {
      label: "Kg",
      align: "right",
      nowrap: true,
      render: (e) => (e.kg !== undefined
        ? <span className={`tabular-nums ${e.kg > 0 ? "text-success-700" : "text-warmstone-800"}`}>{e.kg > 0 ? "+" : "−"}{formatKg(Math.abs(e.kg))}{e.kgShared ? <span className="text-warmstone-500"> (share of its truck)</span> : null}</span>
        : <span className="text-warmstone-500">{e.state ? LOT_STATE[e.state] : "-"}</span>),
    },
  ];
  // Lots ever put in, each counted once (a Lot sent on and back is still one Lot).
  const lotsPutIn = new Set((bin?.history ?? []).filter((e) => e.kind === "lot_in" || e.kind === "lot_arrived").map((e) => e.receiptId)).size;


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
                {[bin.store && `Warehouse ${bin.store}`, `${lotsPutIn} Lot${lotsPutIn === 1 ? "" : "s"} put in so far`].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="bg-warmstone-50 border border-warmstone-200 rounded-xl p-4 min-w-[11rem]">
                <p className="text-[11px] font-bold uppercase tracking-wider text-warmstone-500">In the Bin now</p>
                <p className={`text-xl font-bold tracking-tight tabular-nums ${bin.kg < 0 ? "text-danger-700" : "text-warmstone-900"}`}>{formatKg(bin.kg)}</p>
                {Math.abs(bin.kg) >= 50 && <p className="text-[11px] text-warmstone-500 tabular-nums">{formatTonnes(bin.kg)}</p>}
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
                  Make a lot to send
                </Link>
              )}
            </div>
          </div>

          <CollapsibleCard title="Sun drying" meta="From this Bin to the drying yard, then into a new Bin — or straight to production" defaultOpen>
            <div className="pt-3">
              <DryingPanel
                scope={{
                  kind: "bin", binCode: bin.binCode, warehouse: site.warehouseName, binKg: bin.kg, kgPerBag,
                  decision: bin.dryingDecision?.answer ?? null,
                  onAnswer: async (answer) => { await api.setBinDryingDecision(bin.binCode, site.warehouseName, answer); },
                }}
                batches={bin.dryings}
                dryTypes={dryTypes}
                bins={siteBins}
                onBinsOpen={refreshMasters}
                canEdit={Boolean(bin.store)}
                onChanged={() => void refetch()}
              />
            </div>
          </CollapsibleCard>


          {/* The Bin's own ledgers, each kept on its own and not tied to the other (team, 23 Nov 2026), many entries each (26 Nov 2026). */}
          {BIN_STAGE_IDS.map((id) => (
            <StageEntryLedger
              key={id}
              stage={stageById[id]!}
              entries={bin.entries[id]}
              defaults={() => binLedgerDefaults(id, bin.binCode, site.warehouseName)}
              notes={BIN_LEDGER_NOTES[id]}
              choices={otherActivityChoices(id, siteBins, masters.warehouses)}
              onChoicesOpen={refreshMasters}
              canEdit={Boolean(bin.store)}
              onAdd={(fields) => api.addBinEntry(bin.binCode, site.warehouseName, id, fields).then(() => void refetch())}
              onUpdate={(entryId, fields) => api.updateBinEntry(bin.binCode, site.warehouseName, entryId, fields).then(() => void refetch())}
            />
          ))}

          <CollapsibleCard title="Bin history" meta={`What was put in and taken out, most recent first · ${bin.history.length} entr${bin.history.length === 1 ? "y" : "ies"}`} defaultOpen>
            <div className="pt-3">
              <DataTable
                columns={historyColumns}
                rows={bin.history}
                keyFn={(e) => `${e.kind}-${e.receiptId ?? ""}-${e.ref ?? ""}-${e.date}`}
                emptyTitle="Nothing put in this Bin yet"
                emptyHint="A Lot is put in its Bin once its GRN is complete."
                pageSize={10}
              />
            </div>
          </CollapsibleCard>
        </>
      )}
    </div>
  );
}
