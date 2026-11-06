import { useMemo, useState, type FormEvent } from "react";
import { readyForTransfer, transferDestinationLabel, transferDestinations, TRANSFER_STATE_LABELS } from "@anagroci/contract/domain/transfers";
import { PageHeader } from "../../components/ui/PageHeader";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { Pill } from "../../components/ui/Pill";
import { Field, inputClass, n, TRANSFER_TONE, TransferLotLink } from "../../components/transfers/TransferPanel";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { useTracking, useTransfers } from "../../state/TrackingContext";
import { useSite, useSwitchSite } from "../../state/SiteContext";
import { useCanEditDirectly } from "../../state/AuthContext";
import { api } from "../../repository/api";
import type { ReceiptRecord, TransferRequest } from "../../types/receipt";
import { normalizeSupplierName } from "@anagroci/contract/domain/supplierCode";
import { formatDate, todayIso } from "@anagroci/contract/domain/dateFormat";
import { DateInput } from "../../components/ui/DateInput";

const today = todayIso;

interface Pick { bags: string; net: string }

/**
 * Transfers — moving Lots to another warehouse on ONE truck, numbered BKT-<year>-NNN. A line is a Lot:
 * its supplier, fiche and Lot number come from the receipt, and the bags and net weight start as what
 * that receipt recorded, so nothing is typed twice. A Lot is offered here once its receipt says
 * "Yes — transfers out"; "No — stays" keeps it off this page.
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
  const [lotFilter, setLotFilter] = useState("");
  const [picked, setPicked] = useState<Record<string, Pick>>({});

  const destinations = transferDestinations(masters.warehouses, site.warehouseName);
  // The receipts this site can open; a Lot on an incoming BKT belongs to the OTHER site, so it is shown as text.
  const visible = useMemo(() => new Set(receipts.map((r) => r.id)), [receipts]);
  // Marked "Yes" on the receipt says it is ready; only the BKTs themselves say it has already gone on one.
  // Nothing is offered until they have loaded, or a Lot already on a BKT would show for a moment.
  const candidates = useMemo(() => {
    if (loading) return [];
    const onABkt = new Set(transfers.flatMap((t) => t.lines.map((l) => l.receiptId)));
    return receipts
      .filter((r) => r.warehouse === site.warehouseName && readyForTransfer(r) && !onABkt.has(r.id))
      .filter((r) => !lotFilter.trim() || `${r.lotNo} ${r.supplierName} ${r.vehicleNo}`.toLowerCase().includes(lotFilter.trim().toLowerCase()))
      .sort((a, b) => (a.lotNo! < b.lotNo! ? 1 : -1))
      .slice(0, 50);
  }, [receipts, transfers, loading, site.warehouseName, lotFilter]);

  function toggle(r: ReceiptRecord) {
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
        lines: Object.entries(picked).map(([receiptId, p]) => ({
          receiptId,
          bags: p.bags.trim() ? Number(p.bags) : null,
          netWeightKg: p.net.trim() || null,
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
        lede="Move Lots to another warehouse on one truck - each truck is one BKT. The sending warehouse records what leaves; the receiving warehouse records what arrives, and the difference is worked out for you."
        actions={<SiteSwitcher value={site.slug} onChange={(s) => s && switchSite(s)} />}
      />

      {canEdit && (
        <CollapsibleCard title="New transfer request" meta={`from ${site.warehouseName}`}>
          <form onSubmit={handleCreate} className="space-y-4 pt-3">
            <div className="grid sm:grid-cols-3 gap-4">
              <Field id="tr-date" label="Date"><DateInput id="tr-date" required value={date} onChange={setDate} className={inputClass} /></Field>
              <Field id="tr-to" label="To warehouse" hint={destinations.length ? undefined : "No warehouse is available. In Masters, give another site a Unit or Central type."}>
                <select id="tr-to" required value={to} onChange={(e) => setTo(e.target.value)} className={inputClass}>
                  <option value="" disabled>Select…</option>
                  {destinations.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Field>
              <Field id="tr-remarks" label="Remarks"><input id="tr-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} className={inputClass} /></Field>
            </div>

            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="text-[12.5px] font-semibold text-warmstone-700">Lots to send ({Object.keys(picked).length} selected)</span>
                <input placeholder="Filter Lot, supplier, truck…" value={lotFilter} onChange={(e) => setLotFilter(e.target.value)} className={`${inputClass} sm:w-64`} />
              </div>
              <div className="border border-warmstone-200 rounded-xl divide-y divide-warmstone-100 max-h-72 overflow-y-auto">
                {candidates.length === 0 && <p className="px-4 py-3 text-[13px] text-warmstone-500">No Lot is ready to send. Choose &quot;Yes — transfers out&quot; on a receipt that passed quality, and its Lot will show here.</p>}
                {candidates.map((r) => {
                  const p = picked[r.id];
                  return (
                    <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-[13px]">
                      <label className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer">
                        <input type="checkbox" checked={Boolean(p)} onChange={() => toggle(r)} />
                        <span className="font-mono text-[12px]">{r.lotNo}</span>
                        <span className="text-warmstone-500 truncate">{normalizeSupplierName(r.supplierName) || "-"} · {r.binNo || "no bin"}</span>
                      </label>
                      {p && (
                        <span className="flex items-center gap-2">
                          <input aria-label={`Bags for ${r.lotNo}`} inputMode="numeric" value={p.bags} onChange={(e) => setPicked((prev) => ({ ...prev, [r.id]: { ...p, bags: e.target.value } }))} placeholder="Bags" className={`${inputClass} w-24`} />
                          <input aria-label={`Net kg for ${r.lotNo}`} inputMode="decimal" value={p.net} onChange={(e) => setPicked((prev) => ({ ...prev, [r.id]: { ...p, net: e.target.value } }))} placeholder="Net kg" className={`${inputClass} w-28`} />
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button type="submit" disabled={saving || !Object.keys(picked).length || !to} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold transition-all shadow-sm disabled:opacity-50">
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
        emptyHint="Create a transfer request to send Lots to another warehouse."
      />
    </div>
  );
}
