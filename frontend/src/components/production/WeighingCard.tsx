import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "../ui/Button";
import { Field, Input, inputClass } from "../ui/Input";
import { api, ApiError } from "../../repository/api";
import { JUTE_BAG_KG, finalWeightError, palletError, weighingTotals, type WeighingTotals } from "@anagroci/contract/domain/rcnWeighing";
import { formatDateTime } from "@anagroci/contract/domain/dateFormat";
import type { RcnPallet, RcnPalletInput, RcnReceipt } from "@anagroci/contract/types/rcnReceipt";

const cellInput = `${inputClass} tabular-nums`;
const kg2 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * A load's weighing, as the client's "19. RCN Receipts Tally Sheet" records it, in three plain parts: the pallets
 * (their Online sheet's columns), the empty pallets with dust and voids, then their Print form's totals box in its own
 * words. Totals are worked out with the same contract function the server uses. Parts can be filled in any order; the
 * second is saved again to correct it. Read-only for someone who can't weigh.
 */
export function WeighingCard({ receipt, canEdit, onChanged }: { receipt: RcnReceipt; canEdit: boolean; onChanged: () => void }) {
  return (
    <div className="space-y-6">
      <Part n={1} title="Pallets">
        <PalletTable receipt={receipt} editable={canEdit} onChanged={onChanged} />
      </Part>
      <Part n={2} title="Empty pallets, dust and voids">
        {/* Keyed by when it was saved, so a fresh save shows the saved values again. */}
        {canEdit
          ? <FinalWeightForm key={receipt.finalWeight?.finalisedAt ?? "new"} receipt={receipt} onSaved={onChanged} />
          : <SavedFinal receipt={receipt} />}
      </Part>
      {!canEdit && (
        <Part n={3} title="Totals">
          <TotalsBox t={weighingTotals(receipt.pallets, receipt.finalWeight ?? { emptyPallets: [] })} />
        </Part>
      )}
    </div>
  );
}

function Part({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h4 className="flex items-center gap-2 text-[13px] font-bold text-warmstone-900">
        <span className="w-6 h-6 rounded-full bg-brand-50 border border-brand-200 text-brand-800 text-[11px] font-bold flex items-center justify-center">{n}</span>
        {title}
      </h4>
      {children}
    </section>
  );
}

const TH = "text-left font-semibold px-3 py-2";

function PalletTable({ receipt, editable, onChanged }: { receipt: RcnReceipt; editable: boolean; onChanged: () => void }) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const last = receipt.pallets.at(-1);

  if (receipt.pallets.length === 0 && !editable) return <p className="text-[13px] text-warmstone-500">No pallets weighed yet.</p>;

  return (
    <div className="rounded-xl border border-warmstone-200 bg-white overflow-x-auto">
      {/* The tally sheet's Online columns, with its calculated Bags Weight moved last (Nov 2026: what the app works out comes after
          what a person types): Pallet No, Gross Weight, No of Bags, Bin No, Bags Weight. */}
      <table className="w-full text-[13px]">
        <thead className="bg-warmstone-50 text-[12px] text-warmstone-600">
          <tr>
            <th className={`${TH} w-20`}>Pallet No</th>
            <th className={TH}>Gross Weight (kg)</th>
            <th className={TH}>No of Bags</th>
            <th className={TH}>Bin No</th>
            <th className={TH}>Bags Weight (kg)</th>
            {editable && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody>
          {receipt.pallets.map((p) =>
            editingId === p.id ? (
              <PalletRow key={p.id} label={String(p.no)} initial={p} submitLabel="Save" onCancel={() => setEditingId(null)} save={(v) => api.updateRcnPallet(p.id, v)} onSaved={() => { setEditingId(null); onChanged(); }} />
            ) : (
              <tr key={p.id} className="border-t border-warmstone-100">
                <td className="px-3 py-2 text-warmstone-500 tabular-nums">{p.no}</td>
                <td className="px-3 py-2 tabular-nums">{p.grossKg}</td>
                <td className="px-3 py-2 tabular-nums">{p.bags}</td>
                <td className="px-3 py-2 font-mono">{p.factoryBin}</td>
                <td className="px-3 py-2 tabular-nums text-warmstone-500">{kg2((Number(p.bags) || 0) * JUTE_BAG_KG)}</td>
                {editable && (
                  <td className="px-3 py-2 text-right whitespace-nowrap">
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
              submitLabel="Add"
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
        <td className="px-3 py-2 text-warmstone-500 tabular-nums">
          {label}
          {/* A <form> can't sit inside a table row, so the inputs join it by id. */}
          <form id={formId} onSubmit={submit} />
        </td>
        <td className="px-3 py-2"><input form={formId} autoFocus={autoFocus} inputMode="decimal" className={cellInput} value={v.grossKg ?? ""} onChange={set("grossKg")} placeholder="e.g. 2308.9" aria-label="Gross Weight (kg)" /></td>
        <td className="px-3 py-2"><input form={formId} inputMode="numeric" className={cellInput} value={v.bags ?? ""} onChange={set("bags")} aria-label="No of Bags" /></td>
        <td className="px-3 py-2"><input form={formId} className={cellInput} value={v.factoryBin ?? ""} onChange={set("factoryBin")} placeholder="e.g. ANA-10" aria-label="Bin No" /></td>
        <td className="px-3 py-2 tabular-nums text-warmstone-500">{kg2((Number(v.bags) || 0) * JUTE_BAG_KG)}</td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          {onCancel && <span className="mr-2"><Button variant="secondary" onClick={onCancel}>Cancel</Button></span>}
          <Button type="submit" form={formId} disabled={saving}>{submitLabel}</Button>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={6} role="alert" className="px-3 pb-2 text-[12px] text-danger-700">{error}</td>
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

/** A stack's count isn't asked for here (the Online sheet has none); one saved from elsewhere is kept as it was. */
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

  const values = { emptyPallets: stacks, dustKg, voidsKg };
  const setWeight = (i: number, value: string) => setStacks((s) => s.map((x, j) => (j === i ? { ...x, weightKg: value } : x)));

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

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-xl border border-warmstone-200 bg-white p-4 space-y-4">
        <div>
          <span className="block text-[12px] font-semibold text-warmstone-700 mb-1.5">Pallet Weight (kg), one box per weighing</span>
          <div className="flex flex-wrap items-center gap-2">
            {stacks.map((s, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                <input inputMode="decimal" className={`${cellInput} w-28`} value={s.weightKg} onChange={(e) => setWeight(i, e.target.value)} placeholder="e.g. 374.3" aria-label={`Pallet weight ${i + 1}`} />
                {stacks.length > 1 && (
                  <button type="button" className="text-warmstone-400 hover:text-danger-700" onClick={() => setStacks((x) => x.filter((_, j) => j !== i))} aria-label={`Remove weighing ${i + 1}`}>
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                )}
              </span>
            ))}
            <Button variant="secondary" icon="add" onClick={() => setStacks((x) => [...x, { weightKg: "", count: "" }])}>Add</Button>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Dust (kg)"><Input numeric value={dustKg} onChange={(e) => setDust(e.target.value)} placeholder="e.g. 925.7" /></Field>
          <Field label="Voids (kg)"><Input numeric value={voidsKg} onChange={(e) => setVoids(e.target.value)} placeholder="e.g. 0.5" /></Field>
        </div>
        {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
        <div className="flex items-center justify-end gap-3">
          {saved && <span className="text-[12px] text-warmstone-500">Saved {formatDateTime(saved.finalisedAt)}{saved.finalisedBy ? ` by ${saved.finalisedBy}` : ""}</span>}
          <Button type="submit" icon="check" disabled={saving}>{saved ? "Save changes" : "Save"}</Button>
        </div>
      </div>

      <div>
        <h4 className="flex items-center gap-2 text-[13px] font-bold text-warmstone-900 mb-3">
          <span className="w-6 h-6 rounded-full bg-brand-50 border border-brand-200 text-brand-800 text-[11px] font-bold flex items-center justify-center">3</span>
          Totals
        </h4>
        <TotalsBox t={weighingTotals(receipt.pallets, values)} />
      </div>
    </form>
  );
}

function SavedFinal({ receipt }: { receipt: RcnReceipt }) {
  const fw = receipt.finalWeight;
  if (!fw) return <p className="text-[13px] text-warmstone-500">Not saved yet.</p>;
  return (
    <p className="text-[13px] text-warmstone-800">
      Pallet weight {fw.emptyPallets.map((s) => s.weightKg).join(" + ")} kg · dust {fw.dustKg || "-"} kg · voids {fw.voidsKg || "-"} kg
      <span className="text-warmstone-500"> · saved {formatDateTime(fw.finalisedAt)}{fw.finalisedBy ? ` by ${fw.finalisedBy}` : ""}</span>
    </p>
  );
}

/**
 * The tally sheet's totals, laid out as the sum itself (start with gross, take things off, land on a result)
 * so whoever reads it can follow the arithmetic without knowing the sheet's formulas.
 */
function TotalsBox({ t }: { t: WeighingTotals }) {
  const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
  const lines: { sign: "" | "−" | "="; label: string; hint?: string; kg: number }[] = [
    { sign: "", label: "Gross weight", hint: `everything on the scale · ${plural(t.pallets, "pallet")}`, kg: t.grossKg },
    { sign: "−", label: "Empty pallets", kg: t.palletKg },
    { sign: "−", label: "Jute bags", hint: `${plural(t.bags, "bag")} × ${JUTE_BAG_KG} kg`, kg: t.bagsKg },
    { sign: "=", label: "Net weight received", kg: t.netKg },
    { sign: "−", label: "Dust", kg: t.dustKg },
    { sign: "−", label: "Voids", kg: t.voidsKg },
    { sign: "=", label: "Net weight to silos", kg: t.toSilosKg },
  ];
  return (
    <div className="w-full max-w-xl rounded-xl border border-warmstone-200 overflow-hidden text-[13px]">
      {lines.map(({ sign, label, hint, kg }) => {
        const result = sign === "=";
        return (
          <div key={label} className={`flex items-baseline gap-3 px-3 py-2 ${result ? "border-t-2 border-warmstone-300 bg-warmstone-50 font-bold text-warmstone-900" : "border-t border-warmstone-100 first:border-t-0 text-warmstone-800"}`}>
            <span className="w-3 text-center text-warmstone-500">{sign}</span>
            <span className="flex-1">
              {label}
              {hint && <span className="ml-2 text-[12px] font-normal text-warmstone-500">{hint}</span>}
            </span>
            <span className="tabular-nums">{kg2(kg)} kg</span>
          </div>
        );
      })}
    </div>
  );
}
