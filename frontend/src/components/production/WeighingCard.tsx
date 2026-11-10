import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { formatKg } from "./batchUi";
import { Button } from "../ui/Button";
import { inputClass } from "../ui/Input";
import { api, ApiError } from "../../repository/api";
import { JUTE_BAG_KG, emptyPalletCountNote, finalWeightError, palletError, pctOfNet, weighingTotals, type WeighingTotals } from "@anagroci/contract/domain/rcnWeighing";
import { formatDateTime } from "@anagroci/contract/domain/dateFormat";
import type { RcnPallet, RcnPalletInput, RcnReceipt } from "@anagroci/contract/types/rcnReceipt";

const cellInput = `${inputClass} tabular-nums`;

/**
 * Two separate steps of a load, as the client's RCN Receipts Tally Sheet records them: `pallets` is one row per
 * pallet on the scale; `final` closes the weighing with the empty pallets, dust and voids. Totals are previewed with
 * the same contract function the server uses. Steps are recorded in any order, so both are open whatever else the
 * load has; the final weight is saved again to correct it. Read-only only for someone who can't weigh.
 */
export function WeighingCard({ receipt, part, canEdit, onChanged }: { receipt: RcnReceipt; part: "pallets" | "final"; canEdit: boolean; onChanged: () => void }) {
  const fw = receipt.finalWeight;
  const totals = weighingTotals(receipt.pallets, fw ?? { emptyPallets: [] });

  if (part === "pallets") {
    return (
      <div className="space-y-3">
        <TotalsStrip t={totals} final={Boolean(fw)} />
        <PalletTable receipt={receipt} editable={canEdit} onChanged={onChanged} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {fw && (
        <p className="text-[12px] text-warmstone-500">
          Saved {formatDateTime(fw.finalisedAt)}{fw.finalisedBy ? ` by ${fw.finalisedBy}` : ""}.{canEdit ? " Change it below and save again to correct it." : ""}
        </p>
      )}
      {canEdit ? (
        // Keyed by when it was saved, so a fresh save shows the saved values again.
        <FinalWeightForm key={fw?.finalisedAt ?? "new"} receipt={receipt} onSaved={onChanged} />
      ) : fw ? (
        <WeighingSummary t={totals} />
      ) : (
        <p className="text-[13px] text-warmstone-500">Not saved yet.</p>
      )}
    </div>
  );
}

function TotalsStrip({ t, final }: { t: WeighingTotals; final: boolean }) {
  const item = (label: string, value: string) => (
    <div>
      <span className="block text-[11px] uppercase tracking-wide font-bold text-warmstone-500">{label}</span>
      <span className="block text-[15px] font-bold text-warmstone-900 tabular-nums">{value}</span>
    </div>
  );
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl border border-warmstone-200 bg-white px-4 py-3 mb-3">
      {item("Pallets", String(t.pallets))}
      {item("Bags", t.bags.toLocaleString("en-US"))}
      {item("Gross", formatKg(t.grossKg))}
      {item(final ? "Net received" : "Net so far (no pallets off yet)", formatKg(t.netKg))}
    </div>
  );
}

