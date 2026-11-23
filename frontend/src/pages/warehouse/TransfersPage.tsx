import { useEffect, useMemo, useState, type FormEvent } from "react";
import { siteTypeOf } from "@anagroci/contract/domain/siteType";
import { lotBinOf, lotPieceProblem, lotTransferProgress, pieceChanged, readyForTransfer, suggestedPiece, transferNeedsBin, transferDestinationLabel, TRANSFER_STATE_LABELS, type LotOnBkt, type LotTransferProgress, type TransferDestination } from "@anagroci/contract/domain/transfers";
import { parseQty } from "@anagroci/contract/domain/receiptMath";
import { formatKg } from "../../components/production/batchUi";
import { WAREHOUSE_TYPE_LABEL } from "../../data/warehouseTypes";
import { PageHeader } from "../../components/ui/PageHeader";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { MultiSelect, type MultiSelectOption } from "../../components/ui/MultiSelect";
import { Pill } from "../../components/ui/Pill";
import { Field, inputClass, n, TRANSFER_TONE, TransferLotLink } from "../../components/transfers/TransferPanel";
import { TransferLotLine } from "../../components/transfers/TransferLotLine";
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
import { useSearchParams } from "react-router-dom";
import { splitBinCodes } from "@anagroci/contract/domain/productionBatch";

const today = todayIso;

interface Pick { bags: string; net: string }

/** The Lot's size as its receipt recorded it: bags unloaded and net weight. */
const lotSize = (r: ReceiptRecord) => ({
  bags: parseQty(r.stageData["n-unload"]?.["SACS (bags)"]) ?? null,
  netKg: parseQty(r.stageData["n-netwt"]?.["NET WT KGS"]) ?? null,
});

/** "5,000 kg left of 40,000 kg" for a Lot already partly on a BKT; nothing for one not on any yet. */
function leftLabel(p: LotTransferProgress | undefined, r: ReceiptRecord): string | undefined {
  if (!p || p.sentBags + p.sentKg === 0) return undefined;
  const size = lotSize(r);
  if (p.leftKg !== null && size.netKg !== null) return `${formatKg(p.leftKg)} left of ${formatKg(size.netKg)}`;
  if (p.leftBags !== null && size.bags !== null) return `${p.leftBags} bags left of ${size.bags}`;
  return undefined;
}

const qty = (v: string) => parseQty(v) ?? null;

/** The Lot's Bin, for reference: the truck is loaded Lot by Lot, but people find the RCN by its Bin. Every offered Lot has one. */
const binRef = (r: ReceiptRecord) => `Bin ${lotBinOf(r)}`;

/** The Bins a BKT was loaded from, as each line recorded it. */
const binsOf = (t: TransferRequest) => [...new Set(t.lines.map((l) => (l.binCode ?? "").trim()).filter(Boolean))].join(", ");
const asText = (x: number | null) => (x === null ? "" : String(x));

/** "40 bags (1,960 kg)" — one amount, read at a glance; either half is left out when unknown. */
function amount(p: { bags: number | null; netWeightKg: number | null }): string {
  const bags = p.bags !== null ? `${p.bags.toLocaleString("en-US")} bags` : null;
  const kg = p.netWeightKg !== null ? formatKg(p.netWeightKg) : null;
  return bags && kg ? `${bags} (${kg})` : bags ?? kg ?? "-";
}

/**
 * What a picked Lot's line says beside its boxes: how much of the Lot there is (or is left), and a short warning when
 * the figures typed differ from that. A change is allowed — it is how a Lot is split — and the server keeps it on the
 * Lot's history; only sending more than the Lot holds is refused, and the warning says so before it is tried.
 */
