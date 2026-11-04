import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { DateInput } from "../../components/ui/DateInput";
import { formatTonnes, inputCls, primaryButton, secondaryButton } from "../../components/production/batchUi";
import { useBatchBins } from "../../state/productionBatches";
import { useProductionFactory } from "../../state/productionFactory";
import { api, ApiError } from "../../repository/api";
import { DAILY_CAPACITY_KG, MONTHLY_GUIDE_KG, planBatch, suggestBatchCode } from "@anagroci/contract/domain/productionBatch";
import { formatDate, todayIso } from "@anagroci/contract/domain/dateFormat";
import type { AvailableBin } from "@anagroci/contract/types/productionBatch";

const field = (label: string, el: ReactNode, hint?: string) => (
  <label className="block">
    <span className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">{label}</span>
    {el}
    {hint && <span className="block mt-1 text-[11.5px] text-warmstone-500">{hint}</span>}
  </label>
);

/** Why a bin can't be ticked, or undefined when it can. */
function unavailableReason(b: AvailableBin): string | undefined {
  if (b.inBatch) return `Already in batch ${b.inBatch}`;
  if (!b.inMaster) return "Not in Masters › Bins";
  if (b.lotCount === 0) return "No stock";
  return undefined;
}

/**
 * Production → Batches → New batch (Phase 0). The bins on offer are the factory's procurement bins
 * holding completed Lots; their stock is worked out from those Lots, so what is planned here is what
 * procurement recorded. The monthly range is a guide only: outside it the screen warns, never blocks.
 */
