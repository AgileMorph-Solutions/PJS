import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { TRANSFER_STATE_LABELS, transferState, type TransferFacts, type TransferState } from "@anagroci/contract/domain/transfers";
import { PageHeader } from "../../components/ui/PageHeader";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { Pill } from "../../components/ui/Pill";
import { InfoCard, InfoRow } from "../../components/ui/InfoCard";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { useTracking, useTransfers } from "../../state/TrackingContext";
import { useSite, useSwitchSite } from "../../state/SiteContext";
import { useCanEditDirectly } from "../../state/AuthContext";
import { SITE_LIST } from "../../config/sites";
import { api } from "../../repository/api";
import { deriveStatus } from "../../domain/receiptStatus";
import type { ReceiptRecord, TransferRequest } from "../../types/receipt";
import { normalizeSupplierName } from "@anagroci/contract/domain/supplierCode";

const TONE: Record<TransferState, string> = { requested: "decision", in_transit: "term", closed: "entry", discrepancy: "gap" };

const inputClass =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";

const today = () => new Date().toISOString().slice(0, 10);
const n = (x: number | null, signed = false) => (x === null ? "-" : `${signed && x > 0 ? "+" : ""}${x.toLocaleString()}`);

/** A Lot can go on a transfer once: it needs a Lot (so it passed quality), must not be rejected and
 * must not already be on one. The API enforces all three; this only keeps the picker honest. */
function transferable(r: ReceiptRecord): boolean {
  const status = deriveStatus(r);
  return Boolean(r.lotNo) && status !== "rejected" && status !== "transferred_out";
}

interface Pick { bags: string; net: string }

const Field = ({ id, label, children, hint }: { id: string; label: string; children: ReactNode; hint?: string }) => (
  <div>
    <label htmlFor={id} className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">{label}</label>
    {children}
    {hint && <p className="mt-1 text-[11.5px] text-warmstone-500">{hint}</p>}
  </div>
);