function lineInfo(r: ReceiptRecord, pieces: readonly LotOnBkt[], pick: Pick): { sizeLabel?: string; warning?: string[] } {
  const size = lotSize(r);
  const whole = { bags: size.bags, netWeightKg: size.netKg };
  const known = size.bags !== null || size.netKg !== null;
  const suggested = suggestedPiece(size, pieces);
  const sizeLabel = pieces.length
    ? `Left to send: ${amount(suggested)}${known ? ` of ${amount(whole)}` : ""}`
    : known ? `Whole Lot: ${amount(whole)}` : undefined;
  const piece = { bags: qty(pick.bags), netWeightKg: qty(pick.net) };
  if (lotPieceProblem(r.lotNo ?? r.id, size, pieces, piece)) {
    return { sizeLabel, warning: [`Too much. This Lot has only ${amount(suggested)} to send.`, "Lower it to create the transfer."] };
  }
  if (!pieceChanged(suggested, piece)) return { sizeLabel };
  const after = lotTransferProgress(size, [...pieces, { transferId: "", ...piece }]);
  const left = { bags: after.leftBags && after.leftBags > 0 ? after.leftBags : null, netWeightKg: after.leftKg && after.leftKg > 0 ? after.leftKg : null };
  return {
    sizeLabel,
    warning: [
      `On this truck: ${amount(piece)}`,
      left.bags !== null || left.netWeightKg !== null ? `Left for another truck: ${amount(left)}` : `The Lot has ${amount(suggested)}`,
    ],
  };
}