export function NewBatchPage() {
  const navigate = useNavigate();
  const { rows: bins, loading, error: loadError } = useBatchBins();
  // An admin picks the factory on Batches; with more than one, say which this batch is for.
  const { factory, factories } = useProductionFactory();
  const [selected, setSelected] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [codeEdited, setCodeEdited] = useState(false);
  const [startDate, setStartDate] = useState(todayIso());
  const [proposedBy, setProposedBy] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = useMemo(() => bins.filter((b) => selected.includes(b.binCode)), [bins, selected]);
  const plan = planBatch(chosen.map((b) => b.kg), startDate);
  const suggestion = suggestBatchCode(chosen.map((b) => ({ binCode: b.binCode, kg: b.kg })));
  const shownCode = codeEdited ? code : suggestion;
  const lotsWithoutKg = chosen.reduce((n, b) => n + b.lotsWithoutKg, 0);

  const toggle = (binCode: string) =>
    setSelected((s) => (s.includes(binCode) ? s.filter((c) => c !== binCode) : [...s, binCode]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const batch = await api.createBatch({ code: shownCode, startDate, proposedBy, bins: selected });
      navigate(`/production/batches/${encodeURIComponent(batch.code)}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <PageHeader
        kicker={factories.length > 1 ? `Production · Batches · ${factory}` : "Production · Batches"}
        title="New production batch"
        lede="Pick the warehouse bins that will be processed together (about one month of work). The total is a guide, not a hard limit."
      />

      <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
        <div className="space-y-5">
          <section className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs">
            <h3 className="text-[15px] font-bold text-warmstone-900 mb-4">Batch details</h3>
            <div className="grid sm:grid-cols-3 gap-4">
              {field(
                "Batch name",
                <input className={`${inputCls} font-mono`} value={shownCode} placeholder="ANA-03B" onChange={(e) => { setCodeEdited(true); setCode(e.target.value.toUpperCase()); }} />,
                !codeEdited && suggestion ? `Suggested from the largest bin.` : undefined
              )}
              {field("Start date", <DateInput value={startDate} onChange={setStartDate} className={inputCls} />)}
              {field("Proposed by (warehouse)", <input className={inputCls} value={proposedBy} onChange={(e) => setProposedBy(e.target.value)} placeholder="Who suggested these bins" />)}
            </div>
          </section>

          <section className="bg-white border border-warmstone-200 rounded-2xl shadow-xs overflow-hidden">
            <div className="px-5 pt-5 pb-3">
              <h3 className="text-[15px] font-bold text-warmstone-900">Select warehouse bins</h3>
              <p className="text-[12px] text-warmstone-500 mt-0.5">
                Bins at the factory holding Lots whose procurement is complete: quality passed, GRN quantity and price recorded, drying
                answered (no drying, or dried and returned) and transfer answered "No — stays". A Lot with any of these open is not counted.
                Stock is the Lots' GRN weight. Lots received here on a transfer (BKT) count in the bin they were unloaded into, at the net
                weighed on arrival.
              </p>
            </div>
            {loadError && <p className="px-5 pb-4 text-[13px] text-danger-700">{loadError}</p>}
            {!loading && bins.length === 0 && (
              <p className="px-5 pb-5 text-[13px] text-warmstone-500">No bin at the factory holds completed procurement stock yet.</p>
            )}
            {bins.length > 0 && (
              <table className="w-full text-[13px]">
                <thead className="bg-warmstone-50 text-[11px] uppercase tracking-wide text-warmstone-500">
                  <tr>
                    <th className="w-10" />
                    <th className="text-left font-bold px-3 py-2">Bin</th>
                    <th className="text-right font-bold px-3 py-2">Lots</th>
                    <th className="text-right font-bold px-5 py-2">Net stock</th>
                  </tr>
                </thead>
                <tbody>
                  {bins.map((b) => {
                    const reason = unavailableReason(b);
                    const on = selected.includes(b.binCode);
                    return (
                      <tr key={b.binCode} className={`border-t border-warmstone-100 ${reason ? "text-warmstone-400" : on ? "bg-brand-50/60" : ""}`}>
                        <td className="pl-4">
                          <input type="checkbox" disabled={Boolean(reason)} checked={on} onChange={() => toggle(b.binCode)} aria-label={`Select ${b.binCode}`} />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-mono font-semibold">{b.binCode}</div>
                          <div className="text-[11.5px] text-warmstone-500">{reason ?? (b.store ? `Store ${b.store}` : "Store not recorded")}</div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{b.lotCount}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums font-semibold">{b.kg ? formatTonnes(b.kg) : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <aside className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs space-y-3 lg:sticky lg:top-4">
          <h3 className="text-[15px] font-bold text-warmstone-900">Batch total</h3>
          <div>
            <div className="text-[11px] font-bold uppercase text-warmstone-500">Selected net stock</div>
            <div className="text-2xl font-bold tabular-nums text-warmstone-900">{formatTonnes(plan.plannedKg)}</div>
          </div>
          <dl className="text-[13px] space-y-1.5">
            <Row label="Bins selected" value={String(chosen.length)} />
            <Row label="Daily capacity" value={`${DAILY_CAPACITY_KG / 1000} t/day`} />
            <Row label="Estimated duration" value={chosen.length ? `≈ ${plan.days} days` : "-"} />
            <Row label="Estimated end" value={chosen.length && plan.endDate ? formatDate(plan.endDate) : "-"} />
          </dl>
          {chosen.length > 0 && (
            <div className={`rounded-xl border p-3 text-[12px] ${plan.withinMonthlyGuide ? "bg-success-50 border-success-200 text-success-800" : "bg-ambernut-50 border-ambernut-200 text-ambernut-800"}`}>
              <b>{plan.withinMonthlyGuide ? "Within the monthly range." : "Outside the monthly range."}</b> Target {formatTonnes(MONTHLY_GUIDE_KG.min)}–{formatTonnes(MONTHLY_GUIDE_KG.max)}; outside it you only get a warning.
            </div>
          )}
          {lotsWithoutKg > 0 && (
            <p className="text-[12px] text-ambernut-800">
              {lotsWithoutKg} Lot{lotsWithoutKg === 1 ? "" : "s"} in the selected bins add no kg (no GRN weight recorded, or split over several bins) and are not in the total.
            </p>
          )}
          {error && <p className="text-[12.5px] text-danger-700">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Link to="/production/batches" className={`${secondaryButton} flex-1`}>Cancel</Link>
            <button type="submit" disabled={saving || !selected.length || !shownCode.trim() || !startDate} className={`${primaryButton} flex-[2]`}>
              <span className="material-symbols-outlined text-[18px]">check</span>Create batch
            </button>
          </div>
        </aside>
      </div>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-warmstone-500">{label}</dt>
      <dd className="font-semibold tabular-nums text-warmstone-900">{value}</dd>
    </div>
  );
}
