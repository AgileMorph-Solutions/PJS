import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { lineNetAtArrival, TRANSFER_STATE_LABELS, transferDestinationLabel, transferState, type TransferFacts, type TransferState } from "@anagroci/contract/domain/transfers";
import { formatKg } from "../production/batchUi";
import { Pill } from "../ui/Pill";
import { InfoCard, InfoRow } from "../ui/InfoCard";
import { normalizeSupplierName } from "@anagroci/contract/domain/supplierCode";
import type { api } from "../../repository/api";
import type { TransferRequest } from "../../types/receipt";
import { formatDate } from "@anagroci/contract/domain/dateFormat";

/** The quality each Lot leaves with: all three are required to dispatch. */
const QUALITY = [
  { key: "moisture", label: "Moisture (%)" },
  { key: "kor", label: "KOR" },
  { key: "nutCount", label: "Nut count" },
] as const;

export const TRANSFER_TONE: Record<TransferState, string> = { requested: "decision", in_transit: "term", closed: "entry", discrepancy: "gap" };

export const inputClass =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";

export const n = (x: number | null, signed = false) => (x === null ? "-" : `${signed && x > 0 ? "+" : ""}${x.toLocaleString()}`);

export const Field = ({ id, label, children, hint }: { id: string; label: string; children: ReactNode; hint?: string }) => (
  <div>
    <label htmlFor={id} className="block text-[12px] font-semibold text-warmstone-700 mb-1.5">{label}</label>
    {children}
    {hint && <p className="mt-1 text-[12px] text-warmstone-500">{hint}</p>}
  </div>
);

/** A Lot on a BKT: a link when this site can open its receipt, plain text when it belongs to the other site. */
export function TransferLotLink({ line, siteSlug, canOpen }: { line: TransferRequest["lines"][number]; siteSlug: string; canOpen: boolean }) {
  const label = line.lotNumber ?? line.receiptId;
  return canOpen
    ? <Link to={`/${siteSlug}/receipts/${line.receiptId}`} className="font-mono text-[11.5px] text-brand-700 hover:text-brand-800">{label}</Link>
    : <span className="font-mono text-[11.5px] text-warmstone-700">{label}</span>;
}