/**
 * Transfers — moving Lots to another warehouse on ONE truck, numbered BKT-<year>-NNN. A line is a Lot:
 * its supplier, fiche and Lot number come from the receipt, and the bags and net weight start as what
 * that receipt recorded, so nothing is typed twice. A Lot bigger than one truck goes on several BKTs: it
 * stays on offer, starting from what is left of it, until all of it is on a truck. A Lot is offered here once it is in its
 * Bin with its GRN complete, and its Bin is shown beside it for reference; putting it on a BKT records "Yes — transfers
 * out" on its receipt. A Lot answered "No — stays" the old way stays off this page. RCN only moves from Unit to Central, so a
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
  const search = useTableSearch(transfers, (t) => [t.id, t.truckNo, t.fromWarehouse, t.toWarehouse, t.toStore, ...t.lines.flatMap((l) => [l.lotNumber, l.binCode])]);
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
  // A Lot in its Bin with its GRN complete is ready (or one marked "Yes" the old way); only the BKTs themselves say how much of it is already on one.
  // Nothing is offered until they have loaded, or a Lot already sent in full would show for a moment.
  const pieces = useMemo(() => {
    const out = new Map<string, LotOnBkt[]>();
    for (const t of transfers) for (const l of t.lines) if (l.receiptId) (out.get(l.receiptId) ?? out.set(l.receiptId, []).get(l.receiptId)!).push({ transferId: t.id, bags: l.bags, netWeightKg: l.netWeightKg });
    return out;
  }, [transfers]);
  const progress = useMemo(
    () => new Map(receipts.filter((r) => pieces.has(r.id)).map((r) => [r.id, lotTransferProgress(lotSize(r), pieces.get(r.id)!)])),
    [receipts, pieces]
  );
  const candidates = useMemo(() => {
    if (loading) return [];
    return receipts
      .filter((r) => r.warehouse === site.warehouseName && readyForTransfer(r) && !progress.get(r.id)?.fullySent)
      .sort((a, b) => (a.lotNo! < b.lotNo! ? 1 : -1));
  }, [receipts, progress, loading, site.warehouseName]);
  // Lots that would be ready but whose Bin isn't known: listed after the ready ones so nobody wonders where they went, never
  // pickable, each with a link to its receipt's Bin step. Once the Bin is recorded the Lot becomes a normal candidate.
  const needBin = useMemo(() => {
    if (loading) return [];
    return receipts
      .filter((r) => r.warehouse === site.warehouseName && transferNeedsBin(r) && !progress.get(r.id)?.fullySent)
      .sort((a, b) => (a.lotNo! < b.lotNo! ? 1 : -1));
  }, [receipts, progress, loading, site.warehouseName]);
  const lotOptions = useMemo<MultiSelectOption[]>(
    () => [
      ...candidates.map((r) => ({
        value: r.id,
        label: r.lotNo!,
        detail: [normalizeSupplierName(r.supplierName) || "-", binRef(r), r.vehicleNo, leftLabel(progress.get(r.id), r)].filter(Boolean).join(" · "),
      })),
      ...needBin.map((r) => ({
        value: r.id,
        label: r.lotNo!,
        detail: [normalizeSupplierName(r.supplierName) || "-", "no Bin yet, can't be sent", r.vehicleNo].filter(Boolean).join(" · "),
        disabled: true,
        action: { label: "Add Bin", to: `/${site.slug}/receipts/${encodeURIComponent(r.id)}?stage=n-bin` },
      })),
    ],
    [candidates, needBin, progress, site.slug]
  );
  // Read back through the candidates, so a Lot that stopped being ready after it was ticked can't be sent unseen.
  const pickedLots = candidates.filter((r) => picked[r.id]);

  function toggle(receiptId: string) {
    const r = candidates.find((c) => c.id === receiptId);
    if (!r) return;
    setPicked((prev) => {
      const next = { ...prev };
      if (next[r.id]) delete next[r.id];
      else {
        // What is left of the Lot when part of it is already on a BKT, otherwise the whole Lot as its receipt recorded it.
        const s = suggestedPiece(lotSize(r), pieces.get(r.id) ?? []);
        next[r.id] = { bags: asText(s.bags), net: asText(s.netWeightKg) };
      }
      return next;
    });
  }

  // A Bin's page ("Send on a transfer") opens this page with ?bin=: the ready Lots in that Bin are ticked once loaded.
  const [params] = useSearchParams();
  const fromBin = params.get("bin")?.trim().toUpperCase();
  const [binApplied, setBinApplied] = useState(false);
  useEffect(() => {
    if (!fromBin || binApplied || !candidates.length) return;
    setBinApplied(true);
    for (const r of candidates) if (splitBinCodes(r.stageData["n-bin"]?.["Bin Number"] || r.binNo).includes(fromBin)) toggle(r.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromBin, binApplied, candidates]);

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

  const lotLink = (l: TransferRequest["lines"][number]) => <TransferLotLink key={l.id} line={l} siteSlug={site.slug} canOpen={Boolean(l.receiptId && visible.has(l.receiptId))} />;

  const columns: Column<TransferRequest>[] = [
    { label: "BKT", nowrap: true, render: (t) => <span className="font-mono text-[12.5px]">{t.id}</span> },
    { label: "Date", filter: { value: (t) => t.transferDate, kind: "date" }, nowrap: true, render: (t) => formatDate(t.transferDate) },
    { label: "From → To", filter: { value: (t) => `${t.fromWarehouse} → ${transferDestinationLabel(t)}` }, render: (t) => `${t.fromWarehouse} → ${transferDestinationLabel(t)}` },
    { label: "Truck", nowrap: true, render: (t) => t.truckNo ?? <span className="text-warmstone-300">not sent yet</span> },
    { label: "Lots", render: (t) => <span className="flex flex-wrap gap-x-2 gap-y-0.5">{t.lines.map(lotLink)}</span> },
    { label: "From Bin", filter: { value: (t) => binsOf(t) }, render: (t) => binsOf(t) || "-" },
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
              hint={needBin.length
                ? `${needBin.length} Lot${needBin.length === 1 ? " has" : "s have"} no Bin yet and can't be sent: use "Add Bin" beside it to record where it is stored.`
                : candidates.length ? undefined : "No Lot is ready to send. A Lot shows here once it is in its Bin with its GRN complete."}
            >
              <MultiSelect id="tr-lots" options={lotOptions} selected={pickedLots.map((r) => r.id)} onToggle={toggle} placeholder="Search Lot, Bin, supplier or truck, and tick each Lot to send" />
            </Field>

            {pickedLots.length > 0 && (
              <div className="border border-warmstone-200 rounded-xl divide-y divide-warmstone-100">
                {pickedLots.map((r) => {
                  const p = picked[r.id]!;
                  const info = lineInfo(r, pieces.get(r.id) ?? [], p);
                  return (
                    <TransferLotLine
                      key={r.id}
                      lotNo={r.lotNo!}
                      detail={[normalizeSupplierName(r.supplierName) || "-", binRef(r)].join(" · ")}
                      sizeLabel={info.sizeLabel}
                      warning={info.warning}
                      bags={p.bags}
                      net={p.net}
                      onBags={(bags) => setPicked((prev) => ({ ...prev, [r.id]: { ...prev[r.id]!, bags } }))}
                      onNet={(net) => setPicked((prev) => ({ ...prev, [r.id]: { ...prev[r.id]!, net } }))}
                      onRemove={() => toggle(r.id)}
                    />
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
