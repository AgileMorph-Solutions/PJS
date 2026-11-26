import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { dispatchWeightProblem, driverPhoneProblem, expectedLoadedKg, lineNetAtArrival, normalizeName, normalizePhone, normalizeTruckNo, transferFieldProblem, transferDestinationLabel, transferStateLabel, type TransferState } from "@anagroci/contract/domain/transfers";
import { readNumber, transferNumberProblem } from "@anagroci/contract/domain/transferLot";
import { formatKg } from "../production/batchUi";
import { Pill } from "../ui/Pill";
import { buttonClass } from "../ui/Button";
import { inputClass } from "../ui/Input";
import { InfoCard, InfoRow } from "../ui/InfoCard";
import { normalizeSupplierName } from "@anagroci/contract/domain/supplierCode";
import type { api } from "../../repository/api";
import type { TransferRequest } from "../../types/receipt";
import { formatDate } from "@anagroci/contract/domain/dateFormat";

/** The quality each line leaves with: all three are required to dispatch. */
const QUALITY = [
  { key: "moisture", label: "Moisture (%)", kind: "moisture" },
  { key: "kor", label: "KOR", kind: "kor" },
  { key: "nutCount", label: "Nut count", kind: "nutCount" },
] as const;

export const TRANSFER_TONE: Record<TransferState, string> = { requested: "decision", in_transit: "term", receiving: "decision", closed: "entry", discrepancy: "gap" };

export const n = (x: number | null, signed = false) => (x === null ? "-" : `${signed && x > 0 ? "+" : ""}${x.toLocaleString()}`);

/** A labelled box; an error (a value written the wrong way) shows in place of the hint until it is put right. */
export const Field = ({ id, label, children, hint, error, warning }: { id: string; label: string; children: ReactNode; hint?: string; error?: string | null; warning?: string | null }) => (
  <div>
    <label htmlFor={id} className="block text-[12px] font-semibold text-warmstone-700 mb-1.5">{label}</label>
    {children}
    {error
      ? <p id={`${id}-error`} role="alert" className="mt-1 text-[12px] text-danger-700">{error}</p>
      : warning
        ? <p id={`${id}-warning`} role="status" className="mt-1 text-[12px] text-ambernut-700">{warning}</p>
        : hint && <p className="mt-1 text-[12px] text-warmstone-500">{hint}</p>}
  </div>
);

/** A refusal from the server, shown beside the button that caused it — with a link when it is about another record. */
export interface ActionError { message: string; link?: { to: string; label: string }; /** The box it is about, when one is. */ field?: "truckNo" }

/** The input's border turns red while its value is written the wrong way. */
const withError = (problem: string | null | undefined) => (problem ? `${inputClass} border-danger-600 focus:border-danger-600 focus:ring-danger-600` : inputClass);

type Line = TransferRequest["lines"][number];

/** How a line reads: the transfer lot on it; on an older BKT, "Bin BKE-002-BIN-012" or the Lot number. */
export const lineLabel = (l: Line) => l.transferLotNo ?? (l.receiptId ? (l.lotNumber ?? l.receiptId) : `Bin ${l.binCode ?? "-"}`);

/**
 * What is on a BKT line: a transfer lot (since 24 Nov 2026), or on an older BKT a Bin or a Lot — a link when this site can open
 * its receipt, plain text otherwise.
 */
export function TransferLotLink({ line, siteSlug, canOpen }: { line: Line; siteSlug: string; canOpen: boolean }) {
  const label = lineLabel(line);
  return canOpen && line.receiptId
    ? <Link to={`/${siteSlug}/receipts/${line.receiptId}`} className="text-[12px] font-medium text-brand-700 hover:text-brand-800">{label}</Link>
    : <span className="text-[12px] text-warmstone-800">{label}</span>;
}

/**
 * One BKT in full: what left and what is on the truck — and, at the sending warehouse, the dispatch form. ("What arrived" was
 * taken off on 25 Nov 2026: not needed.) What arrives is recorded on the receiving warehouse's Reception page (From Unit warehouse), where each lot on the truck becomes a
 * lot of its own there; `receiveHref` points there.
 */
