import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Card, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { inputClass } from "../../components/ui/Input";
import { api, ApiError } from "../../repository/api";
import { Pill } from "../../components/ui/Pill";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { StatBlock } from "../../components/ui/StatBlock";
import { StepNav, type StepItem } from "../../components/ui/StepNav";
import { RcnReceiptStatusPill, formatKg } from "../../components/production/batchUi";
import { MoistureCard } from "../../components/production/MoistureCard";
import { WeighingCard } from "../../components/production/WeighingCard";
import { SheetRef } from "../../components/ui/SheetRef";
import { AcceptanceCard } from "../../components/production/AcceptanceCard";
import { LOAD_STEPS, STEP_PILL, firstStepToDo, loadStepStates, stepSource, stepsDone, type LoadPermissions, type LoadStepId } from "../../components/production/loadSteps";
import { useRcnReceipts } from "../../state/rcnReceipts";
import { useProductionPermissions } from "../../state/AuthContext";
import { weighingTotals } from "@anagroci/contract/domain/rcnWeighing";
import { formatDate, formatDateTime } from "@anagroci/contract/domain/dateFormat";
import type { RcnReceipt } from "@anagroci/contract/types/rcnReceipt";

const isStep = (v: string | null): v is LoadStepId => LOAD_STEPS.some((s) => s.id === v);

/**
 * One load (RCN receipt) on a page of its own, laid out like a truck's Reception page: where it came from and how far it
 * has got at the top, its kg at a glance, then its steps down the side and the picked step's form beside them. One step
 * per client Excel file, each saying which file it replaces (loadSteps.ts), so the page reads like the sheets the floor
 * already knows. Steps are recorded in any order, so every one can be opened; the marks only say where each stands. The
 * picked step is in the URL (?step=), so a link or a refresh lands on it.
 */
