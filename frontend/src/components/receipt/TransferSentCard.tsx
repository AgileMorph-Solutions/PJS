import { Link } from "react-router-dom";
import { sentVsReceived } from "@anagroci/contract/domain/transferReception";
import { formatDate } from "@anagroci/contract/domain/dateFormat";
import type { ReceiptRecord, TransferOrigin } from "@anagroci/contract/types/receipt";
import { InfoCard, InfoRow } from "../ui/InfoCard";
import { Pill } from "../ui/Pill";

const fmt = (x: number | null) => (x === null ? "-" : x.toLocaleString("en-US", { maximumFractionDigits: 2 }));

/**
 * On a reception from the Unit warehouse (24 Nov 2026), in place of the supplier: the BKT it came on, who brought it, and
 * what was sent of this lot against what this record has — worked out as the steps are filled (contract sentVsReceived).
 */
export function TransferSentCard({ receipt, transfer, bktHref }: { receipt: Pick<ReceiptRecord, "stageData">; transfer: TransferOrigin; bktHref?: string }) {
  const rows = sentVsReceived({ ...receipt, transfer });
  const off = rows.some((r) => r.off);
  const anyReceived = rows.some((r) => r.received !== null);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <InfoCard icon="local_shipping" title={`Sent from ${transfer.fromWarehouse}`}>
        <InfoRow label="BKT" strong value={bktHref ? <Link to={bktHref} className="text-brand-700 hover:text-brand-800">{transfer.transferId}</Link> : transfer.transferId} />
        <InfoRow label="Sent as" value={transfer.sentAs} />
        <InfoRow label="Truck" value={transfer.truckNo} />
        <InfoRow label="Transporter" value={transfer.transporter} />
        <InfoRow label="Driver" value={[transfer.driver, transfer.driverPhone].filter(Boolean).join(" · ") || undefined} />
        <InfoRow label="Dispatched" value={transfer.dispatchedAt ? formatDate(transfer.dispatchedAt) : undefined} />
      </InfoCard>
      <InfoCard
        icon="compare_arrows"
        title="Sent vs received"
        badge={anyReceived ? <Pill tone={off ? "gap" : "entry"} label={off ? "Difference" : "Matches"} /> : <Pill tone="system" label="Not received yet" />}
      >
        <div className="grid grid-cols-4 gap-2 text-[12px] font-semibold text-warmstone-500">
          <span />
          <span className="text-right">Sent</span>
          <span className="text-right">Received</span>
          <span className="text-right">Difference</span>
        </div>
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-4 gap-2 text-[13px] tabular-nums">
            <span className="text-warmstone-700">{r.label} <span className="text-[11px] text-warmstone-500">{r.unit}</span></span>
            <span className="text-right text-warmstone-800">{fmt(r.sent)}</span>
            <span className="text-right text-warmstone-800">{fmt(r.received)}</span>
            <span className={`text-right ${r.off ? "font-semibold text-danger-700" : "text-warmstone-500"}`}>{r.diff === null ? "-" : `${r.diff > 0 ? "+" : ""}${fmt(r.diff)}`}</span>
          </div>
        ))}
      </InfoCard>
    </div>
  );
}
