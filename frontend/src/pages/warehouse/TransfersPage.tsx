import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { Pill } from "../../components/ui/Pill";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { useTracking, useTransfers } from "../../state/TrackingContext";
import { useSite, useSwitchSite } from "../../state/SiteContext";
import { useCanEditDirectly } from "../../state/AuthContext";
import { SITE_LIST } from "../../config/sites";
import { api } from "../../repository/api";
import { deriveStatus } from "../../domain/receiptStatus";
import { TRANSFER_STATUSES, TRANSFER_STATUS_LABELS } from "../../data/transfers";
import type { ReceiptRecord, TransferRequest, TransferStatus } from "../../types/receipt";

const TONE: Record<TransferStatus, string> = { requested: "decision", dispatched: "term", received: "entry" };

const inputClass =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";

const today = () => new Date().toISOString().slice(0, 10);

/** A Lot can go on a transfer once: it needs a Lot (so it passed quality), must not be rejected and
 * must not already be on one. The API enforces all three; this only keeps the picker honest. */
function transferable(r: ReceiptRecord): boolean {
  const status = deriveStatus(r);
  return Boolean(r.lotNo) && status !== "rejected" && status !== "transferred_out";
}

interface Pick { bags: string; net: string }

/**
 * Transfer Requests — moving Lots to another warehouse, numbered BKT-<year>-NNN. A line is a Lot:
 * its supplier, fiche and Lot number come from the receipt, and the bags and net weight start as
 * what that receipt recorded, so nothing is typed twice. Adding a Lot here is the transfer decision
 * for that truck, so its status moves to "transferred out".
 */
