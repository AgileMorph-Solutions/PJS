import { canCorrectRecords } from "@anagroci/contract/data/roles";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { siteTypeOf } from "@anagroci/contract/domain/siteType";
import { transferDestinationLabel, transferStateLabel, type TransferDestination } from "@anagroci/contract/domain/transfers";
import { lotPieceProblem, pieceNetKg, pieceWeightProblem, readNumber, TRANSFER_LOT_STATUS_LABELS } from "@anagroci/contract/domain/transferLot";
import { formatDate, todayIso } from "@anagroci/contract/domain/dateFormat";
import { formatKg, formatTonnes } from "../../components/production/batchUi";
import { WAREHOUSE_TYPE_LABEL } from "../../data/warehouseTypes";
import { PageHeader } from "../../components/ui/PageHeader";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { MultiSelect, type MultiSelectOption } from "../../components/ui/MultiSelect";
import { Pill } from "../../components/ui/Pill";
import { Button } from "../../components/ui/Button";
import { DateInput } from "../../components/ui/DateInput";
import { Field, Input, inputClass, Select } from "../../components/ui/Input";
import type { SearchSelectOption } from "../../components/ui/SearchSelect";
import { n, TRANSFER_TONE, TransferLotLink } from "../../components/transfers/TransferPanel";
import { TransferLotLine } from "../../components/transfers/TransferLotLine";
import { MakeLotForm } from "../../components/transfers/MakeLotForm";
import { TransferLotsTable } from "../../components/transfers/TransferLotsTable";
import { WeighLotModal } from "../../components/transfers/WeighLotModal";
import { PutBackModal } from "../../components/transfers/PutBackModal";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { useTracking, useTransferLots, useTransfers } from "../../state/TrackingContext";
import { useSite, useSwitchSite } from "../../state/SiteContext";
import { useCanEditDirectly, useMe } from "../../state/AuthContext";
import { api, type SiteBinSummary } from "../../repository/api";
import type { TransferLot, TransferRequest } from "../../types/receipt";

/** The Bins a BKT was loaded from: the Bins each lot on it was made from, or on an older BKT the line's own Bin. Every BKT
 * comes out of a Bin (25 Nov 2026: lot lines used to show none, as their Bins are the lot's, not the line's). */
const loadedFrom = (t: TransferRequest) =>
  [...new Set(t.lines.flatMap((l) => (l.transferLotId ? l.transferLotBins : [(l.binCode ?? "").trim()])).filter(Boolean))].join(", ");

/** "500 bags · 41,000 kg" left of a lot. */
const leftOf = (l: TransferLot) => `Left to load: ${l.leftBags.toLocaleString("en-US")} bags${l.leftKg !== null ? ` · ${formatKg(l.leftKg)}` : ""}`;

/**
 * Transfers — moving RCN from the Unit warehouse to the Central one (24 Nov 2026). A Bin holds hundreds of tonnes, so it is
 * never sent whole: bags are taken out of one or more Bins and weighed together as a lot; lots go on trucks, each truck one
 * BKT. A lot can go on several trucks and a truck can carry several lots. The Central warehouse receives each truck on its
 * Reception page, where each lot on it becomes a lot of its own there.
 *
 * Two warehouses write two halves, and neither writes the other's: the sending one says what left (the truck, and what its
 * scale read), the receiving one what arrived. The variance and the in-transit / closed / discrepancy state are worked out.
 */