function PalletTable({ receipt, editable, onChanged }: { receipt: RcnReceipt; editable: boolean; onChanged: () => void }) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const last = receipt.pallets.at(-1);

  if (receipt.pallets.length === 0 && !editable) return <p className="text-[12px] text-warmstone-500">No pallets weighed yet.</p>;

  return (
    <div className="rounded-xl border border-warmstone-200 bg-white overflow-hidden">
      <table className="w-full text-[12px]">
        <thead className="bg-warmstone-50 text-[11px] uppercase tracking-wide text-warmstone-500">
          <tr>
            <th className="text-left font-bold px-4 py-2 w-14">#</th>
            <th className="text-left font-bold px-2 py-2">Gross kg</th>
            <th className="text-left font-bold px-2 py-2">Bags</th>
            <th className="text-left font-bold px-2 py-2">Factory bin</th>
            {editable && <th className="px-4 py-2" />}
          </tr>
        </thead>
        <tbody>
          {receipt.pallets.map((p) =>
            editingId === p.id ? (
              <PalletRow key={p.id} label={String(p.no)} initial={p} submitLabel="Save" onCancel={() => setEditingId(null)} save={(v) => api.updateRcnPallet(p.id, v)} onSaved={() => { setEditingId(null); onChanged(); }} />
            ) : (
              <tr key={p.id} className="border-t border-warmstone-100">
                <td className="px-4 py-2 text-warmstone-500 tabular-nums">{p.no}</td>
                <td className="px-2 py-2 font-mono">{p.grossKg}</td>
                <td className="px-2 py-2 font-mono">{p.bags}</td>
                <td className="px-2 py-2 font-mono">{p.factoryBin}</td>
                {editable && (
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button type="button" className="text-brand-700 font-semibold hover:underline mr-3" onClick={() => setEditingId(p.id)}>Edit</button>
                    <DeleteButton pallet={p} onChanged={onChanged} />
                  </td>
                )}
              </tr>
            ),
          )}
          {editable && editingId === null && (
            <PalletRow
              key={receipt.pallets.length}
              label={String(receipt.pallets.length + 1)}
              // Most pallets carry 30 bags into the same factory bin as the one before, so both carry over.
              initial={{ grossKg: "", bags: last?.bags ?? "30", factoryBin: last?.factoryBin ?? "" }}
              submitLabel="Add pallet"
              autoFocus={receipt.pallets.length > 0}
              save={(v) => api.addRcnPallet(receipt.id, v)}
              onSaved={onChanged}
            />
          )}
        </tbody>
      </table>
    </div>
  );
}

/** One pallet's inputs as a table row; Enter saves, as on the scale you type the next one right away. */
function PalletRow({ label, initial, submitLabel, autoFocus, save, onSaved, onCancel }: {
  label: string;
  initial: RcnPalletInput;
  submitLabel: string;
  autoFocus?: boolean;
  save: (v: RcnPalletInput) => Promise<unknown>;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [v, setV] = useState<RcnPalletInput>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = `pallet-${label}`;
  const set = (key: keyof RcnPalletInput) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = palletError(v);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      await save(v);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <>
      <tr className="border-t border-warmstone-100 bg-brand-50/40">
        <td className="px-4 py-2 text-warmstone-500 tabular-nums">
          {label}
          {/* A <form> can't sit inside a table row, so the inputs join it by id. */}
          <form id={formId} onSubmit={submit} />
        </td>
        <td className="px-2 py-2"><input form={formId} autoFocus={autoFocus} inputMode="decimal" className={cellInput} value={v.grossKg ?? ""} onChange={set("grossKg")} placeholder="e.g. 2308.9" /></td>
        <td className="px-2 py-2"><input form={formId} inputMode="numeric" className={cellInput} value={v.bags ?? ""} onChange={set("bags")} /></td>
        <td className="px-2 py-2"><input form={formId} className={cellInput} value={v.factoryBin ?? ""} onChange={set("factoryBin")} placeholder="e.g. ANA-10" /></td>
        <td className="px-4 py-2 text-right whitespace-nowrap">
          {onCancel && <span className="mr-2"><Button variant="secondary" onClick={onCancel}>Cancel</Button></span>}
          <Button type="submit" form={formId} disabled={saving}>{submitLabel}</Button>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={5} role="alert" className="px-4 pb-2 text-[12px] text-danger-700">{error}</td>
        </tr>
      )}
    </>
  );
}

function DeleteButton({ pallet, onChanged }: { pallet: RcnPallet; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!window.confirm(`Remove pallet ${pallet.no} (${pallet.grossKg} kg)?`)) return;
    setBusy(true);
    try {
      await api.deleteRcnPallet(pallet.id);
      onChanged();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : String(err));
      setBusy(false);
    }
  }
  return <button type="button" disabled={busy} className="text-danger-700 font-semibold hover:underline" onClick={remove}>Remove</button>;
}

type Stack = { weightKg: string; count: string };

