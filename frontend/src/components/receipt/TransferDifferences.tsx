import type { SentVsReceivedRow } from "@anagroci/contract/domain/transferReception";

const fmt = (x: number | null) => (x === null ? "-" : x.toLocaleString("en-US", { maximumFractionDigits: 2 }));

/**
 * The client's difference columns ("Diffrence in Bag at Receiving", "Weight Difference at Yakro", KOR and moisture
 * dispatched vs received), filled in where their reading is entered on a truck from the Unit warehouse: worked out from the
 * BKT and this record, never typed. Red when past what is allowed.
 */
export function TransferDifferences({ rows, from }: { rows: SentVsReceivedRow[]; from: string }) {
  if (!rows.length) return null;
  return (
    <div className="mt-4 rounded-xl border border-warmstone-200 bg-warmstone-50 px-4 py-3 space-y-1.5">
      <p className="text-[11px] font-bold uppercase tracking-wider text-warmstone-500">Compared with what {from} sent</p>
      {rows.map((r) => (
        <p key={r.label} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-[13px] tabular-nums">
          <span className="w-28 font-semibold text-warmstone-700">{r.label}</span>
          <span className="text-warmstone-800">Dispatched {fmt(r.sent)} {r.unit}</span>
          <span className="text-warmstone-800">Received {fmt(r.received)} {r.received === null ? "" : r.unit}</span>
          <span className={r.off ? "font-semibold text-danger-700" : "text-warmstone-500"}>
            Difference {r.diff === null ? "-" : `${r.diff > 0 ? "+" : ""}${fmt(r.diff)} ${r.unit}`}
          </span>
        </p>
      ))}
    </div>
  );
}