/**
 * Transfers — moving Lots to another warehouse on ONE truck, numbered BKT-<year>-NNN. A line is a Lot:
 * its supplier, fiche and Lot number come from the receipt, and the bags and net weight start as what
 * that receipt recorded, so nothing is typed twice. Adding a Lot here is the transfer decision for
 * that truck, so its status moves to "transferred out".
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
  const { receipts, refresh } = useTracking();
  const { transfers, refetch } = useTransfers(site.warehouseName);
  const search = useTableSearch(transfers, (t) => [t.id, t.truckNo, t.fromWarehouse, t.toWarehouse, ...t.lines.map((l) => l.lotNumber)]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const [date, setDate] = useState(today());
  const [to, setTo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lotFilter, setLotFilter] = useState("");
  const [picked, setPicked] = useState<Record<string, Pick>>({});

  const destinations = SITE_LIST.filter((s) => s.warehouseName !== site.warehouseName);
  // The receipts this site can open; a Lot on an incoming BKT belongs to the OTHER site, so it is shown as text.
  const visible = useMemo(() => new Set(receipts.map((r) => r.id)), [receipts]);
  const candidates = useMemo(
    () =>
      receipts
        .filter((r) => r.warehouse === site.warehouseName && transferable(r))
        .filter((r) => !lotFilter.trim() || `${r.lotNo} ${r.supplierName} ${r.vehicleNo}`.toLowerCase().includes(lotFilter.trim().toLowerCase()))
        .sort((a, b) => (a.lotNo! < b.lotNo! ? 1 : -1))
        .slice(0, 50),
    [receipts, site.warehouseName, lotFilter]
  );
  const open = transfers.find((t) => t.id === openId);

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
    if (ok) { setPicked({}); setRemarks(""); } // the Lots' receipts now read "transferred out"
  }

  // A Lot's own quality-check result: what each line of a dispatch starts from.
  const qualityOf = (receiptId: string) => {
    const q = receipts.find((r) => r.id === receiptId)?.stageData["n-qfs"];
    return { moisture: q?.["MOIS. (moisture)"] ?? "", kor: q?.["FINAL KOR"] || q?.["KOR"] || "", nutCount: q?.["NUT COUNT"] ?? "" };
  };
  const lotLink = (l: TransferRequest["lines"][number]) =>
    visible.has(l.receiptId)
      ? <Link key={l.receiptId} to={`/${site.slug}/receipts/${l.receiptId}`} className="font-mono text-[11.5px] text-brand-700 hover:text-brand-800">{l.lotNumber ?? l.receiptId}</Link>
      : <span key={l.receiptId} className="font-mono text-[11.5px] text-warmstone-700">{l.lotNumber ?? l.receiptId}</span>;

  const columns: Column<TransferRequest>[] = [
    { label: "BKT", nowrap: true, render: (t) => <span className="font-mono text-[12.5px]">{t.id}</span> },
    { label: "Date", filter: { value: (t) => t.transferDate, kind: "date" }, nowrap: true, render: (t) => t.transferDate },
    { label: "From → To", filter: { value: (t) => `${t.fromWarehouse} → ${t.toWarehouse}` }, render: (t) => `${t.fromWarehouse} → ${t.toWarehouse}` },
    { label: "Truck", nowrap: true, render: (t) => t.truckNo ?? <span className="text-warmstone-300">not sent yet</span> },
    { label: "Lots", render: (t) => <span className="flex flex-wrap gap-x-2 gap-y-0.5">{t.lines.map(lotLink)}</span> },
    { label: "Bags sent", filter: { value: (t) => t.variance.bagsDispatched, kind: "number" }, nowrap: true, render: (t) => n(t.variance.bagsDispatched) },
    { label: "Bags received", filter: { value: (t) => t.variance.bagsReceived, kind: "number" }, nowrap: true, render: (t) => n(t.variance.bagsReceived) },
    { label: "Bag variance", filter: { value: (t) => t.variance.bagVariance, kind: "number" }, nowrap: true, render: (t) => n(t.variance.bagVariance, true) },
    { label: "Net sent (kg)", filter: { value: (t) => t.variance.netDispatchedKg, kind: "number" }, nowrap: true, render: (t) => n(t.variance.netDispatchedKg) },
    { label: "Net arrived (kg)", filter: { value: (t) => t.variance.netAtArrivalKg, kind: "number" }, nowrap: true, render: (t) => n(t.variance.netAtArrivalKg) },
    { label: "Weight variance (kg)", filter: { value: (t) => t.variance.weightVarianceKg, kind: "number" }, nowrap: true, render: (t) => n(t.variance.weightVarianceKg, true) },
    { label: "Status", filter: { value: (t) => TRANSFER_STATE_LABELS[t.state], kind: "select" }, nowrap: true, render: (t) => <Pill tone={TONE[t.state]} label={TRANSFER_STATE_LABELS[t.state]} /> },
    {
      label: "",
      render: (t) => (
        <button type="button" onClick={() => setOpenId(openId === t.id ? null : t.id)} className="text-[11.5px] font-semibold text-brand-700 hover:text-brand-800 whitespace-nowrap">
          {openId === t.id ? "Close" : "Open"}
        </button>
      ),
    },
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
              <Field id="tr-date" label="Date"><input id="tr-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} /></Field>
              <Field id="tr-to" label="To warehouse">
                <select id="tr-to" required value={to} onChange={(e) => setTo(e.target.value)} className={inputClass}>
                  <option value="" disabled>Select…</option>
                  {destinations.map((s) => <option key={s.slug} value={s.warehouseName}>{s.label} · {s.sublabel}</option>)}
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
                {candidates.length === 0 && <p className="px-4 py-3 text-[13px] text-warmstone-400">No Lot here can be transferred - a truck needs a Lot (it passed quality) and must not already be on a transfer.</p>}
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

      {open && <TransferPanel t={open} siteWarehouse={site.warehouseName} canEdit={canEdit} saving={saving} lotLink={lotLink} onDispatch={(p) => run(() => api.dispatchTransfer(open.id, p))} onReceive={(p) => run(() => api.receiveTransfer(open.id, p))} qualityOf={qualityOf} key={open.id} />}

      <FilterBar>
        <input placeholder="Search BKT, truck, Lot, warehouse…" value={search.q} onChange={(e) => search.setQ(e.target.value)} className="w-full sm:w-64" />
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

/** One BKT in full: what is on the truck, what left, what arrived — and the form this warehouse is allowed to fill in. */
function TransferPanel({
  t, siteWarehouse, canEdit, saving, lotLink, onDispatch, onReceive, qualityOf,
}: {
  /** A Lot's own quality-check result, to start each line's dispatch quality from. */
  qualityOf: (receiptId: string) => { moisture: string; kor: string; nutCount: string };
  t: TransferRequest;
  siteWarehouse: string;
  canEdit: boolean;
  saving: boolean;
  lotLink: (l: TransferRequest["lines"][number]) => ReactNode;
  onDispatch: (p: Parameters<typeof api.dispatchTransfer>[1]) => Promise<boolean>;
  onReceive: (p: Parameters<typeof api.receiveTransfer>[1]) => Promise<boolean>;
}) {
  const sending = canEdit && t.status === "requested" && t.fromWarehouse === siteWarehouse;
  const receiving = canEdit && t.status === "dispatched" && t.toWarehouse === siteWarehouse;
  const [d, setD] = useState({ truckNo: "", transporter: "", driver: "", driverPhone: "", gross: "", wr: "" });
  const [quality, setQuality] = useState<Record<string, { moisture: string; kor: string; nutCount: string }>>(() => Object.fromEntries(t.lines.map((l) => [l.receiptId, qualityOf(l.receiptId)])));
  const [r, setR] = useState({ bags: "", damaged: "", gross: "", kor: "", moisture: "", nuts: "", lot: "", comment: "", wr: "" });
  const v = t.variance;
  // The same test the server applies: if what arrived differs from what was sent, the receiving warehouse has to say why.
  const arrival: TransferFacts = {
    status: "received", lines: t.lines.map((l) => ({ bags: l.bags, netWeightKg: l.netWeightKg })), dispatchedGrossKg: t.dispatchedGrossKg,
    bagsReceived: r.bags.trim() === "" || Number.isNaN(Number(r.bags)) ? null : Number(r.bags),
    receivedGrossKg: r.gross.trim() === "" || Number.isNaN(Number(r.gross)) ? null : Number(r.gross),
  };
  const differs = transferState(arrival) === "discrepancy";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <InfoCard icon="local_shipping" title={`${t.id} · what left`} badge={<Pill tone={TONE[t.state]} label={TRANSFER_STATE_LABELS[t.state]} />}>
        <InfoRow label="From → To" value={`${t.fromWarehouse} → ${t.toWarehouse}`} />
        <InfoRow label="Truck" strong value={t.truckNo} />
        <InfoRow label="Warehouse receipt no." value={t.dispatchWhReceiptNo} />
        <InfoRow label="Transporter" value={t.transporter} />
        <InfoRow label="Driver" value={[t.driver, t.driverPhone].filter(Boolean).join(" · ") || undefined} />
        <InfoRow label="Loaded weight" value={t.dispatchedGrossKg === null ? undefined : `${t.dispatchedGrossKg.toLocaleString()} kg`} />
        <InfoRow label="Bags sent" value={n(v.bagsDispatched)} />
        <InfoRow label="Net sent" strong value={v.netDispatchedKg === null ? undefined : `${v.netDispatchedKg.toLocaleString()} kg`} />
        <InfoRow label="Dispatched" value={t.dispatchedAt ? `${t.dispatchedAt.slice(0, 10)}${t.dispatchedBy ? ` · ${t.dispatchedBy}` : ""}` : undefined} />
      </InfoCard>

      <InfoCard icon="inventory_2" title="What arrived" badge={t.status !== "received" ? <Pill tone="system" label="Not received yet" /> : undefined}>
        <InfoRow label="Warehouse receipt no." value={t.receiveWhReceiptNo} />
        <InfoRow label="Bags received" strong value={n(v.bagsReceived)} />
        <InfoRow label="Damaged bags" value={n(t.damagedBags)} />
        <InfoRow label="Gross received" value={t.receivedGrossKg === null ? undefined : `${t.receivedGrossKg.toLocaleString()} kg`} />
        <InfoRow label="Net at arrival" strong value={v.netAtArrivalKg === null ? undefined : `${v.netAtArrivalKg.toLocaleString()} kg`} />
        <InfoRow label="Bag variance" value={n(v.bagVariance, true)} />
        <InfoRow label="Weight variance" strong value={v.weightVarianceKg === null ? undefined : `${n(v.weightVarianceKg, true)} kg`} />
        <InfoRow label="KOR / moisture / nuts" value={[t.korReceived, t.moistureReceived, t.nutCountReceived].some((x) => x !== null) ? [t.korReceived, t.moistureReceived, t.nutCountReceived].map((x) => x ?? "-").join(" / ") : undefined} />
        <InfoRow label="Their Lot no." value={t.receivedLotNoRaw} />
        <InfoRow label="Received" value={t.receivedAt ? `${t.receivedAt.slice(0, 10)}${t.receivedBy ? ` · ${t.receivedBy}` : ""}` : undefined} />
        {t.receivedComment && <p className="pt-1 text-[12.5px] text-warmstone-600">{t.receivedComment}</p>}
      </InfoCard>

      <InfoCard icon="inventory" title={`Lots on the truck (${t.lines.length})`}>
        {t.lines.map((l) => (
          <div key={l.receiptId} className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0">{lotLink(l)} <span className="text-warmstone-500">{normalizeSupplierName(l.supplierName)}</span></span>
            <span className="text-right tabular-nums text-warmstone-700 shrink-0">{n(l.bags)} bags{l.binCode ? <span className="block text-[11px] text-warmstone-400">{l.binCode}</span> : null}
              {(l.moisture !== null || l.kor !== null) && <span className="block text-[11px] text-warmstone-500">moisture {l.moisture ?? "-"}% · KOR {l.kor ?? "-"}{l.nutCount !== null ? ` · ${l.nutCount} nuts` : ""}</span>}</span>
          </div>
        ))}
      </InfoCard>

      {sending && (
        <form
          onSubmit={(e) => { e.preventDefault(); void onDispatch({ whReceiptNo: d.wr, lines: t.lines.map((l) => ({ receiptId: l.receiptId, ...quality[l.receiptId] })), truckNo: d.truckNo, transporter: d.transporter, driver: d.driver, driverPhone: d.driverPhone, dispatchedGrossKg: d.gross || null }); }}
          className="lg:col-span-3 bg-white border-2 border-brand-700 rounded-2xl p-5 grid sm:grid-cols-2 lg:grid-cols-5 gap-4 items-start"
        >
          <Field id="dp-wr" label="Warehouse receipt no." hint="The receipt this dispatch is recorded against."><input id="dp-wr" required value={d.wr} onChange={(e) => setD({ ...d, wr: e.target.value })} className={inputClass} /></Field>
          <Field id="dp-truck" label="Truck number" hint="One BKT is one truck."><input id="dp-truck" required value={d.truckNo} onChange={(e) => setD({ ...d, truckNo: e.target.value })} className={inputClass} placeholder="1796GC01/3922BB04" /></Field>
          <Field id="dp-transporter" label="Transporter"><input id="dp-transporter" value={d.transporter} onChange={(e) => setD({ ...d, transporter: e.target.value })} className={inputClass} /></Field>
          <Field id="dp-driver" label="Driver"><input id="dp-driver" value={d.driver} onChange={(e) => setD({ ...d, driver: e.target.value })} className={inputClass} /></Field>
          <Field id="dp-phone" label="Driver phone"><input id="dp-phone" value={d.driverPhone} onChange={(e) => setD({ ...d, driverPhone: e.target.value })} className={inputClass} /></Field>
          <Field id="dp-gross" label="Loaded weight (kg)" hint="From your scale: RCN plus bags."><input id="dp-gross" inputMode="decimal" value={d.gross} onChange={(e) => setD({ ...d, gross: e.target.value })} className={inputClass} /></Field>
          <div className="sm:col-span-2 lg:col-span-5 space-y-2">
            <p className="text-[12.5px] font-semibold text-warmstone-700">Quality of each Lot on the truck <span className="font-normal text-warmstone-500">(from its own quality check; change a value only if it was measured again)</span></p>
            {t.lines.map((l) => (
              <div key={l.receiptId} className="grid grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] gap-3 items-center">
                <span className="text-[13px] font-mono text-warmstone-800 truncate">{l.lotNumber ?? l.receiptId}</span>
                {(["moisture", "kor", "nutCount"] as const).map((k) => (
                  <input
                    key={k} required={k !== "nutCount"} inputMode="decimal" aria-label={`${k === "nutCount" ? "Nut count" : k === "kor" ? "KOR" : "Moisture %"}, ${l.lotNumber ?? l.receiptId}`}
                    placeholder={k === "nutCount" ? "Nut count" : k === "kor" ? "KOR" : "Moisture %"} value={quality[l.receiptId]?.[k] ?? ""}
                    onChange={(e) => setQuality({ ...quality, [l.receiptId]: { ...quality[l.receiptId]!, [k]: e.target.value } })} className={inputClass}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="sm:col-span-2 lg:col-span-5 flex items-center gap-3">
            <button type="submit" disabled={saving || !d.truckNo.trim() || !d.wr.trim()} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold shadow-sm disabled:opacity-50">
              <span className="material-symbols-outlined text-[17px]">local_shipping</span>
              Dispatch truck
            </button>
            <span className="text-[12px] text-warmstone-500">Nothing about arrival is filled in here - the receiving warehouse records that.</span>
          </div>
        </form>
      )}

      {receiving && (
        <form
          onSubmit={(e) => { e.preventDefault(); void onReceive({ whReceiptNo: r.wr, bagsReceived: r.bags, receivedGrossKg: r.gross, damagedBags: r.damaged || null, korReceived: r.kor || null, moistureReceived: r.moisture || null, nutCountReceived: r.nuts || null, receivedLotNoRaw: r.lot || null, receivedComment: r.comment || null }); }}
          className="lg:col-span-3 bg-white border-2 border-brand-700 rounded-2xl p-5 grid sm:grid-cols-2 lg:grid-cols-4 gap-4 items-start"
        >
          <Field id="rc-wr" label="Warehouse receipt no." hint="Your own receipt for this arrival."><input id="rc-wr" required value={r.wr} onChange={(e) => setR({ ...r, wr: e.target.value })} className={inputClass} /></Field>
          <Field id="rc-bags" label="Bags received" hint={`${n(v.bagsDispatched)} were sent.`}><input id="rc-bags" required inputMode="numeric" value={r.bags} onChange={(e) => setR({ ...r, bags: e.target.value })} className={inputClass} /></Field>
          <Field id="rc-gross" label="Gross weight received (kg)" hint="From your scale: RCN plus bags."><input id="rc-gross" required inputMode="decimal" value={r.gross} onChange={(e) => setR({ ...r, gross: e.target.value })} className={inputClass} /></Field>
          <Field id="rc-damaged" label="Damaged bags"><input id="rc-damaged" inputMode="numeric" value={r.damaged} onChange={(e) => setR({ ...r, damaged: e.target.value })} className={inputClass} /></Field>
          <Field id="rc-lot" label="Your Lot number" hint="As you write it; kept exactly."><input id="rc-lot" value={r.lot} onChange={(e) => setR({ ...r, lot: e.target.value })} className={inputClass} /></Field>
          <Field id="rc-kor" label="KOR"><input id="rc-kor" inputMode="decimal" value={r.kor} onChange={(e) => setR({ ...r, kor: e.target.value })} className={inputClass} /></Field>
          <Field id="rc-moisture" label="Moisture (%)"><input id="rc-moisture" inputMode="decimal" value={r.moisture} onChange={(e) => setR({ ...r, moisture: e.target.value })} className={inputClass} /></Field>
          <Field id="rc-nuts" label="Nut count"><input id="rc-nuts" inputMode="numeric" value={r.nuts} onChange={(e) => setR({ ...r, nuts: e.target.value })} className={inputClass} /></Field>
          <Field id="rc-comment" label={differs ? "Why it differs *" : "Comment"} hint={differs ? "What arrived is not what was sent: say why (damaged bags, a short load, a weighing difference…)." : undefined}><input id="rc-comment" required={differs} value={r.comment} onChange={(e) => setR({ ...r, comment: e.target.value })} className={`${inputClass} ${differs ? "border-ambernut-300 bg-ambernut-50" : ""}`} /></Field>
          <div className="sm:col-span-2 lg:col-span-4 flex items-center gap-3">
            <button type="submit" disabled={saving || !r.bags.trim() || !r.gross.trim() || !r.wr.trim() || (differs && !r.comment.trim())} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold shadow-sm disabled:opacity-50">
              <span className="material-symbols-outlined text-[17px]">inventory_2</span>
              Record arrival
            </button>
            <span className="text-[12px] text-warmstone-500">Net at arrival and the variance are worked out from these.</span>
          </div>
        </form>
      )}
    </div>
  );
}
