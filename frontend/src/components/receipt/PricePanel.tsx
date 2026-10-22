import { useState } from "react";
import { api } from "../../repository/api";
import type { ReceiptRecord } from "../../types/receipt";

/**
 * The Branch Manager's price for this truck (Oct 2026: price and amount are hidden from the Warehouse Incharge and set by the
 * Branch Manager directly, with no approval step). The amount follows by itself: price × paid weight. Once the GRN is complete
 * the record locks, and the price with it.
 */
export function PricePanel({ receipt, onSaved }: { receipt: ReceiptRecord; onSaved: () => void }) {
  const stored = receipt.stageData["n-grn"]?.PRICE ?? "";
  const amount = receipt.stageData["n-grn"]?.AMOUNT ?? "";
  const [price, setPrice] = useState(stored);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = Boolean(receipt.lockedAt);

  return (
    <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50/40 p-4">
      <h4 className="text-[13.5px] font-bold text-warmstone-900 mb-1">Price you negotiated</h4>
      <p className="text-[12px] text-warmstone-500 mb-3">Saved straight onto the truck, without approval. The Warehouse Incharge does not see prices or amounts.</p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true); setError(null);
          api.setPrice(receipt.id, price).then(onSaved).catch((err) => setError(err instanceof Error ? err.message : String(err))).finally(() => setBusy(false));
        }}
      >
        <label className="block">
          <span className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">Price (XOF per kg)</span>
          <input
            inputMode="decimal" value={price} disabled={locked} onChange={(e) => setPrice(e.target.value)}
            className="w-40 px-3 py-2 rounded-xl border border-warmstone-200 bg-white text-[13px] text-warmstone-900 outline-none focus:border-brand-700 focus:ring-1 focus:ring-brand-700 disabled:bg-warmstone-100"
          />
        </label>
        {!locked && (
          <button type="submit" disabled={busy || price.trim() === stored.trim()} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold shadow-sm disabled:opacity-50">
            {busy ? "Saving…" : "Save price"}
          </button>
        )}
        {amount && <span className="text-[13px] text-warmstone-700">Amount: <b className="tabular-nums">{Number(amount).toLocaleString()} XOF</b> <span className="text-warmstone-500">(price × paid weight)</span></span>}
      </form>
      {locked && <p className="mt-2 text-[12px] text-warmstone-500">The record is locked: its GRN is complete.</p>}
      {error && <p role="alert" className="mt-2 text-[13px] text-danger-700">{error}</p>}
    </div>
  );
}