export function TransfersPage() {
  const site = useSite();
  const switchSite = useSwitchSite();
  const canEdit = useCanEditDirectly();
  // Who changes a lot already on a truck, or undoes a put-back: an Admin or the Incharge (contract canCorrectRecords).
  const canCorrect = canCorrectRecords(useMe().role);
  const { masters, receipts, refresh } = useTracking();
  const { transfers, refetch } = useTransfers(site.warehouseName);
  const canSend = siteTypeOf(masters.warehouses, masters.aliases, site.warehouseName) === "UNIT";
  const { lots, refetch: refetchLots } = useTransferLots(canSend ? site.warehouseName : undefined);
  const search = useTableSearch(transfers, (t) => [t.id, t.truckNo, t.fromWarehouse, t.toWarehouse, t.toStore, ...t.lines.flatMap((l) => [l.transferLotNo, l.lotNumber, l.binCode, l.receivedLotNo])]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // This warehouse's Bins with the stock each shows: picked from when a lot is made, and judged against when it is weighed.
  const [bins, setBins] = useState<SiteBinSummary[]>([]);
  // A failed reload keeps the stock last read: an empty list would make every Bin look empty. The failure is said, though
  // (26 Nov 2026: a server error left the Bin dropdown silently empty, and nobody could tell why).
  const [binsError, setBinsError] = useState<string | null>(null);
  const loadBins = useCallback(() => api.listBins(site.warehouseName)
    .then((b) => { setBins(b); setBinsError(null); })
    .catch((e) => setBinsError(e instanceof Error ? e.message : String(e))), [site.warehouseName]);
  useEffect(() => { if (canSend) void loadBins(); }, [canSend, loadBins]);
  // In kg, never tonnes: a small amount taken out must still show (user, 24 Nov 2026), and in red so the stock is read at a glance.
  const binOptions = useMemo<SearchSelectOption[]>(() => bins.map((b) => ({
    value: b.binCode, label: b.binCode, detail: "In stock",
    // Tonnes to read at a glance, the exact kg beside it (formatTonnes leaves kg alone under 50 kg).
    figure: { value: formatTonnes(b.kg), ...(Math.abs(b.kg) >= 50 ? { note: formatKg(b.kg) } : {}) },
  })), [bins]);
  const binKg = useMemo(() => new Map(bins.map((b) => [b.binCode, b.kg])), [bins]);

  // From the server, not the master: a Unit warehouse's own master holds only itself, yet it sends to a Central one.
  const [destinations, setDestinations] = useState<TransferDestination[]>([]);
  useEffect(() => {
    if (!canSend) return;
    let live = true;
    api.transferDestinations(site.warehouseName).then((d) => { if (live) setDestinations(d); }).catch(() => { if (live) setDestinations([]); });
    return () => { live = false; };
  }, [canSend, site.warehouseName]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setSaving(true);
    try { await action(); await Promise.all([refetch(), refetchLots(), loadBins(), refresh()]); return true; } catch (err) { setError(err instanceof Error ? err.message : String(err)); return false; } finally { setSaving(false); }
  }

  const suggestLotNo = useCallback(
    (date: string) => api.previewLotNumbers(site.warehouseName, date, 1).then((r) => r.lotNos[0]).catch(() => undefined),
    [site.warehouseName],
  );

  // A Bin's page ("Send on a transfer") opens this page with ?bin=: the lot form starts from that Bin.
  const [params] = useSearchParams();
  const fromBin = params.get("bin")?.trim().toUpperCase();

  const [weighing, setWeighing] = useState<TransferLot | null>(null);
  const [puttingBack, setPuttingBack] = useState<TransferLot | null>(null);

  // ── A new BKT: the lots that go on the truck, and how many bags of each ──
  const [date, setDate] = useState(todayIso());
  const [to, setTo] = useState("");
  const [remarks, setRemarks] = useState("");
  // Per picked lot: the bags on this truck and their net kg. The kg follows the bags (their share of the lot's weighing) until
  // the person types their own (`kgTyped`), which is then kept.
  const [picked, setPicked] = useState<Record<number, { bags: string; kg: string; kgTyped: boolean }>>({});
  const loadable = lots.filter((l) => l.status === "ready" || l.status === "part_loaded");
  const lotOptions = useMemo<MultiSelectOption[]>(() => [
    ...loadable.map((l) => ({
      value: String(l.id), label: l.lotNo,
      detail: `${l.leftBags.toLocaleString("en-US")} bags${l.leftKg !== null ? ` (${formatKg(l.leftKg)})` : ""} to load · from ${l.bins.map((b) => b.binCode).join(", ")}`,
      detailTone: "emphasis" as const,
    })),
    // Shown, never pickable: a lot is loaded only once it is weighed.
    ...lots.filter((l) => l.status === "waiting_weight").map((l) => ({ value: String(l.id), label: l.lotNo, detail: "not weighed yet: record its weight in step 2 first", disabled: true })),
    // Weighed, but its quality is the QFS Officer's to record (26 Nov 2026): it leaves with the lot, so it comes first.
    ...lots.filter((l) => l.status === "waiting_quality").map((l) => ({ value: String(l.id), label: l.lotNo, detail: "no quality yet: the QFS Officer records moisture, KOR and nut count first", disabled: true })),
  ], [lots, loadable]);
  // Read back through the loadable lots, so one that stopped being loadable after it was ticked can't be sent unseen.
  const pickedLots = loadable.filter((l) => picked[l.id] !== undefined);
  /** What `bags` of the lot weigh by its weighing; null while the bag count can't be right. */
  const byBags = (l: TransferLot, bags: string) => (lotPieceProblem(bags, l.leftBags)?.soft === false ? null : pieceNetKg(l.netKg, l.bags, readNumber(bags) ?? 0));
  const kgText = (x: number | null) => (x === null ? "" : String(x));
  const bagsProblem = (l: TransferLot) => lotPieceProblem(picked[l.id]?.bags ?? "", l.leftBags);
  const weightProblem = (l: TransferLot) => pieceWeightProblem(picked[l.id]?.kg ?? "", byBags(l, picked[l.id]?.bags ?? ""));
  const lotsBlocked = pickedLots.some((l) => bagsProblem(l)?.soft === false || weightProblem(l)?.soft === false);

  function toggle(value: string) {
    const lot = loadable.find((l) => String(l.id) === value);
    if (!lot) return;
    setPicked((prev) => {
      const next = { ...prev };
      if (next[lot.id] !== undefined) delete next[lot.id];
      else next[lot.id] = { bags: String(lot.leftBags), kg: kgText(lot.leftKg), kgTyped: false };
      return next;
    });
  }

  function setBags(l: TransferLot, bags: string) {
    setPicked((prev) => {
      const was = prev[l.id]!;
      return { ...prev, [l.id]: { ...was, bags, kg: was.kgTyped ? was.kg : kgText(byBags(l, bags)) } };
    });
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (lotsBlocked) return;
    const ok = await run(() => api.createTransfer({
      transferDate: date, fromWarehouse: site.warehouseName, toWarehouse: to, remarks: remarks.trim() || undefined,
      // A weight left as worked out is not sent: the server works it out from the lot, so it can't drift from it.
      lines: pickedLots.map((l) => ({ transferLotId: l.id, bags: picked[l.id]!.bags, netWeightKg: picked[l.id]!.kgTyped ? picked[l.id]!.kg : null })),
    }));
    if (ok) { setPicked({}); setRemarks(""); }
  }

  // The receipts this site can open; a Lot on an older BKT made per Lot links to its receipt.
  const visible = useMemo(() => new Set(receipts.map((r) => r.id)), [receipts]);
  const lineLink = (l: TransferRequest["lines"][number]) => <TransferLotLink key={l.id} line={l} siteSlug={site.slug} canOpen={visible.has(l.receiptId ?? "")} />;

  const columns: Column<TransferRequest>[] = [
    { label: "BKT", nowrap: true, render: (t) => <span className="font-mono text-[12px]">{t.id}</span> },
    { label: "Date", filter: { value: (t) => t.transferDate, kind: "date" }, nowrap: true, render: (t) => formatDate(t.transferDate) },
    { label: "From → To", filter: { value: (t) => `${t.fromWarehouse} → ${transferDestinationLabel(t)}` }, render: (t) => `${t.fromWarehouse} → ${transferDestinationLabel(t)}` },
    { label: "Truck", nowrap: true, render: (t) => t.truckNo ?? <span className="text-warmstone-400">not sent yet</span> },
    { label: "Lots", render: (t) => <span className="flex flex-col gap-0.5 whitespace-nowrap">{t.lines.map(lineLink)}</span> },
    { label: "From Bin", filter: { value: (t) => loadedFrom(t) }, render: (t) => loadedFrom(t) || "-" },
    { label: "Bags sent", filter: { value: (t) => t.variance.bagsDispatched, kind: "number" }, nowrap: true, render: (t) => n(t.variance.bagsDispatched) },
    { label: "Bags received", filter: { value: (t) => t.variance.bagsReceived, kind: "number" }, nowrap: true, render: (t) => n(t.variance.bagsReceived) },
    { label: "Bag variance", filter: { value: (t) => t.variance.bagVariance, kind: "number" }, nowrap: true, render: (t) => n(t.variance.bagVariance, true) },
    { label: "Net sent (kg)", filter: { value: (t) => t.variance.netDispatchedKg, kind: "number" }, nowrap: true, render: (t) => n(t.variance.netDispatchedKg) },
    { label: "Net arrived (kg)", filter: { value: (t) => t.variance.netAtArrivalKg, kind: "number" }, nowrap: true, render: (t) => n(t.variance.netAtArrivalKg) },
    { label: "Weight variance (kg)", filter: { value: (t) => t.variance.weightVarianceKg, kind: "number" }, nowrap: true, render: (t) => n(t.variance.weightVarianceKg, true) },
    { label: "Status", filter: { value: (t) => transferStateLabel(t, site.warehouseName), kind: "select" }, nowrap: true, render: (t) => <Pill tone={TRANSFER_TONE[t.state]} label={transferStateLabel(t, site.warehouseName)} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        kicker={`${site.label} · ${site.sublabel}`}
        title="Transfers"
        lede={canSend
          ? "Sending RCN to the Central warehouse takes four steps: take bags out of Bins as a lot, weigh the lot, put lots on a truck, then dispatch the truck. The Central warehouse receives it on its Reception page."
          : "Trucks coming from the Unit warehouse, each one BKT. Receive them on the Reception page (From Unit warehouse), where each lot on the truck becomes a lot of this warehouse."}
        actions={<SiteSwitcher value={site.slug} onChange={(s) => s && switchSite(s)} />}
      />

      {!canSend && (
        <p className="text-[13px] text-warmstone-800">
          To record a truck that has arrived, open <Link to={`/${site.slug}/receipts/from-unit`} className="font-semibold text-brand-700 hover:text-brand-800">Reception › From Unit warehouse</Link>.
        </p>
      )}

      {error && <p role="alert" className="px-1 text-[13px] text-danger-700">{error}</p>}

      {canSend && (
        <>
          {canEdit && (
            <CollapsibleCard title="Step 1 · Make a lot from Bins" meta="count the bags you take out of each Bin" defaultOpen={Boolean(fromBin) || Boolean(binsError)}>
              {binsError && (
                <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-danger-200 bg-danger-50 px-3 py-2.5">
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-danger-700">error</span>
                  <p className="min-w-[12rem] flex-1 text-[12px] text-danger-700">This warehouse's Bins couldn't be loaded, so none can be picked. {binsError}</p>
                  <Button variant="secondary" icon="refresh" onClick={() => void loadBins()}>Try again</Button>
                </div>
              )}
              <MakeLotForm
                binOptions={binOptions}
                initialBin={fromBin}
                suggestLotNo={suggestLotNo}
                saving={saving}
                onCreate={(p) => run(() => api.createTransferLot({ ...p, warehouse: site.warehouseName }))}
              />
            </CollapsibleCard>
          )}

          <section className="space-y-3">
            <div>
              <h2 className="text-[17px] font-bold text-warmstone-900">Step 2 · Weigh each lot</h2>
              <p className="text-[12px] text-warmstone-500">A lot can go on a truck once its weight and quality are recorded ("Record weight").</p>
            </div>
            <TransferLotsTable
              lots={lots}
              canEdit={canEdit}
              canCorrect={canCorrect}
              onWeigh={(l) => { setWeighing(l); void loadBins(); }}
              onDelete={(l) => { if (window.confirm(`Delete ${l.lotNo}? Its bags go back to their Bins.`)) void run(() => api.deleteTransferLot(l.id)); }}
              onPutBack={(l) => { setPuttingBack(l); void loadBins(); }}
              onUndoPutBack={(l, returnId) => { if (window.confirm(`Undo this put-back? Its bags become ${l.lotNo}'s to load again, and the Bin goes back down.`)) void run(() => api.undoPutBack(l.id, returnId)); }}
            />
          </section>

          {canEdit && (
            <CollapsibleCard title="Step 3 · Put lots on a truck" meta="creates the truck's BKT number">
              <form onSubmit={handleCreate} className="space-y-4 pt-3" noValidate>
                <div className="grid sm:grid-cols-3 gap-4">
                  <Field label="Date *"><DateInput id="tr-date" required value={date} onChange={setDate} className={inputClass} /></Field>
                  <Field label="To warehouse *" hint={destinations.length ? undefined : "No Central warehouse is available yet: one needs the Central category and an ID code (Masters › Warehouses)."}>
                    <Select required value={to} onChange={(e) => setTo(e.target.value)}>
                      <option value="" disabled>Select…</option>
                      {/* A BKT goes warehouse to warehouse: every Central warehouse of Masters › Warehouses. */}
                      <optgroup label={WAREHOUSE_TYPE_LABEL.CENTRAL}>
                        {destinations.map((d) => <option key={d.site} value={d.site}>{d.site}</option>)}
                      </optgroup>
                    </Select>
                  </Field>
                  <Field label="Remarks"><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
                </div>

                <Field
                  label={`Lots going on this truck (${pickedLots.length} chosen)`}
                  hint={loadable.length ? "Tick each lot going on this truck. A lot bigger than the truck can be split: put part of it now, the rest on the next truck." : "No lot is ready yet. Make a lot (step 1) and record its weight (step 2), then it shows here."}
                >
                  <MultiSelect id="tr-lots" options={lotOptions} selected={pickedLots.map((l) => String(l.id))} onToggle={toggle} placeholder="Choose the lots going on this truck…" />
                </Field>

                {pickedLots.length > 0 && (
                  <div className="border border-warmstone-200 rounded-xl divide-y divide-warmstone-100">
                    {pickedLots.map((l) => {
                      const p = picked[l.id]!;
                      const share = byBags(l, p.bags);
                      return (
                        <TransferLotLine
                          key={l.id}
                          lotNo={l.lotNo}
                          detail={[l.bins.map((b) => b.binCode).join(", "), `${l.moisture}% · KOR ${l.kor} · ${l.nutCount} nuts`, TRANSFER_LOT_STATUS_LABELS[l.status]].join(" · ")}
                          leftLabel={leftOf(l)}
                          bags={p.bags}
                          weight={p.kg}
                          weightHint={p.kgTyped ? (share === null ? undefined : `By the lot's weighing: ${formatKg(share)}`) : "Worked out from the bags. Change it if you need to."}
                          bagsProblem={bagsProblem(l)}
                          weightProblem={weightProblem(l)}
                          onBags={(v) => setBags(l, v)}
                          onWeight={(v) => setPicked((prev) => ({ ...prev, [l.id]: { ...prev[l.id]!, kg: v, kgTyped: true } }))}
                          onRemove={() => toggle(String(l.id))}
                        />
                      );
                    })}
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <Button type="submit" icon="swap_horiz" disabled={saving || !pickedLots.length || !to || lotsBlocked}>Create transfer</Button>
                  <span className="text-[12px] text-warmstone-500">The BKT number is issued when you create it; the truck is added when it is dispatched.</span>
                </div>
              </form>
            </CollapsibleCard>
          )}
        </>
      )}

      <section className="space-y-3">
        {canSend && (
          <div>
            <h2 className="text-[17px] font-bold text-warmstone-900">Step 4 · Dispatch the truck</h2>
            <p className="text-[12px] text-warmstone-500">Open a truck to record its driver and loaded weight, then dispatch it. Each truck is one BKT.</p>
          </div>
        )}
        <FilterBar>
          <input placeholder="Search BKT, truck, lot, warehouse…" value={search.q} onChange={(e) => search.setQ(e.target.value)} className="w-full sm:w-64" />
        </FilterBar>
        <DataTable
          columns={columns}
          rows={search.filtered}
          keyFn={(t) => t.id}
          rowHref={(t) => `/${site.slug}/transfers/${encodeURIComponent(t.id)}`}
          emptyTitle="No transfers yet"
          emptyHint={canSend ? "Make a lot, weigh it, then create a transfer request to send it to the Central warehouse." : "Trucks sent from the Unit warehouse will show here."}
        />
      </section>

      {puttingBack && (
        <PutBackModal
          lot={puttingBack}
          binOptions={binOptions}
          saving={saving}
          onClose={() => setPuttingBack(null)}
          onSave={(d) => run(() => api.putBackTransferLot(puttingBack.id, { binCode: d.binCode, bags: d.bags, date: d.date, netWeightKg: d.netKg }))}
        />
      )}

      {weighing && (
        <WeighLotModal
          lot={weighing}
          binKg={binKg}
          saving={saving}
          onClose={() => setWeighing(null)}
          onSave={(d) => run(() => api.weighTransferLot(weighing.id, d))}
        />
      )}
    </div>
  );
}