function FinalWeightForm({ receipt, onSaved }: { receipt: RcnReceipt; onSaved: () => void }) {
  const saved = receipt.finalWeight;
  // A saved final weight opens filled in, to be corrected and saved again.
  const [stacks, setStacks] = useState<Stack[]>(() =>
    saved?.emptyPallets.length ? saved.emptyPallets.map((s) => ({ weightKg: s.weightKg, count: s.count ?? "" })) : [{ weightKg: "", count: "" }]);
  const [dustKg, setDust] = useState(saved?.dustKg ?? "");
  const [voidsKg, setVoids] = useState(saved?.voidsKg ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastWeight = useRef<HTMLInputElement>(null);

  const values = { emptyPallets: stacks, dustKg, voidsKg };
  const totals = weighingTotals(receipt.pallets, values);
  const countNote = emptyPalletCountNote(stacks, receipt.pallets.length);
  const setStack = (i: number, key: keyof Stack, value: string) => setStacks((s) => s.map((x, j) => (j === i ? { ...x, [key]: value } : x)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = finalWeightError(values, receipt.pallets.length);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      await api.saveRcnFinalWeight(receipt.id, values);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSaving(false);
    }
  }

  const label = (text: string, el: ReactNode, hint?: string) => (
    <label className="block">
      <span className="block text-[12px] font-semibold text-warmstone-700 mb-1.5">{text}</span>
      {el}
      {hint && <span className="block mt-1 text-[12px] text-warmstone-500">{hint}</span>}
    </label>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-[12px] text-warmstone-500">Weigh the empty pallets, then enter dust and voids. It needs at least one pallet weighed above.</p>

      <div>
        <span className="block text-[12px] font-semibold text-warmstone-700 mb-1.5">Empty pallets</span>
        <div className="space-y-2">
          {stacks.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
              <input ref={i === stacks.length - 1 ? lastWeight : undefined} inputMode="decimal" className={`${inputClass} tabular-nums`} value={s.weightKg} onChange={(e) => setStack(i, "weightKg", e.target.value)} placeholder="Weight kg, e.g. 374.3" />
              <input inputMode="numeric" className={`${inputClass} tabular-nums`} value={s.count} onChange={(e) => setStack(i, "count", e.target.value)} placeholder="No. of pallets (optional)" />
              <button type="button" className="text-warmstone-500 hover:text-danger-700 disabled:opacity-30" disabled={stacks.length === 1} onClick={() => setStacks((x) => x.filter((_, j) => j !== i))} aria-label="Remove this weighing">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="mt-2 text-[12px] text-brand-700 font-semibold hover:underline"
          onClick={() => {
            setStacks((x) => [...x, { weightKg: "", count: "" }]);
            setTimeout(() => lastWeight.current?.focus());
          }}
        >
          + Another weighing
        </button>
        {countNote && <p className="mt-1.5 text-[12px] text-ambernut-800">{countNote}</p>}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {label("Dust kg", <input inputMode="decimal" className={`${inputClass} tabular-nums`} value={dustKg} onChange={(e) => setDust(e.target.value)} placeholder="e.g. 925.7" />, "Leave blank if not recorded.")}
        {label("Voids kg", <input inputMode="decimal" className={`${inputClass} tabular-nums`} value={voidsKg} onChange={(e) => setVoids(e.target.value)} placeholder="e.g. 0.5" />, "Leave blank if not recorded.")}
      </div>

      <WeighingSummary t={totals} />

      {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" icon="check" disabled={saving}>{saved ? "Update final weight" : "Save final weight"}</Button>
      </div>
    </form>
  );
}

/** The tally sheet's Print form summary box, in its order. */
function WeighingSummary({ t }: { t: WeighingTotals }) {
  const row = (label: string, value: string, strong?: boolean) => (
    <div className={`flex justify-between gap-3 py-1 border-b border-warmstone-100 last:border-0 ${strong ? "font-bold text-warmstone-900" : "text-warmstone-700"}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums whitespace-nowrap">{value}</dd>
    </div>
  );
  return (
    <dl className="rounded-xl border border-warmstone-200 bg-warmstone-50/60 px-4 py-2 text-[13px]">
      {row("Total gross weight", formatKg(t.grossKg))}
      {row(`Jute bags weight (${t.bags.toLocaleString("en-US")} × ${JUTE_BAG_KG} kg)`, `− ${formatKg(t.bagsKg)}`)}
      {row(`Empty pallets weight (${t.pallets} pallet${t.pallets === 1 ? "" : "s"})`, `− ${formatKg(t.palletKg)}`)}
      {row("Net weight received", formatKg(t.netKg), true)}
      {row(`Dust (${pctOfNet(t.dustKg, t.netKg).toFixed(2)} %)`, `− ${formatKg(t.dustKg)}`)}
      {row(`Voids (${pctOfNet(t.voidsKg, t.netKg).toFixed(3)} %)`, `− ${formatKg(t.voidsKg)}`)}
      {row("Net weight to silos", formatKg(t.toSilosKg), true)}
    </dl>
  );
}
