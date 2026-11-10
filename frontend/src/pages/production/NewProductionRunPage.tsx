import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { DateInput } from "../../components/ui/DateInput";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { Field, inputClass } from "../../components/ui/Input";
import { formatTonnes } from "../../components/production/batchUi";
import { PRODUCTION_PAGE_SIZE, kgCol, numCol, statusCol, textCol } from "../../components/production/columns";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { Pill } from "../../components/ui/Pill";
import { useBatchBins } from "../../state/productionBatches";
import { ProductionFactorySwitcher, useProductionFactory } from "../../state/productionFactory";
import { api, ApiError } from "../../repository/api";
import { DAILY_CAPACITY_KG, MONTHLY_GUIDE_KG, planBatch } from "@anagroci/contract/domain/productionBatch";
import { formatDate, todayIso } from "@anagroci/contract/domain/dateFormat";
import type { AvailableBin } from "@anagroci/contract/types/productionBatch";

/** Why a bin can't be ticked, or undefined when it can. */
function unavailableReason(b: AvailableBin): string | undefined {
  if (b.inBatch) return `Already in production run ${b.inBatch}`;
  if (!b.inMaster) return "Not in Masters › Bins";
  if (b.lotCount === 0) return "No stock";
  return undefined;
}

interface LoadRow { date: string; btmNo: string; binCode: string }

/** A row nobody started is skipped; a row half filled in is a mistake to point out before saving. */
const isBlank = (l: LoadRow) => !l.btmNo.trim() && !l.binCode;
const isWhole = (l: LoadRow) => Boolean(l.date && l.btmNo.trim() && l.binCode);

/**
 * Start a production run: tick the warehouse bins going to production, say when, and — if loads have already come in —
 * record each one's BTM slip here too, so the run starts with its RCN receipts. The run gets its ID from the system
 * (PR-YAK-2026-001), so there is no name to invent. The bins and their Lots come from procurement, so what is sent is
 * what procurement recorded. The run and its loads are saved together, or not at all. The monthly range is a guide
 * only: outside it the screen warns, never blocks.
 */