export function TransferPanel({
  t, siteWarehouse, canEdit, canSend, saving, lotLink, onDispatch, qualityOf, receiveHref, receptionHref, error, onEdit,
}: {
  /** False at a Central warehouse: RCN never leaves it on a BKT, so a BKT left over from before that rule can't be sent. */
  canSend: boolean;
  /** Where each line's dispatch quality starts: a transfer lot's weighing, or a Lot's own quality check; blank for a Bin. */
  qualityOf: (line: Line) => { moisture: string; kor: string; nutCount: string };
  t: TransferRequest;
  siteWarehouse: string;
  canEdit: boolean;
  saving: boolean;
  lotLink: (l: Line) => ReactNode;
  onDispatch: (p: Parameters<typeof api.dispatchTransfer>[1]) => Promise<boolean>;
  /** The Reception page that records this truck's arrival, for the receiving warehouse while it is on the road. */
  receiveHref?: string;
  /** A lot's reception record, for the warehouse that received it. */
  receptionHref?: (receiptId: string) => string;
  /** Why the last dispatch was refused: shown under its box, or beside the button. */
  error?: ActionError | null;
  /** Told when the person changes the form: the refusal was about what they had typed, so it is cleared. */
  onEdit?: () => void;
}) {
  const sending = canEdit && canSend && t.status === "requested" && t.fromWarehouse === siteWarehouse;
  const receiving = canEdit && t.status === "dispatched" && t.toWarehouse === siteWarehouse && receiveHref;
  const started = t.lines.some((l) => l.receptionId);
  // The loaded weight starts as what the lots on the truck come to (net + 1 kg a bag); the scale's reading replaces it.
  const expectedGross = expectedLoadedKg(t.lines.map((l) => ({ bags: l.bags, netWeightKg: l.netWeightKg })));
  const [d, setDraft] = useState({ truckNo: "", transporter: "", driver: "", driverPhone: "", gross: expectedGross === null ? "" : String(expectedGross), wr: "" });
  const setD = (next: typeof d) => { setDraft(next); onEdit?.(); };
  const [quality, setQuality] = useState<Record<number, { moisture: string; kor: string; nutCount: string }>>(() => Object.fromEntries(t.lines.map((l) => [l.id, qualityOf(l)])));
  // How each value is written (numbers where a number belongs, a name for the transporter); the server refuses the same.
  // The loaded weight: red when it can't be right; a warning (more than one truck) only changes its hint.
  const grossProblem = transferNumberProblem("truckWeightKg", d.gross);
  const phone = driverPhoneProblem(d.driverPhone);
  const bad = {
    phone: phone && !phone.soft ? phone.message : null,
    wr: transferFieldProblem("receiptNo", d.wr),
    transporter: transferFieldProblem("name", d.transporter),
    gross: grossProblem && !grossProblem.soft ? grossProblem.message : null,
  };
  const badQuality = (id: number, q: (typeof QUALITY)[number]) => {
    const p = transferNumberProblem(q.kind, quality[id]?.[q.key]);
    return p && !p.soft ? p.message : null;
  };
  // Every dispatch field is required (Nov 2026) and written the right way; the server refuses the same gaps.
  const dispatchReady = [d.wr, d.truckNo, d.transporter, d.driver, d.driverPhone, d.gross].every((x) => x.trim() !== "")
    && !bad.wr && !bad.transporter && !bad.gross && !bad.phone
    && t.lines.every((l) => QUALITY.every((q) => (quality[l.id]?.[q.key] ?? "").trim() !== "" && !badQuality(l.id, q)));
  const v = t.variance;
  const shares = lineNetAtArrival(t);
  // Far from what the lots on the truck add up to: a warning under the box, never a refusal (the scale is what was sent).
  const grossKg = bad.gross ? null : readNumber(d.gross);
  const weightWarning = grossProblem?.soft ? grossProblem.message
    : grossKg === null ? null : dispatchWeightProblem(grossKg, t.lines.map((l) => ({ bags: l.bags, netWeightKg: l.netWeightKg })));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <InfoCard icon="local_shipping" title={`${t.id} · what left`} badge={<Pill tone={TRANSFER_TONE[t.state]} label={transferStateLabel(t, siteWarehouse)} />}>
        <InfoRow label="From → To" value={`${t.fromWarehouse} → ${transferDestinationLabel(t)}`} />
        <InfoRow label="Truck" strong value={t.truckNo} />
        <InfoRow label="Warehouse receipt no." value={t.dispatchWhReceiptNo} />
        <InfoRow label="Transporter" value={t.transporter} />
        <InfoRow label="Driver" value={[t.driver, t.driverPhone].filter(Boolean).join(" · ") || undefined} />
        <InfoRow label="Loaded weight" value={t.dispatchedGrossKg === null ? undefined : formatKg(t.dispatchedGrossKg)} />
        <InfoRow label="Bags sent" value={n(v.bagsDispatched)} />
        <InfoRow label="Net sent" strong value={v.netDispatchedKg === null ? undefined : formatKg(v.netDispatchedKg)} />
        <InfoRow label="Dispatched" value={t.dispatchedAt ? `${formatDate(t.dispatchedAt)}${t.dispatchedBy ? ` · ${t.dispatchedBy}` : ""}` : undefined} />
      </InfoCard>


      <InfoCard icon="inventory" title={`On the truck (${t.lines.length})`}>
        {t.lines.map((l, i) => (
          <div key={l.id} className="text-[13px] space-y-0.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0">{lotLink(l)} <span className="text-warmstone-500">{normalizeSupplierName(l.supplierName)}</span></span>
              <span className="text-right tabular-nums text-warmstone-800 shrink-0">{n(l.bags)} bags{l.netWeightKg !== null ? ` · ${formatKg(l.netWeightKg)}` : ""}</span>
            </div>
            {(l.moisture !== null || l.kor !== null) && <p className="text-[11px] text-warmstone-500 text-right">sent: moisture {l.moisture ?? "-"}% · KOR {l.kor ?? "-"}{l.nutCount !== null ? ` · ${l.nutCount} nuts` : ""}</p>}
            {(l.bagsReceived !== null || shares[i]) && (
              <p className="text-[11px] text-warmstone-500 text-right">
                {[
                  l.bagsReceived !== null ? `${n(l.bagsReceived)} bags` : null,
                  shares[i] ? `${formatKg(shares[i]!.kg)}${shares[i]!.shared ? " (share of the truck, by bags)" : ""}` : null,
                ].filter(Boolean).join(" · ")}
              </p>
            )}
            {/* Received on the Reception page: its record there, and the Lot it became. */}
            {l.receptionId && (
              <p className="text-[11px] text-warmstone-500 text-right">
                received as {receptionHref ? <Link to={receptionHref(l.receptionId)} className="font-semibold text-brand-700 hover:text-brand-800">{l.receivedLotNo ?? l.receptionId}</Link> : (l.receivedLotNo ?? l.receptionId)}
              </p>
            )}
            {/* Where it came from (a lot's Bins, or an older line's own Bin) → the Bin it was put in at the other end. */}
            {(l.binCode || l.transferLotBins.length > 0 || l.receivedBinCode) && (
              <p className="text-[11px] text-warmstone-500 text-right">
                {[l.transferLotId ? (l.transferLotBins.length ? `from ${l.transferLotBins.join(", ")}` : null) : l.binCode, l.receivedBinCode].filter(Boolean).join(" → ")}
              </p>
            )}
          </div>
        ))}
      </InfoCard>

      {receiving && (
        <div className="lg:col-span-2 bg-white border-2 border-brand-700 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-warmstone-800">
            {started
              ? "This truck is being received on the Reception page: each lot on it has its own reception record there."
              : "This truck is on its way here. Receive it on the Reception page, like any truck: each lot on it gets its own reception record."}
          </p>
          <Link to={receiveHref} className={buttonClass("primary")}>
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">inventory_2</span>
            {started ? "Go to Reception" : "Receive this truck"}
          </Link>
        </div>
      )}

      {sending && (
        <form
          onSubmit={(e) => { e.preventDefault(); void onDispatch({ whReceiptNo: d.wr, lines: t.lines.map((l) => ({ lineId: l.id, ...quality[l.id] })), truckNo: d.truckNo, transporter: d.transporter, driver: d.driver, driverPhone: d.driverPhone, dispatchedGrossKg: d.gross || null }); }}
          className="lg:col-span-2 bg-white border-2 border-brand-700 rounded-2xl p-5 grid sm:grid-cols-2 lg:grid-cols-5 gap-4 items-start"
        >
          <Field id="dp-wr" label="Warehouse receipt no. *" hint="The receipt this dispatch is recorded against." error={bad.wr}><input id="dp-wr" required inputMode="numeric" aria-invalid={Boolean(bad.wr)} value={d.wr} onChange={(e) => setD({ ...d, wr: e.target.value })} className={withError(bad.wr)} /></Field>
          <Field id="dp-truck" label="Truck number *" hint="One BKT is one truck. Saved in capitals, no spaces: 1796GC01/3922BB04." error={error?.field === "truckNo" ? error.message : null}><input id="dp-truck" required value={d.truckNo} onChange={(e) => setD({ ...d, truckNo: e.target.value })} onBlur={() => setDraft((x) => ({ ...x, truckNo: normalizeTruckNo(x.truckNo) }))} className={inputClass} placeholder="1796GC01/3922BB04" /></Field>
          <Field id="dp-transporter" label="Transporter *" error={bad.transporter}><input id="dp-transporter" required aria-invalid={Boolean(bad.transporter)} value={d.transporter} onChange={(e) => setD({ ...d, transporter: e.target.value })} onBlur={() => setDraft((x) => ({ ...x, transporter: normalizeName(x.transporter) }))} className={withError(bad.transporter)} /></Field>
          <Field id="dp-driver" label="Driver *" hint="A driver drives one truck at a time."><input id="dp-driver" required value={d.driver} onChange={(e) => setD({ ...d, driver: e.target.value })} onBlur={() => setDraft((x) => ({ ...x, driver: normalizeName(x.driver) }))} className={inputClass} /></Field>
          <Field id="dp-phone" label="Driver phone *" hint="10 digits, e.g. 0715347075." error={bad.phone} warning={phone?.soft ? phone.message : null}><input id="dp-phone" required inputMode="tel" aria-invalid={Boolean(bad.phone)} value={d.driverPhone} onChange={(e) => setD({ ...d, driverPhone: e.target.value })} onBlur={() => setDraft((x) => (driverPhoneProblem(x.driverPhone)?.soft === false ? x : { ...x, driverPhone: normalizePhone(x.driverPhone) }))} className={withError(bad.phone)} /></Field>
          <Field id="dp-gross" label="Loaded weight (kg) *" hint={expectedGross === null ? "From your scale: RCN plus bags." : `Filled with what the lots come to (${expectedGross.toLocaleString("en-US")} kg, bags included). Change it to your scale's reading.`} error={bad.gross} warning={weightWarning}><input id="dp-gross" required inputMode="decimal" aria-invalid={Boolean(bad.gross)} value={d.gross} onChange={(e) => setD({ ...d, gross: e.target.value })} className={`${withError(bad.gross)} tabular-nums`} /></Field>
          <div className="sm:col-span-2 lg:col-span-5 space-y-2">
            <div>
              <h3 className="text-[13px] font-bold text-warmstone-900">Quality of what is on the truck</h3>
              <p className="text-[12px] text-warmstone-500">Each lot starts from the quality it was weighed with. Measure again if it changed; a Bin on an older BKT is measured as it is loaded.</p>
            </div>
            <div className="grid grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] gap-3 text-[12px] font-semibold text-warmstone-700">
              <span>On the truck</span><span>Moisture (%) *</span><span>KOR *</span><span>Nut count *</span>
            </div>
            {t.lines.map((l) => (
              <div key={l.id} className="grid grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] gap-3 items-start">
                <span className="py-2 text-[13px] font-mono text-warmstone-800 truncate">{lineLabel(l)}</span>
                {QUALITY.map((q) => {
                  const { key, label } = q;
                  const problem = badQuality(l.id, q);
                  return (
                    <div key={key}>
                      <input
                        required inputMode={key === "nutCount" ? "numeric" : "decimal"} aria-label={`${label}, ${lineLabel(l)}`} aria-invalid={Boolean(problem)}
                        value={quality[l.id]?.[key] ?? ""}
                        onChange={(e) => { setQuality({ ...quality, [l.id]: { ...quality[l.id]!, [key]: e.target.value } }); onEdit?.(); }} className={`${withError(problem)} tabular-nums`}
                      />
                      {problem && <p role="alert" className="mt-1 text-[12px] text-danger-700">{problem}</p>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="sm:col-span-2 lg:col-span-5 flex items-center gap-3">
            <button type="submit" disabled={saving || !dispatchReady} className={buttonClass("primary")}>
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">local_shipping</span>
              Dispatch truck
            </button>
            {error && error.field !== "truckNo" ? (
              <p role="alert" className="text-[12px] text-danger-700">
                {error.message}
                {error.link && <> <Link to={error.link.to} className="font-semibold text-brand-700 hover:text-brand-800 underline">{error.link.label}</Link></>}
              </p>
            ) : error?.link ? (
              <Link to={error.link.to} className="text-[12px] font-semibold text-brand-700 hover:text-brand-800 underline">{error.link.label}</Link>
            ) : (
              <span className="text-[12px] text-warmstone-500">Nothing about arrival is filled in here - the receiving warehouse records that.</span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