export function RcnReceiptPage() {
  const { code = "", id = "" } = useParams();
  const receipts = useRcnReceipts(code, { enabled: Boolean(code) });
  const perm = useProductionPermissions();
  const [params, setParams] = useSearchParams();

  const receipt = receipts.rows.find((r) => r.id === id);
  if (!receipt) {
    return <div className="p-10 text-warmstone-400 text-[13px]">{receipts.loading ? "Loading…" : receipts.error ?? `Load ${id} isn't in production run ${code}.`}</div>;
  }

  // Once production accepts the load, its weighing and quality are closed to the warehouse; only an Admin corrects them.
  const open = !receipt.acceptance || perm.isAdmin;
  const can: LoadPermissions = {
    canReceive: perm.intake && open,
    canEnterMoisture: perm.moistureCheck && open,
    canReview: perm.intake,
    canAccept: perm.factory,
  };
  const onChanged = () => void receipts.refetch();
  const states = loadStepStates(receipt);
  const done = stepsDone(receipt);
  const asked = params.get("step");
  const step: LoadStepId = isStep(asked) ? asked : firstStepToDo(receipt);
  const pick = (s: LoadStepId) => setParams((p) => { const next = new URLSearchParams(p); next.set("step", s); return next; }, { replace: true });
  const next = LOAD_STEPS.find((s) => states[s.id] !== "done");
  const def = LOAD_STEPS.find((s) => s.id === step)!;
  // Under each step, the Excel file it replaces; its mark says where it stands.
  const steps: StepItem<LoadStepId>[] = LOAD_STEPS.map((s) => ({ id: s.id, label: s.label, state: states[s.id], sub: stepSource(s) }));
  const runHref = `/production/runs/${encodeURIComponent(code)}?stage=intake`;

  return (
    <div className="space-y-5">
      <nav className="flex items-center gap-1.5 text-[13px] text-warmstone-500" aria-label="Breadcrumb">
        <Link to="/production/runs" className="hover:text-brand-700">Production runs</Link>
        <span className="material-symbols-outlined text-[16px] text-warmstone-300">chevron_right</span>
        <Link to={runHref} className="font-mono hover:text-brand-700">{code}</Link>
        <span className="material-symbols-outlined text-[16px] text-warmstone-300">chevron_right</span>
        <span className="font-mono font-semibold text-warmstone-900">{receipt.id}</span>
      </nav>

      <Card>
        <div className="px-5 py-4 flex flex-col lg:flex-row lg:items-start justify-between gap-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-warmstone-500 mb-1.5">RCN receipt · Production run {code}</p>
            <h1 className="text-2xl font-bold tracking-tight text-warmstone-900 flex flex-wrap items-center gap-3">
              <span className="font-mono">{receipt.id}</span> <RcnReceiptStatusPill status={receipt.status} />
            </h1>
            <p className="text-[13px] text-warmstone-500 mt-1">
              BTM {receipt.btmNo} · from <span className="font-mono">{receipt.binCode}</span> · {formatDate(receipt.date)}
            </p>
          </div>
          <div className="bg-warmstone-50 border border-warmstone-200 rounded-xl p-4 w-full lg:w-96">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-warmstone-500">Progress</p>
              <span className="text-[12px] font-semibold text-warmstone-700 tabular-nums">{done} of {LOAD_STEPS.length} steps</span>
            </div>
            <p className="text-[13px] font-semibold text-warmstone-900 mb-2 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[18px] text-brand-700">arrow_forward</span>
              {next ? next.label : "Every step is done"}
            </p>
            <ProgressBar value={done} max={LOAD_STEPS.length} label="Steps done" />
          </div>
        </div>
      </Card>

      <LoadFigures receipt={receipt} />

      <div className="grid lg:grid-cols-[17rem_minmax(0,1fr)] gap-5 items-start">
        <aside className="bg-white border border-warmstone-200 rounded-2xl shadow-xs p-2 lg:sticky lg:top-4">
          <StepNav label="Steps of this load" steps={steps} selected={step} onSelect={pick} />
        </aside>

        <Card>
          <div className="px-5 pt-4 pb-3 border-b border-warmstone-100 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>{def.label}</CardTitle>
                <p className="text-[12px] text-warmstone-500 mt-0.5">{def.hint}</p>
              </div>
              <Pill tone={STEP_PILL[states[step]].tone} label={STEP_PILL[states[step]].label} />
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <LoadBins receipt={receipt} />
              {def.sheet && <SheetRef sheets={[`${def.sheet}.xlsx`]} />}
            </div>
          </div>
          <div className="p-5">
            {step === "receipt" && <RegisterRow receipt={receipt} runHref={runHref} canEdit={can.canReceive} onChanged={onChanged} />}
            {step === "moisture" && <MoistureCard receipt={receipt} canEnter={can.canEnterMoisture} canReview={can.canReview} direct={can.canReview} onChanged={onChanged} />}
            {step === "weighing" && <WeighingCard receipt={receipt} canEdit={can.canReceive} onChanged={onChanged} />}
            {step === "acceptance" && <AcceptanceCard receipt={receipt} canAccept={can.canAccept} onChanged={onChanged} />}
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * The load's kg at a glance, as the tally's totals box gives them; a net only once the final weight closes the weighing.
 * "To silos" is what goes in on production's acceptance, shown in green once it has.
 */
function LoadFigures({ receipt }: { receipt: RcnReceipt }) {
  const t = weighingTotals(receipt.pallets, receipt.finalWeight ?? { emptyPallets: [] });
  const closed = Boolean(receipt.finalWeight);
  const inSilos = Boolean(receipt.acceptance);
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
      <StatBlock icon="pallet" label="Pallets" value={String(t.pallets)} sub={`${t.bags.toLocaleString("en-US")} bags`} />
      <StatBlock icon="scale" label="Gross" value={t.pallets ? formatKg(t.grossKg) : "-"} />
      <StatBlock icon="remove" label="Pallets + bags" value={closed ? formatKg(t.bagsKg + t.palletKg) : "-"} sub={closed ? undefined : "after the final weight"} />
      <StatBlock icon="inventory_2" label="Net received" value={closed ? formatKg(t.netKg) : "-"} />
      <StatBlock icon="move_down" label={inSilos ? "In the silos" : "To silos"} value={closed ? formatKg(t.toSilosKg) : "-"} sub={closed ? `dust ${formatKg(t.dustKg)} · voids ${formatKg(t.voidsKg)}${inSilos ? "" : " · once production accepts"}` : undefined} tone={inSilos ? "success" : "default"} />
    </div>
  );
}

/**
 * Which bin this load is worked from, repeated on every step so nobody has to scroll back up to check it. The factory
 * bin only exists once pallets are weighed (the tally sheet's "Bin No" per pallet), so until then it isn't shown.
 */
function LoadBins({ receipt }: { receipt: RcnReceipt }) {
  const factoryBins = [...new Set(receipt.pallets.map((p) => p.factoryBin).filter(Boolean))];
  return (
    <p className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-[12px] text-brand-800">
      <span className="material-symbols-outlined text-[16px]">inventory_2</span>
      <span className="font-semibold">Bin</span>
      <span className="font-mono font-semibold">{receipt.binCode}</span>
      {factoryBins.length > 0 && (
        <>
          <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
          <span className="font-mono font-semibold">{factoryBins.join(", ")}</span>
        </>
      )}
    </p>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The receipt step: the load as its row in the client's "1. RCN Receipts" register, in the register's columns and words
 * (Date, Month, Year, Crop Year, BTM No, Source Bin No, BIN No, Received Gross Qty, Pallets+Bags Wt, Net Weight). The kg
 * are worked out from the weighing; the crop year is the one value typed here.
 */
function RegisterRow({ receipt, runHref, canEdit, onChanged }: { receipt: RcnReceipt; runHref: string; canEdit: boolean; onChanged: () => void }) {
  const t = weighingTotals(receipt.pallets, receipt.finalWeight ?? { emptyPallets: [] });
  const closed = Boolean(receipt.finalWeight);
  const factoryBins = [...new Set(receipt.pallets.map((p) => p.factoryBin))];
  const cells: [string, ReactNode][] = [
    ["Date", formatDate(receipt.date)],
    ["Month", `${MONTHS[Number(receipt.date.slice(5, 7)) - 1]}-${receipt.date.slice(2, 4)}`],
    ["Year", receipt.date.slice(0, 4)],
    ["Crop Year", <CropYear key="crop" receipt={receipt} canEdit={canEdit} onChanged={onChanged} />],
    ["BTM No", receipt.btmNo],
    ["Source Bin No", <span key="src" className="font-mono">{receipt.binCode}</span>],
    ["BIN No", factoryBins.length ? <span key="bin" className="font-mono">{factoryBins.join(", ")}</span> : "-"],
    ["Received Gross Qty (kgs)", t.pallets ? formatKg(t.grossKg) : "-"],
    ["Pallets+Bags Wt (kgs)", closed ? formatKg(t.bagsKg + t.palletKg) : "-"],
    ["Net Weight (kgs)", closed ? formatKg(t.netKg) : "-"],
  ];
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-4">
        {cells.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] font-semibold text-warmstone-500">{label}</dt>
            <dd className="text-[13px] font-medium text-warmstone-900 tabular-nums mt-0.5">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[12px] text-warmstone-500">
        Production run <Link to={runHref} className="font-mono hover:text-brand-700">{receipt.batchCode}</Link> · recorded {formatDateTime(receipt.createdAt)}{receipt.createdBy ? ` by ${receipt.createdBy}` : ""}
      </p>
    </div>
  );
}

/** The crop year, given or corrected in place: a load made from the tally sheet arrives without one. */
function CropYear({ receipt, canEdit, onChanged }: { receipt: RcnReceipt; canEdit: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(receipt.cropYear ?? receipt.date.slice(0, 4));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2">
        {receipt.cropYear ?? <span className="text-warmstone-400">Not given</span>}
        {canEdit && <button type="button" className="text-[12px] font-semibold text-brand-700 hover:underline" onClick={() => setEditing(true)}>{receipt.cropYear ? "Change" : "Add"}</button>}
      </span>
    );
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.setRcnCropYear(receipt.id, value);
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form onSubmit={save} className="space-y-1">
      <span className="flex items-center gap-1.5">
        <input autoFocus inputMode="numeric" className={`${inputClass} tabular-nums w-24`} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Crop year" />
        <Button type="submit" disabled={saving}>Save</Button>
      </span>
      {error && <span role="alert" className="block text-[12px] text-danger-700">{error}</span>}
    </form>
  );
}