/** One BKT in full: what is on the truck, what left, what arrived — and the form this warehouse is allowed to fill in. */
export function TransferPanel({
  t, siteWarehouse, canEdit, canSend, saving, lotLink, onDispatch, onReceive, qualityOf, binOptions,
}: {
  /** False at a Central warehouse: RCN never leaves it on a BKT, so a BKT left over from before that rule can't be sent. */
  canSend: boolean;
  /** This site's bins, offered for "unloaded into" when receiving. */
  binOptions: string[];
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
  const sending = canEdit && canSend && t.status === "requested" && t.fromWarehouse === siteWarehouse;
  const receiving = canEdit && t.status === "dispatched" && t.toWarehouse === siteWarehouse;
  const [d, setD] = useState({ truckNo: "", transporter: "", driver: "", driverPhone: "", gross: "", wr: "" });
  const [quality, setQuality] = useState<Record<string, { moisture: string; kor: string; nutCount: string }>>(() => Object.fromEntries(t.lines.map((l) => [l.receiptId, qualityOf(l.receiptId)])));
  // Every dispatch field is required (Nov 2026); the server refuses the same gaps.
  const dispatchReady = [d.wr, d.truckNo, d.transporter, d.driver, d.driverPhone, d.gross].every((x) => x.trim() !== "")
    && t.lines.every((l) => QUALITY.every(({ key }) => (quality[l.receiptId]?.[key] ?? "").trim() !== ""));
  const [r, setR] = useState({ damaged: "", gross: "", kor: "", moisture: "", nuts: "", lot: "", comment: "", wr: "" });
  const v = t.variance;
  // One bin and one bag count for the whole truck, as the client's receiving sheet records an arrival (one row per truck,
  // 20 Nov 2026). The count starts at the bags sent and is changed when it differs; the server shares the truck's weight
  // between its Lots by the bags each was sent with.
  const [bin, setBin] = useState("");
  const [bagsIn, setBagsIn] = useState(v.bagsDispatched === null ? "" : String(v.bagsDispatched));
  const bagsTotal = bagsIn.trim() !== "" && Number.isInteger(Number(bagsIn)) && Number(bagsIn) >= 0 ? Number(bagsIn) : null;
  const shares = lineNetAtArrival(t);
  // The same test the server applies: if what arrived differs from what was sent, the receiving warehouse has to say why.
  const arrival: TransferFacts = {
    status: "received", lines: t.lines.map((l) => ({ bags: l.bags, netWeightKg: l.netWeightKg })), dispatchedGrossKg: t.dispatchedGrossKg,
    bagsReceived: bagsTotal,
    receivedGrossKg: r.gross.trim() === "" || Number.isNaN(Number(r.gross)) ? null : Number(r.gross),
  };
  const differs = transferState(arrival) === "discrepancy";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <InfoCard icon="local_shipping" title={`${t.id} · what left`} badge={<Pill tone={TRANSFER_TONE[t.state]} label={TRANSFER_STATE_LABELS[t.state]} />}>
        <InfoRow label="From → To" value={`${t.fromWarehouse} → ${transferDestinationLabel(t)}`} />
        <InfoRow label="Truck" strong value={t.truckNo} />
        <InfoRow label="Warehouse receipt no." value={t.dispatchWhReceiptNo} />
        <InfoRow label="Transporter" value={t.transporter} />
        <InfoRow label="Driver" value={[t.driver, t.driverPhone].filter(Boolean).join(" · ") || undefined} />
        <InfoRow label="Loaded weight" value={t.dispatchedGrossKg === null ? undefined : `${t.dispatchedGrossKg.toLocaleString()} kg`} />
        <InfoRow label="Bags sent" value={n(v.bagsDispatched)} />
        <InfoRow label="Net sent" strong value={v.netDispatchedKg === null ? undefined : `${v.netDispatchedKg.toLocaleString()} kg`} />
        <InfoRow label="Dispatched" value={t.dispatchedAt ? `${formatDate(t.dispatchedAt)}${t.dispatchedBy ? ` · ${t.dispatchedBy}` : ""}` : undefined} />
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
        <InfoRow label="Received" value={t.receivedAt ? `${formatDate(t.receivedAt)}${t.receivedBy ? ` · ${t.receivedBy}` : ""}` : undefined} />
        {t.receivedComment && <p className="pt-1 text-[12.5px] text-warmstone-600">{t.receivedComment}</p>}
      </InfoCard>

      <InfoCard icon="inventory" title={`Lots on the truck (${t.lines.length})`}>
        {t.lines.map((l, i) => (
          <div key={l.receiptId} className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0">{lotLink(l)} <span className="text-warmstone-500">{normalizeSupplierName(l.supplierName)}</span></span>
            <span className="text-right tabular-nums text-warmstone-700 shrink-0">
              {n(l.bags)} bags{l.netWeightKg !== null ? ` · ${formatKg(l.netWeightKg)}` : ""}
              {(l.bagsReceived !== null || shares[i]) && (
                <span className="block text-[11px] text-warmstone-500">
                  {[l.bagsReceived !== null ? `${n(l.bagsReceived)} bags received` : null, shares[i] ? `${formatKg(shares[i]!.kg)} received${shares[i]!.shared ? " (share of the truck, by bags)" : ""}` : null].filter(Boolean).join(" · ")}
                </span>
              )}
              {(l.binCode || l.receivedBinCode) && <span className="block text-[11px] text-warmstone-400">{[l.binCode, l.receivedBinCode].filter(Boolean).join(" → ")}</span>}
              {(l.moisture !== null || l.kor !== null) && <span className="block text-[11px] text-warmstone-500">moisture {l.moisture ?? "-"}% · KOR {l.kor ?? "-"}{l.nutCount !== null ? ` · ${l.nutCount} nuts` : ""}</span>}</span>
          </div>
        ))}
      </InfoCard>

      {sending && (
        <form
          onSubmit={(e) => { e.preventDefault(); void onDispatch({ whReceiptNo: d.wr, lines: t.lines.map((l) => ({ receiptId: l.receiptId, ...quality[l.receiptId] })), truckNo: d.truckNo, transporter: d.transporter, driver: d.driver, driverPhone: d.driverPhone, dispatchedGrossKg: d.gross || null }); }}
          className="lg:col-span-3 bg-white border-2 border-brand-700 rounded-2xl p-5 grid sm:grid-cols-2 lg:grid-cols-5 gap-4 items-start"
        >
          <Field id="dp-wr" label="Warehouse receipt no. *" hint="The receipt this dispatch is recorded against."><input id="dp-wr" required value={d.wr} onChange={(e) => setD({ ...d, wr: e.target.value })} className={inputClass} /></Field>
          <Field id="dp-truck" label="Truck number *" hint="One BKT is one truck."><input id="dp-truck" required value={d.truckNo} onChange={(e) => setD({ ...d, truckNo: e.target.value })} className={inputClass} placeholder="1796GC01/3922BB04" /></Field>
          <Field id="dp-transporter" label="Transporter *"><input id="dp-transporter" required value={d.transporter} onChange={(e) => setD({ ...d, transporter: e.target.value })} className={inputClass} /></Field>
          <Field id="dp-driver" label="Driver *"><input id="dp-driver" required value={d.driver} onChange={(e) => setD({ ...d, driver: e.target.value })} className={inputClass} /></Field>
          <Field id="dp-phone" label="Driver phone *"><input id="dp-phone" required inputMode="tel" value={d.driverPhone} onChange={(e) => setD({ ...d, driverPhone: e.target.value })} className={inputClass} /></Field>
          <Field id="dp-gross" label="Loaded weight (kg) *" hint="From your scale: RCN plus bags."><input id="dp-gross" required inputMode="decimal" value={d.gross} onChange={(e) => setD({ ...d, gross: e.target.value })} className={`${inputClass} tabular-nums`} /></Field>
          <div className="sm:col-span-2 lg:col-span-5 space-y-2">
            <div>
              <p className="text-[13px] font-bold text-warmstone-900">Quality of each Lot on the truck</p>
              <p className="text-[12px] text-warmstone-500">Filled in from each Lot's own quality check. Change a value only if it was measured again.</p>
            </div>
            <div className="grid grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] gap-3 text-[12px] font-semibold text-warmstone-700">
              <span>Lot</span><span>Moisture (%) *</span><span>KOR *</span><span>Nut count *</span>
            </div>
            {t.lines.map((l) => (
              <div key={l.receiptId} className="grid grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] gap-3 items-center">
                <span className="text-[13px] font-mono text-warmstone-800 truncate">{l.lotNumber ?? l.receiptId}</span>
                {QUALITY.map(({ key, label }) => (
                  <input
                    key={key} required inputMode="decimal" aria-label={`${label}, ${l.lotNumber ?? l.receiptId}`}
                    value={quality[l.receiptId]?.[key] ?? ""}
                    onChange={(e) => setQuality({ ...quality, [l.receiptId]: { ...quality[l.receiptId]!, [key]: e.target.value } })} className={`${inputClass} tabular-nums`}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="sm:col-span-2 lg:col-span-5 flex items-center gap-3">
            <button type="submit" disabled={saving || !dispatchReady} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold shadow-sm disabled:opacity-50">
              <span className="material-symbols-outlined text-[18px]">local_shipping</span>
              Dispatch truck
            </button>
            <span className="text-[12px] text-warmstone-500">Nothing about arrival is filled in here - the receiving warehouse records that.</span>
          </div>
        </form>
      )}

      {receiving && (
        <form
          onSubmit={(e) => { e.preventDefault(); void onReceive({ whReceiptNo: r.wr, receivedGrossKg: r.gross, damagedBags: r.damaged || null, korReceived: r.kor || null, moistureReceived: r.moisture || null, nutCountReceived: r.nuts || null, receivedLotNoRaw: r.lot || null, receivedComment: r.comment || null, bagsReceived: bagsIn, lines: t.lines.map((l) => ({ receiptId: l.receiptId, binCode: bin })) }); }}
          className="lg:col-span-3 bg-white border-2 border-brand-700 rounded-2xl p-5 grid sm:grid-cols-2 lg:grid-cols-4 gap-4 items-start"
        >
          <Field id="rc-wr" label="Warehouse receipt no." hint="Your own receipt for this arrival."><input id="rc-wr" required value={r.wr} onChange={(e) => setR({ ...r, wr: e.target.value })} className={inputClass} /></Field>
          <Field id="rc-gross" label="Gross weight received (kg)" hint="From your scale: RCN plus bags."><input id="rc-gross" required inputMode="decimal" value={r.gross} onChange={(e) => setR({ ...r, gross: e.target.value })} className={inputClass} /></Field>
          <Field id="rc-damaged" label="Damaged bags"><input id="rc-damaged" inputMode="numeric" value={r.damaged} onChange={(e) => setR({ ...r, damaged: e.target.value })} className={inputClass} /></Field>
          <Field id="rc-lot" label="Your Lot number" hint="As you write it; kept exactly."><input id="rc-lot" value={r.lot} onChange={(e) => setR({ ...r, lot: e.target.value })} className={inputClass} /></Field>
          <Field id="rc-kor" label="KOR"><input id="rc-kor" inputMode="decimal" value={r.kor} onChange={(e) => setR({ ...r, kor: e.target.value })} className={inputClass} /></Field>
          <Field id="rc-moisture" label="Moisture (%)"><input id="rc-moisture" inputMode="decimal" value={r.moisture} onChange={(e) => setR({ ...r, moisture: e.target.value })} className={inputClass} /></Field>
          <Field id="rc-nuts" label="Nut count"><input id="rc-nuts" inputMode="numeric" value={r.nuts} onChange={(e) => setR({ ...r, nuts: e.target.value })} className={inputClass} /></Field>
          <Field id="rc-comment" label={differs ? "Why it differs *" : "Comment"} hint={differs ? "What arrived is not what was sent: say why (damaged bags, a short load, a weighing difference…)." : undefined}><input id="rc-comment" required={differs} value={r.comment} onChange={(e) => setR({ ...r, comment: e.target.value })} className={`${inputClass} ${differs ? "border-ambernut-300 bg-ambernut-50" : ""}`} /></Field>
          <Field id="rc-bags" label="Bags received *" hint={`Filled in with the ${n(v.bagsDispatched)} bags sent. Change it if you counted a different number.`}>
            <input id="rc-bags" required inputMode="numeric" value={bagsIn} onChange={(e) => setBagsIn(e.target.value)} className={`${inputClass} tabular-nums`} />
          </Field>
          <Field id="rc-bin" label="Bin *" hint="The bin the truck was unloaded into. It makes the Lots available to production.">
            <select id="rc-bin" required value={bin} onChange={(e) => setBin(e.target.value)} className={inputClass}>
              <option value="">Choose a bin…</option>
              {binOptions.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-2 lg:col-span-2 space-y-1">
            <p className="text-[12px] font-semibold text-warmstone-700">Lots on this truck</p>
            {t.lines.map((l) => (
              <p key={l.receiptId} className="flex justify-between gap-3 text-[13px]">
                <span className="font-mono text-warmstone-800 truncate">{l.lotNumber ?? l.receiptId}</span>
                <span className="tabular-nums text-warmstone-800">{n(l.bags)} bags</span>
              </p>
            ))}
          </div>
          <div className="sm:col-span-2 lg:col-span-4 flex items-center gap-3">
            <button type="submit" disabled={saving || bagsTotal === null || !r.gross.trim() || !r.wr.trim() || !bin || (differs && !r.comment.trim())} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold shadow-sm disabled:opacity-50">
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