export function TransfersPage() {
  const site = useSite();
  const switchSite = useSwitchSite();
  const canEdit = useCanEditDirectly();
  const { receipts, refresh } = useTracking();
  const { transfers, refetch } = useTransfers(site.warehouseName);
  const search = useTableSearch(transfers, (t) => [t.id, t.fromWarehouse, t.toWarehouse, ...t.lines.map((l) => l.lotNumber)]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [date, setDate] = useState(today());
  const [to, setTo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lotFilter, setLotFilter] = useState("");
  const [picked, setPicked] = useState<Record<string, Pick>>({});

  const destinations = SITE_LIST.filter((s) => s.warehouseName !== site.warehouseName);
  const candidates = useMemo(
    () =>
      receipts
        .filter((r) => r.warehouse === site.warehouseName && transferable(r))
        .filter((r) => !lotFilter.trim() || `${r.lotNo} ${r.supplierName} ${r.vehicleNo}`.toLowerCase().includes(lotFilter.trim().toLowerCase()))
        .sort((a, b) => (a.lotNo! < b.lotNo! ? 1 : -1))
        .slice(0, 50),
    [receipts, site.warehouseName, lotFilter]
  );

  function toggle(r: ReceiptRecord) {
    setPicked((prev) => {
      const next = { ...prev };
      if (next[r.id]) delete next[r.id];
      else next[r.id] = { bags: r.stageData["n-unload"]?.["SACS (bags)"] ?? "", net: r.stageData["n-netwt"]?.["NET WT KGS"] ?? "" };
      return next;
    });
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.createTransfer({
        transferDate: date,
        fromWarehouse: site.warehouseName,
        toWarehouse: to,
        remarks: remarks.trim() || undefined,
        lines: Object.entries(picked).map(([receiptId, p]) => ({
          receiptId,
          bags: p.bags.trim() ? Number(p.bags) : null,
          netWeightKg: p.net.trim() || null,
        })),
      });
      setPicked({});
      setRemarks("");
      await Promise.all([refetch(), refresh()]); // the Lots' receipts now read "transferred out"
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function advance(t: TransferRequest) {
    const next = TRANSFER_STATUSES[TRANSFER_STATUSES.indexOf(t.status) + 1];
    if (!next) return;
    setError(null);
    try {
      await api.setTransferStatus(t.id, next);
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const columns: Column<TransferRequest>[] = [
    { label: "Transfer", render: (t) => <span className="font-mono text-[12.5px]">{t.id}</span> },
    { label: "Date", render: (t) => t.transferDate },
    { label: "From → To", render: (t) => `${t.fromWarehouse} → ${t.toWarehouse}` },
    {
      label: "Lots",
      render: (t) => (
        <span className="flex flex-wrap gap-x-2 gap-y-0.5">
          {t.lines.map((l) => (
            <Link key={l.receiptId} to={`/${site.slug}/receipts/${l.receiptId}`} className="font-mono text-[11.5px] text-brand-700 hover:text-brand-800">
              {l.lotNumber ?? l.receiptId}
            </Link>
          ))}
        </span>
      ),
    },
    { label: "Bags", render: (t) => t.lines.reduce((n, l) => n + (l.bags ?? 0), 0).toLocaleString() },
    { label: "Net (kg)", render: (t) => t.lines.reduce((n, l) => n + (l.netWeightKg ?? 0), 0).toLocaleString() },
    { label: "Status", render: (t) => <Pill tone={TONE[t.status]} label={TRANSFER_STATUS_LABELS[t.status]} /> },
    {
      label: "",
      render: (t) => {
        const next = TRANSFER_STATUSES[TRANSFER_STATUSES.indexOf(t.status) + 1];
        return canEdit && next ? (
          <button type="button" onClick={() => void advance(t)} className="text-[11.5px] font-semibold text-brand-700 hover:text-brand-800 whitespace-nowrap">
            Mark {TRANSFER_STATUS_LABELS[next].toLowerCase()}
          </button>
        ) : null;
      },
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        kicker={`${site.label} · ${site.sublabel}`}
        title="Transfers"
        lede="Move Lots to another warehouse. Each request gets a BKT number; a Lot can be on one transfer only."
        actions={<SiteSwitcher value={site.slug} onChange={(s) => s && switchSite(s)} />}
      />

      {canEdit && (
        <CollapsibleCard title="New transfer request" meta={`from ${site.warehouseName}`}>
          <form onSubmit={handleCreate} className="space-y-4 pt-3">
            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="tr-date" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">Date</label>
                <input id="tr-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label htmlFor="tr-to" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">To warehouse</label>
                <select id="tr-to" required value={to} onChange={(e) => setTo(e.target.value)} className={inputClass}>
                  <option value="" disabled>Select…</option>
                  {destinations.map((s) => <option key={s.slug} value={s.warehouseName}>{s.label} · {s.sublabel}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="tr-remarks" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">Remarks</label>
                <input id="tr-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} className={inputClass} />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="text-[12.5px] font-semibold text-warmstone-700">Lots to send ({Object.keys(picked).length} selected)</span>
                <input placeholder="Filter Lot, supplier, truck…" value={lotFilter} onChange={(e) => setLotFilter(e.target.value)} className={`${inputClass} sm:w-64`} />
              </div>
              <div className="border border-warmstone-200 rounded-xl divide-y divide-warmstone-100 max-h-72 overflow-y-auto">
                {candidates.length === 0 && <p className="px-4 py-3 text-[13px] text-warmstone-400">No Lot here can be transferred — a truck needs a Lot (it passed quality) and must not already be on a transfer.</p>}
                {candidates.map((r) => {
                  const p = picked[r.id];
                  return (
                    <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-[13px]">
                      <label className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer">
                        <input type="checkbox" checked={Boolean(p)} onChange={() => toggle(r)} />
                        <span className="font-mono text-[12px]">{r.lotNo}</span>
                        <span className="text-warmstone-500 truncate">{r.supplierName || "—"} · {r.vehicleNo || "no truck"}</span>
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
              <span className="text-[12px] text-warmstone-500">The BKT number is issued when you create it.</span>
            </div>
          </form>
        </CollapsibleCard>
      )}

      {error && <p role="alert" className="px-1 text-[13px] text-danger-700">{error}</p>}

      <FilterBar>
        <input placeholder="Search transfer, Lot, warehouse…" value={search.q} onChange={(e) => search.setQ(e.target.value)} className="w-full sm:w-64" />
      </FilterBar>
      <DataTable
        columns={columns}
        rows={search.filtered}
        keyFn={(t) => t.id}
        emptyTitle="No transfers yet"
        emptyHint="Create a transfer request to send Lots to another warehouse."
      />
    </div>
  );
}