export function NewProductionRunPage() {
  const navigate = useNavigate();
  const { rows: bins, loading, error: loadError } = useBatchBins();
  // An admin picks the factory on the runs list; with more than one, say which this run is for.
  const { factory, factories } = useProductionFactory();
  const [selected, setSelected] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(todayIso());
  const [loads, setLoads] = useState<LoadRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = useMemo(() => bins.filter((b) => selected.includes(b.binCode)), [bins, selected]);
  const plan = planBatch(chosen.map((b) => b.kg), startDate);
  const lots = chosen.reduce((n, b) => n + b.lotCount, 0);
  const lotsWithoutKg = chosen.reduce((n, b) => n + b.lotsWithoutKg, 0);

  const toggle = (binCode: string) => {
    const off = selected.includes(binCode);
    setSelected((s) => (off ? s.filter((c) => c !== binCode) : [...s, binCode]));
    // A load can only come from a bin of the run: unticking a bin clears it from the loads that named it.
    if (off) setLoads((ls) => ls.map((l) => (l.binCode === binCode ? { ...l, binCode: "" } : l)));
  };
  // The bins on offer, as a filterable, paged table: tick a row (or click it) to take the bin into the run.
  const binColumns: Column<AvailableBin>[] = [
    {
      label: "", nowrap: true,
      render: (b) => (
        <input type="checkbox" disabled={Boolean(unavailableReason(b))} checked={selected.includes(b.binCode)} onChange={() => toggle(b.binCode)} aria-label={`Select ${b.binCode}`} />
      ),
    },
    {
      ...textCol<AvailableBin>("Bin", (b) => b.binCode, { mono: true, strong: true }),
      render: (b) => (
        <span>
          <span className="block font-mono font-semibold">{b.binCode}</span>
          {b.lotsKept > 0 && <span className="block text-[11px] font-semibold text-ambernut-700">{b.lotsKept} Lot{b.lotsKept === 1 ? " is" : "s are"} being kept in the warehouse and {b.lotsKept === 1 ? "isn't" : "aren't"} counted</span>}
        </span>
      ),
    },
    textCol("Store", (b) => b.store, { mono: true }),
    numCol("Lots", (b) => b.lotCount, { digits: 0 }),
    { ...kgCol("Net stock", (b) => b.kg, { zeroAsDash: true, strong: true }), render: (b) => (b.kg ? <b className="font-semibold">{formatTonnes(b.kg)}</b> : "-") },
    statusCol("Can be taken", (b) => unavailableReason(b) ?? "Yes", (b) => {
      const reason = unavailableReason(b);
      return reason ? <span className="text-[12px] text-warmstone-500">{reason}</span> : <Pill tone="entry" label={selected.includes(b.binCode) ? "Ticked" : "Yes"} />;
    }),
  ];
  const setLoad = (i: number, patch: Partial<LoadRow>) => setLoads((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addLoad = () => setLoads((ls) => [...ls, { date: startDate, btmNo: "", binCode: selected.length === 1 ? selected[0]! : "" }]);
  const filled = loads.filter((l) => !isBlank(l));
  const halfDone = loads.findIndex((l) => !isBlank(l) && !isWhole(l));
  // The same BTM from the same bin twice in this form: allowed (a real second load happens), but worth a look.
  const repeats = filled.filter((l, i) => filled.findIndex((m) => m.binCode === l.binCode && m.btmNo.trim().toUpperCase() === l.btmNo.trim().toUpperCase()) !== i);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (halfDone >= 0) return setError(`Load ${halfDone + 1} needs a date, a BTM number and the bin it came from — or remove it.`);
    setSaving(true);
    setError(null);
    try {
      const run = await api.createBatch({ startDate, bins: selected, loads: filled });
      // Straight to its loads, every form open.
      navigate(`/production/runs/${encodeURIComponent(run.code)}?stage=intake`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <PageHeader
        kicker={factories.length > 1 ? `Production · ${factory}` : "Production"}
        title="Start a production run"
        lede="Tick the warehouse bins that go to the factory floor together. Each bin shows how many Lots it holds and their weight."
        actions={<ProductionFactorySwitcher />}
      />

      <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
        <Card>
          <div className="px-5 pt-4 pb-3">
            <CardTitle>Warehouse bins</CardTitle>
            <p className="text-[12px] text-warmstone-500 mt-0.5">
              Bins holding Lots whose procurement is complete: quality passed, GRN quantity and price recorded, drying answered
              and marked "Ready for production". Stock is the Lots' GRN weight; a Lot that came on a transfer (BKT) counts in the
              bin it was unloaded into, at the net weighed on arrival.
            </p>
          </div>
          {loadError && <p role="alert" className="px-5 pb-4 text-[13px] text-danger-700">{loadError}</p>}
          {!loading && bins.length === 0 && (
            <p className="px-5 pb-5 text-[13px] text-warmstone-500">No bin at the factory holds completed procurement stock yet.</p>
          )}
          {bins.length > 0 && (
            <div className="px-5 pb-5">
              <DataTable pageSize={PRODUCTION_PAGE_SIZE} columns={binColumns} rows={bins} keyFn={(b) => b.binCode} onRowClick={(b) => !unavailableReason(b) && toggle(b.binCode)} />
            </div>
          )}
        </Card>

        <Card>
          <div className="px-5 pt-4 pb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Loads already brought (optional)</CardTitle>
              <p className="text-[12px] text-warmstone-500 mt-0.5">
                One row for each load that has come from these bins, with the number on its BTM slip. Each becomes an RCN receipt of the
                run. Loads that come later are recorded on the run's page.
              </p>
            </div>
            <Button variant="secondary" icon="add" onClick={addLoad} disabled={selected.length === 0}>Add a load</Button>
          </div>
          <div className="px-5 pb-5 space-y-3">
            {selected.length === 0 && <p className="text-[13px] text-warmstone-500">Tick a bin above first: a load comes from one of the run's bins.</p>}
            {loads.map((l, i) => (
              <div key={i} className={`grid sm:grid-cols-[auto_1fr_1fr_1fr_auto] gap-3 items-end rounded-xl border p-3 ${i === halfDone && error ? "border-danger-300 bg-danger-50/40" : "border-warmstone-200"}`}>
                <span className="text-[12px] font-bold text-warmstone-500 pb-2.5">Load {i + 1}</span>
                <Field label="Date">
                  <DateInput value={l.date} onChange={(v) => setLoad(i, { date: v })} className={inputClass} />
                </Field>
                <Field label="BTM number">
                  <input className={`${inputClass} tabular-nums`} value={l.btmNo} onChange={(e) => setLoad(i, { btmNo: e.target.value })} placeholder="e.g. 112" />
                </Field>
                <Field label="From bin">
                  <select className={inputClass} value={l.binCode} onChange={(e) => setLoad(i, { binCode: e.target.value })}>
                    <option value="">Choose a bin…</option>
                    {selected.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </Field>
                <button type="button" onClick={() => setLoads((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove load ${i + 1}`} className="p-1.5 mb-1 rounded-lg text-warmstone-400 hover:bg-warmstone-100 hover:text-warmstone-700 transition-colors">
                  <span className="material-symbols-outlined text-[20px]">delete</span>
                </button>
              </div>
            ))}
            {repeats.length > 0 && (
              <p className="rounded-xl border bg-ambernut-50 border-ambernut-200 text-ambernut-800 p-3 text-[12px]">
                <b>The same BTM from the same bin is here twice</b> ({repeats.map((r) => `BTM ${r.btmNo} from ${r.binCode}`).join("; ")}). Keep it only if it's really a second load.
              </p>
            )}
          </div>
        </Card>
        </div>

        <aside className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs space-y-4 lg:sticky lg:top-20">
          <CardTitle>This run</CardTitle>
          <Field label="Start date">
            <DateInput value={startDate} onChange={setStartDate} className={inputClass} />
          </Field>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-warmstone-500">Selected net stock</div>
            <div className="text-[28px] font-bold tracking-tight tabular-nums text-warmstone-900">{formatTonnes(plan.plannedKg)}</div>
          </div>
          <dl className="text-[13px] space-y-1.5">
            <Row label="Bins" value={String(chosen.length)} />
            <Row label="Lots" value={String(lots)} />
            <Row label="Loads recorded" value={String(filled.length)} />
            <Row label="Daily capacity" value={`${DAILY_CAPACITY_KG / 1000} t/day`} />
            <Row label="Estimated duration" value={chosen.length ? `≈ ${plan.days} days` : "-"} />
            <Row label="Estimated end" value={chosen.length && plan.endDate ? formatDate(plan.endDate) : "-"} />
          </dl>
          {chosen.length > 0 && (
            <p className={`rounded-xl border p-3 text-[12px] ${plan.withinMonthlyGuide ? "bg-success-50 border-success-200 text-success-800" : "bg-ambernut-50 border-ambernut-200 text-ambernut-800"}`}>
              <b>{plan.withinMonthlyGuide ? "Within the monthly range." : "Outside the monthly range."}</b> About {formatTonnes(MONTHLY_GUIDE_KG.min)}–{formatTonnes(MONTHLY_GUIDE_KG.max)} a month; outside it this is only a warning.
            </p>
          )}
          {lotsWithoutKg > 0 && (
            <p className="text-[12px] text-ambernut-800">
              {lotsWithoutKg} Lot{lotsWithoutKg === 1 ? "" : "s"} in the selected bins add no kg (no GRN weight recorded, or split over several bins) and are not in the total.
            </p>
          )}
          {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" onClick={() => navigate("/production/runs")}>Cancel</Button>
            <Button type="submit" icon="play_arrow" disabled={saving || !selected.length || !startDate}>Start production run</Button>
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
