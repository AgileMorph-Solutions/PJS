import { useEffect, useMemo, useState, type FormEvent } from "react";
import { siteTypeOf } from "@anagroci/contract/domain/siteType";
import { readyForTransfer, transferDestinationLabel, TRANSFER_STATE_LABELS, type TransferDestination } from "@anagroci/contract/domain/transfers";
import { WAREHOUSE_TYPE_LABEL } from "../../data/warehouseTypes";
import { PageHeader } from "../../components/ui/PageHeader";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { MultiSelect } from "../../components/ui/MultiSelect";
import { Pill } from "../../components/ui/Pill";
import { Field, inputClass, n, TRANSFER_TONE, TransferLotLink } from "../../components/transfers/TransferPanel";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { useTracking, useTransfers } from "../../state/TrackingContext";
import { useSite, useSwitchSite } from "../../state/SiteContext";
import { useCanEditDirectly } from "../../state/AuthContext";
import { api } from "../../repository/api";
import type { TransferRequest } from "../../types/receipt";
import { normalizeSupplierName } from "@anagroci/contract/domain/supplierCode";
import { formatDate, todayIso } from "@anagroci/contract/domain/dateFormat";
import { DateInput } from "../../components/ui/DateInput";

const today = todayIso;

interface Pick { bags: string; net: string }

/**
 * Transfers — moving Lots to another warehouse on ONE truck, numbered BKT-<year>-NNN. A line is a Lot:
 * its supplier, fiche and Lot number come from the receipt, and the bags and net weight start as what
 * that receipt recorded, so nothing is typed twice. A Lot is offered here once its receipt says
 * "Yes — transfers out"; "No — stays" keeps it off this page. RCN only moves from Unit to Central, so a
 * Central warehouse has no new transfer here: this page is where it records what arrives.
 *
 * Two warehouses write two halves, and neither writes the other's: the SENDING one says what left (the
 * truck, and what its scale read), the DESTINATION one says what arrived. What arrived is blank until
 * the truck actually gets there, and the variance and the in-transit / closed / discrepancy state are
 * worked out from the two — never typed.
 */
export function TransfersPage() {
  const site = useSite();
  const switchSite = useSwitchSite();
  const canEdit = useCanEditDirectly();
  const { receipts, masters, refresh } = useTracking();
  const { transfers, loading, refetch } = useTransfers(site.warehouseName);
  const search = useTableSearch(transfers, (t) => [t.id, t.truckNo, t.fromWarehouse, t.toWarehouse, t.toStore, ...t.lines.map((l) => l.lotNumber)]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [date, setDate] = useState(today());
  const [to, setTo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [picked, setPicked] = useState<Record<string, Pick>>({});

  const canSend = siteTypeOf(masters.warehouses, masters.aliases, site.warehouseName) === "UNIT";
  // From the server, not the master: a Unit warehouse's own master holds only itself, yet it sends to a Central one.
  const [destinations, setDestinations] = useState<TransferDestination[]>([]);
  useEffect(() => {
    if (!canSend) return;
    let live = true;
    api.transferDestinations(site.warehouseName).then((d) => { if (live) setDestinations(d); }).catch(() => { if (live) setDestinations([]); });
    return () => { live = false; };
  }, [canSend, site.warehouseName]);
  // The receipts this site can open; a Lot on an incoming BKT belongs to the OTHER site, so it is shown as text.
  const visible = useMemo(() => new Set(receipts.map((r) => r.id)), [receipts]);
  // Marked "Yes" on the receipt says it is ready; only the BKTs themselves say it has already gone on one.
  // Nothing is offered until they have loaded, or a Lot already on a BKT would show for a moment.
  const candidates = useMemo(() => {
    if (loading) return [];
    const onABkt = new Set(transfers.flatMap((t) => t.lines.map((l) => l.receiptId)));
    return receipts
      .filter((r) => r.warehouse === site.warehouseName && readyForTransfer(r) && !onABkt.has(r.id))
      .sort((a, b) => (a.lotNo! < b.lotNo! ? 1 : -1));
  }, [receipts, transfers, loading, site.warehouseName]);
  const lotOptions = useMemo(
    () => candidates.map((r) => ({
      value: r.id,
      label: r.lotNo!,
      detail: [normalizeSupplierName(r.supplierName) || "-", r.binNo || "no bin", r.vehicleNo].filter(Boolean).join(" · "),
    })),
    [candidates]
  );
  // Read back through the candidates, so a Lot that stopped being ready after it was ticked can't be sent unseen.
  const pickedLots = candidates.filter((r) => picked[r.id]);

  function toggle(receiptId: string) {
    const r = candidates.find((c) => c.id === receiptId);
    if (!r) return;
    setPicked((prev) => {
      const next = { ...prev };
      if (next[r.id]) delete next[r.id];
      else next[r.id] = { bags: r.stageData["n-unload"]?.["SACS (bags)"] ?? "", net: r.stageData["n-netwt"]?.["NET WT KGS"] ?? "" };
      return next;
    });
  }

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setSaving(true);
    try { await action(); await Promise.all([refetch(), refresh()]); return true; } catch (err) { setError(err instanceof Error ? err.message : String(err)); return false; } finally { setSaving(false); }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const ok = await run(() =>
      api.createTransfer({
        transferDate: date,
        fromWarehouse: site.warehouseName,
        toWarehouse: to,
        remarks: remarks.trim() || undefined,
        lines: pickedLots.map((r) => ({
          receiptId: r.id,
          bags: picked[r.id]!.bags.trim() ? Number(picked[r.id]!.bags) : null,
          netWeightKg: picked[r.id]!.net.trim() || null,
        })),
      })
    );
    if (ok) { setPicked({}); setRemarks(""); }
  }

  const lotLink = (l: TransferRequest["lines"][number]) => <TransferLotLink key={l.receiptId} line={l} siteSlug={site.slug} canOpen={visible.has(l.receiptId)} />;

  const columns: Column<TransferRequest>[] = [
    { label: "BKT", nowrap: true, render: (t) => <span className="font-mono text-[12.5px]">{t.id}</span> },
    { label: "Date", filter: { value: (t) => t.transferDate, kind: "date" }, nowrap: true, render: (t) => formatDate(t.transferDate) },
    { label: "From → To", filter: { value: (t) => `${t.fromWarehouse} → ${transferDestinationLabel(t)}` }, render: (t) => `${t.fromWarehouse} → ${transferDestinationLabel(t)}` },
    { label: "Truck", nowrap: true, render: (t) => t.truckNo ?? <span className="text-warmstone-300">not sent yet</span> },
    { label: "Lots", render: (t) => <span className="flex flex-wrap gap-x-2 gap-y-0.5">{t.lines.map(lotLink)}</span> },
    { label: "Bags sent", filter: { value: (t) => t.variance.bagsDispatched, kind: "number" }, nowrap: true, render: (t) => n(t.variance.bagsDispatched) },
    { label: "Bags received", filter: { value: (t) => t.variance.bagsReceived, kind: "number" }, nowrap: true, render: (t) => n(t.variance.bagsReceived) },
    { label: "Bag variance", filter: { value: (t) => t.variance.bagVariance, kind: "number" }, nowrap: true, render: (t) => n(t.variance.bagVariance, true) },
    { label: "Net sent (kg)", filter: { value: (t) => t.variance.netDispatchedKg, kind: "number" }, nowrap: true, render: (t) => n(t.variance.netDispatchedKg) },
    { label: "Net arrived (kg)", filter: { value: (t) => t.variance.netAtArrivalKg, kind: "number" }, nowrap: true, render: (t) => n(t.variance.netAtArrivalKg) },
    { label: "Weight variance (kg)", filter: { value: (t) => t.variance.weightVarianceKg, kind: "number" }, nowrap: true, render: (t) => n(t.variance.weightVarianceKg, true) },
    { label: "Status", filter: { value: (t) => TRANSFER_STATE_LABELS[t.state], kind: "select" }, nowrap: true, render: (t) => <Pill tone={TRANSFER_TONE[t.state]} label={TRANSFER_STATE_LABELS[t.state]} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        kicker={`${site.label} · ${site.sublabel}`}
        title="Transfers"
        lede={canSend
          ? "Move Lots to the Central warehouse on one truck - each truck is one BKT. You record what leaves; the receiving warehouse records what arrives, and the difference is worked out for you."
          : "Trucks coming from the Unit warehouse - each truck is one BKT. Open one to record what arrived and the bin each Lot went into, and the difference is worked out for you."}
        actions={<SiteSwitcher value={site.slug} onChange={(s) => s && switchSite(s)} />}
      />

      {canEdit && canSend && (
        <CollapsibleCard title="New transfer request" meta={`from ${site.warehouseName}`}>
          <form onSubmit={handleCreate} className="space-y-4 pt-3">
            <div className="grid sm:grid-cols-3 gap-4">
              <Field id="tr-date" label="Date"><DateInput id="tr-date" required value={date} onChange={setDate} className={inputClass} /></Field>
              <Field id="tr-to" label="To warehouse" hint={destinations.length ? undefined : "No Central warehouse is available yet: one needs the Central category and an ID code (Masters › Warehouses)."}>
                <select id="tr-to" required value={to} onChange={(e) => setTo(e.target.value)} className={inputClass}>
                  <option value="" disabled>Select…</option>
                  {/* A BKT goes warehouse to warehouse: every Central warehouse of Masters › Warehouses. */}
                  <optgroup label={WAREHOUSE_TYPE_LABEL.CENTRAL}>
                    {destinations.map((d) => <option key={d.site} value={d.site}>{d.site}</option>)}
                  </optgroup>
                </select>
              </Field>
              <Field id="tr-remarks" label="Remarks"><input id="tr-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} className={inputClass} /></Field>
            </div>

            <Field
              id="tr-lots"
              label={`Lots to send (${pickedLots.length} selected)`}
              hint={candidates.length ? undefined : "No Lot is ready to send. Choose \"Yes — transfers out\" on a receipt that passed quality, and its Lot will show here."}
            >
              <MultiSelect id="tr-lots" options={lotOptions} selected={pickedLots.map((r) => r.id)} onToggle={toggle} placeholder="Search Lot, supplier or truck, and tick each Lot to send" />
            </Field>

            {pickedLots.length > 0 && (
              <div className="border border-warmstone-200 rounded-xl divide-y divide-warmstone-100">
                {pickedLots.map((r) => {
                  const p = picked[r.id]!;
                  return (
                    <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-[13px]">
                      <span className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="font-medium text-warmstone-800">{r.lotNo}</span>
                        <span className="text-warmstone-500 truncate">{normalizeSupplierName(r.supplierName) || "-"} · {r.binNo || "no bin"}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <input aria-label={`Bags for ${r.lotNo}`} inputMode="numeric" value={p.bags} onChange={(e) => setPicked((prev) => ({ ...prev, [r.id]: { ...p, bags: e.target.value } }))} placeholder="Bags" className={`${inputClass} w-24`} />
                        <input aria-label={`Net kg for ${r.lotNo}`} inputMode="decimal" value={p.net} onChange={(e) => setPicked((prev) => ({ ...prev, [r.id]: { ...p, net: e.target.value } }))} placeholder="Net kg" className={`${inputClass} w-28`} />
                        <button type="button" aria-label={`Remove ${r.lotNo}`} onClick={() => toggle(r.id)} className="p-1.5 rounded-lg text-warmstone-400 hover:bg-warmstone-100 hover:text-warmstone-700 transition-colors">
                          <span aria-hidden="true" className="material-symbols-outlined text-[20px] block">close</span>
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button type="submit" disabled={saving || !pickedLots.length || !to} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold transition-all shadow-sm disabled:opacity-50">
                <span className="material-symbols-outlined text-[17px]">swap_horiz</span>
                Create transfer
              </button>
              <span className="text-[12px] text-warmstone-500">The BKT number is issued when you create it; the truck is added when it is dispatched.</span>
            </div>
          </form>
        </CollapsibleCard>
      )}

      {error && <p role="alert" className="px-1 text-[13px] text-danger-700">{error}</p>}

      <FilterBar>
        <input placeholder="Search BKT, truck, Lot, warehouse…" value={search.q} onChange={(e) => search.setQ(e.target.value)} className="w-full sm:w-64" />
      </FilterBar>
      <DataTable
        columns={columns}
        rows={search.filtered}
        keyFn={(t) => t.id}
        rowHref={(t) => `/${site.slug}/transfers/${encodeURIComponent(t.id)}`}
        emptyTitle="No transfers yet"
        emptyHint={canSend ? "Create a transfer request to send Lots to the Central warehouse." : "Trucks sent from the Unit warehouse will show here."}
      />
    </div>
  );
}
