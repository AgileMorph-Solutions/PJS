import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { dryingLoss } from "@anagroci/contract/domain/dryingLoss";
import { DECISION_BRANCHES } from "@anagroci/contract/domain/decisions";
import { DRYING_PHASE_LABELS, dryingKor, dryingPhase, isOpenRound } from "@anagroci/contract/domain/sunDrying";
import { api, type DryingCutGrams, type DryingQualityPayload, type DryingStartPayload, type LinkedDryingBatchRow } from "../../repository/api";
import type { ReceiptRecord } from "../../types/receipt";
import { formatDate, formatDateTime, todayIso } from "@anagroci/contract/domain/dateFormat";
import { DateInput } from "../ui/DateInput";
import { Pill } from "../ui/Pill";

const inputCls =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-white text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none focus:border-brand-700 focus:ring-1 focus:ring-brand-700";
const btnPrimary = "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold shadow-sm disabled:opacity-50";
const btnSecondary = "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-warmstone-200 bg-white hover:bg-warmstone-50 text-warmstone-800 text-[13px] font-semibold disabled:opacity-50";

const field = (label: string, el: ReactNode, hint?: string) => (
  <label className="block">
    <span className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">{label}</span>
    {el}
    {hint && <span className="block mt-1 text-[11.5px] text-warmstone-500">{hint}</span>}
  </label>
);
const n = (v: number | null | undefined, unit = "") => (v === null || v === undefined ? "-" : `${Number(v).toLocaleString()}${unit}`);
const num = (s: string | undefined) => (s === undefined || s.trim() === "" || Number.isNaN(Number(s.replace(",", "."))) ? null : Number(s.replace(",", ".")));

const PHASE_TONE = { in_drying: "decision", quality_check: "decision", passed: "entry", redry: "gap", other: "system" } as const;
const GRAM_FIELDS: [key: string, label: string][] = [
  ["GoodKernelG", "Good kernel"], ["ImmatureG", "Immature"], ["SpottedG", "Spotted"], ["RejectionG", "Rejection"],
  ["VoidG", "Void"], ["OilG", "Oil"], ["ShellG", "Shell"],
];

/** Moisture, nut count, the cut-test grams and KOR, for the drying sample before or after a round. KOR is calculated from the
 * grams when good kernel, immature and spotted are all there (the same formula as QFS); otherwise it can be typed. */
function QualityInputs({ prefix, values, onChange }: { prefix: "input" | "output"; values: Record<string, string>; onChange: (k: string, v: string) => void }) {
  const when = prefix === "input" ? "before" : "after";
  const k = (s: string) => `${prefix}${s}`;
  const kor = dryingKor({ goodKernelG: num(values[k("GoodKernelG")]), immatureG: num(values[k("ImmatureG")]), spottedG: num(values[k("SpottedG")]), kor: num(values[k("Kor")]) });
  const calculated = num(values[k("GoodKernelG")]) !== null && num(values[k("ImmatureG")]) !== null && num(values[k("SpottedG")]) !== null;
  return (
    <fieldset className="space-y-3">
      <legend className="text-[13px] font-bold text-warmstone-900 mb-2">Quality {when} drying <span className="font-normal text-warmstone-500">(drying sample, measured now)</span></legend>
      <div className="grid sm:grid-cols-3 gap-4">
        {field(`Moisture ${when} (%) *`, <input required inputMode="decimal" value={values[k("Moisture")] ?? ""} onChange={(e) => onChange(k("Moisture"), e.target.value)} className={inputCls} />)}
        {field("Nut count", <input inputMode="numeric" value={values[k("NutCount")] ?? ""} onChange={(e) => onChange(k("NutCount"), e.target.value)} className={inputCls} />)}
        {field("KOR", calculated
          ? <input readOnly value={kor ?? ""} className={`${inputCls} bg-warmstone-100 cursor-default`} />
          : <input inputMode="decimal" value={values[k("Kor")] ?? ""} onChange={(e) => onChange(k("Kor"), e.target.value)} className={inputCls} />,
          calculated ? "Calculated from the cut test" : "Calculated once good kernel, immature and spotted are entered")}
      </div>
      <div>
        <span className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">Cut test (grams of a 1000 g sample)</span>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {GRAM_FIELDS.map(([key, label]) => (
            <label key={key} className="block">
              <span className="block text-[11.5px] text-warmstone-500 mb-1">{label}</span>
              <input inputMode="decimal" value={values[k(key)] ?? ""} onChange={(e) => onChange(k(key), e.target.value)} className={inputCls} />
            </label>
          ))}
        </div>
      </div>
    </fieldset>
  );
}

const gramsLine = (g: DryingCutGrams | null) =>
  g ? `GK ${n(g.goodKernel)} · imm. ${n(g.immature)} · spot. ${n(g.spotted)} · rej. ${n(g.rejection)} · void ${n(g.void)} · oil ${n(g.oil)} · shell ${n(g.shell)} g` : null;

interface Props {
  receipt: ReceiptRecord;
  /** This Lot's drying rows (from the receipt's links), oldest first: in-app sun-drying rounds and imported workbook rows. */
  batches: LinkedDryingBatchRow[];
  /** Known drying types and Bins, offered as suggestions. */
  dryTypes: string[];
  bins: string[];
  canEdit: boolean;
  /** Called after any change, so the page can read the receipt and its links again. */
  onChanged: () => void;
  /** Records the decision "No" (a decision only; nothing else changes). */
  onSayNo: () => void;
}

/**
 * Sun drying (client, Oct 2026): "Does this Lot need drying? Yes / No". Yes issues round 1 with its weight and its quality before
 * drying. When it comes back, the weight returned is recorded, then a quality check (moisture, nut count, cut test) either passes
 * the Lot or sends it back as the next round, starting from what came back. The QFS reception sample is shown for reference only:
 * it stays a separate measurement and is never copied into the drying record.
 */
export function DryingPanel({ receipt, batches, dryTypes, bins, canEdit, onChanged, onSayNo }: Props) {
  const decision = receipt.branches["n-drying"];
  const open = batches.find((b) => isOpenRound(b.status));
  const openPhase = open ? dryingPhase(open.status) : null;
  const latest = batches.at(-1);
  const [mode, setMode] = useState<"idle" | "start" | "return" | "check">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sd = receipt.stageData;
  const qfs = sd["n-qfs"];
  // Weights and bins are offered from the truck's own record; quality is never copied from QFS (it is measured again).
  const defaults = useMemo(() => ({
    issuedNetKg: sd["n-netwt"]?.["NET WT KGS"] ?? "",
    issuedBags: sd["n-unload"]?.["SACS (bags)"] ?? "",
    sourceBin: receipt.binNo ?? "",
  }), [sd, receipt.binNo]);
  const [form, setForm] = useState<Record<string, string>>({ route: "direct", dryType: dryTypes[0] ?? "SUN DRYING", date: todayIso(), ...defaults });
  const [back, setBack] = useState<Record<string, string>>({});
  const [check, setCheck] = useState<Record<string, string>>({ decision: "pass" });

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await action(); setMode("idle"); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const quality = <P extends "input" | "output">(values: Record<string, string>, prefix: P) =>
    Object.fromEntries(Object.entries(values).filter(([k, v]) => k.startsWith(prefix) && v.trim() !== "")) as DryingQualityPayload<P>;

  const returnLoss = open && back.receivedNetKg ? dryingLoss(open.issuedNetWeightKg ?? 0, Number(back.receivedNetKg) || 0, null, null) : null;

  const roundCard = (b: LinkedDryingBatchRow) => {
    const phase = dryingPhase(b.status);
    const rows: [string, ReactNode][] = [
      ["Date", formatDate(b.dryingDate) || "-"], ["Type", b.dryType ?? "-"],
      ["Bins", `${b.sourceBinNo ?? "-"} → ${b.destinationBinNo ?? b.destinationRaw ?? "-"}`],
      ["Issued", `${n(b.issuedNetWeightKg, " kg")}${(b.issuedBags ?? b.inputBags) ? ` · ${n(b.issuedBags ?? b.inputBags)} bags` : ""}`],
      ["Returned", `${n(b.receivedNetWeightKg, " kg")}${(b.receivedBags ?? b.outputBags) ? ` · ${n(b.receivedBags ?? b.outputBags)} bags` : ""}`],
      ["Weight loss", b.dryingLossKg === null ? "-" : `${n(b.dryingLossKg, " kg")}${b.dryingLossPct !== null ? ` (${b.dryingLossPct}%)` : ""}`],
      ["Moisture", `${n(b.inputMoisturePct, "%")} → ${n(b.outputMoisturePct, "%")}`],
      ["KOR", `${n(b.inputKor)} → ${n(b.outputKor)}`],
      ["Nut count", `${n(b.inputNutCount)} → ${n(b.outputNutCount)}`],
    ];
    const people = [b.startedBy && `issued by ${b.startedBy}`, b.returnedBy && `returned ${formatDateTime(b.returnedAt)} by ${b.returnedBy}`, b.checkedBy && `checked ${formatDateTime(b.checkedAt)} by ${b.checkedBy}`].filter(Boolean);
    return (
      <div key={b.id} className="rounded-xl border border-warmstone-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13.5px] font-bold text-warmstone-900">{b.round ? `Round ${b.round}` : `Batch #${b.sn}`}</span>
          <Pill tone={PHASE_TONE[phase]} label={phase === "other" ? (b.status ?? "Recorded") : DRYING_PHASE_LABELS[phase]} />
          {b.source !== "entered" && <span className="text-[11.5px] text-warmstone-500">from the drying workbook</span>}
        </div>
        <dl className="grid sm:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-2 text-[13px]">
          {rows.map(([k, v]) => (
            <div key={k}><dt className="text-warmstone-500 text-[12px]">{k}</dt><dd className="font-semibold text-warmstone-900 tabular-nums">{v}</dd></div>
          ))}
        </dl>
        {(b.inputGrams || b.outputGrams) && (
          <p className="text-[12px] text-warmstone-600 tabular-nums">
            {b.inputGrams && <>Cut test before: {gramsLine(b.inputGrams)}<br /></>}
            {b.outputGrams && <>Cut test after: {gramsLine(b.outputGrams)}</>}
          </p>
        )}
        {people.length > 0 && <p className="text-[11.5px] text-warmstone-500">{people.join(" · ")}</p>}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {qfs && (qfs["MOIS. (moisture)"] || qfs["KOR"] || qfs["FINAL KOR"]) && (
        <p className="text-[12.5px] text-warmstone-600">
          Reception quality (QFS sample, kept separate): moisture <b>{qfs["MOIS. (moisture)"] || "-"}%</b> · KOR <b>{qfs["FINAL KOR"] || qfs["KOR"] || "-"}</b> · nut count <b>{qfs["NUT COUNT"] || "-"}</b>
        </p>
      )}
      {error && <p role="alert" className="text-[13px] font-medium text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{error}</p>}

      {batches.map(roundCard)}

      {canEdit && mode === "idle" && (
        <div className="flex flex-wrap items-center gap-3">
          {openPhase === "in_drying" ? (
            <button type="button" className={btnPrimary} onClick={() => setMode("return")}><span className="material-symbols-outlined text-[17px]">scale</span>Record what came back</button>
          ) : openPhase === "quality_check" ? (
            <button type="button" className={btnPrimary} onClick={() => setMode("check")}><span className="material-symbols-outlined text-[17px]">science</span>Quality check after drying</button>
          ) : decision === "none" ? (
            <>
              <span className="text-[13px] text-warmstone-600">Recorded: no drying needed.</span>
              <button type="button" className={btnSecondary} onClick={() => setMode("start")}>Change to Yes</button>
            </>
          ) : (
            <>
              <span className="text-[13px] font-semibold text-warmstone-800">{latest ? "Dry this Lot again?" : "Does this Lot need sun drying?"}</span>
              <button type="button" className={btnPrimary} onClick={() => setMode("start")}>Yes</button>
              {!latest && <button type="button" className={btnSecondary} onClick={onSayNo}>No</button>}
            </>
          )}
        </div>
      )}
      {!canEdit && !batches.length && <p className="text-[13px] text-warmstone-500">{decision === "none" ? "No drying needed." : "Not decided yet."}</p>}

      {canEdit && mode === "start" && (
        <form
          className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 space-y-5"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            const body: DryingStartPayload = {
              route: form.route as DryingStartPayload["route"], date: form.date, dryType: form.dryType ?? "", sourceBin: form.sourceBin || undefined,
              destinationBin: form.destinationBin || undefined, issuedBags: form.issuedBags, issuedNetKg: form.issuedNetKg ?? "", ...quality(form, "input"),
            };
            void run(() => api.startDrying(receipt.id, body));
          }}
        >
          <h4 className="text-[14px] font-bold text-warmstone-900">Sun drying · round 1</h4>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {field("How does it go to drying?", (
              <select value={form.route} onChange={(e) => setForm((f) => ({ ...f, route: e.target.value }))} className={inputCls}>
                {DECISION_BRANCHES["n-drying"]!.filter((b) => b.id !== "none").map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            ))}
            {field("Drying date", <DateInput value={form.date ?? ""} onChange={(d) => setForm((f) => ({ ...f, date: d }))} className={inputCls} />, "Today unless you change it")}
            {field("Drying type", <><input list="dry-types" required value={form.dryType} onChange={(e) => setForm((f) => ({ ...f, dryType: e.target.value }))} className={inputCls} /><datalist id="dry-types">{dryTypes.map((t) => <option key={t} value={t} />)}</datalist></>)}
            {field("Source bin", (
              <select value={form.sourceBin} onChange={(e) => setForm((f) => ({ ...f, sourceBin: e.target.value }))} className={inputCls}>
                <option value="">-</option>{bins.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            ), "Where the Lot is now")}
            {field("Destination bin", (
              <select value={form.destinationBin ?? ""} onChange={(e) => setForm((f) => ({ ...f, destinationBin: e.target.value }))} className={inputCls}>
                <option value="">Decide later</option>{bins.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            ), "Where the dried stock will go")}
            {field("Bags issued", <input inputMode="numeric" value={form.issuedBags} onChange={(e) => setForm((f) => ({ ...f, issuedBags: e.target.value }))} className={inputCls} />)}
            {field("Weight before drying: net kg issued *", <input required inputMode="decimal" value={form.issuedNetKg} onChange={(e) => setForm((f) => ({ ...f, issuedNetKg: e.target.value }))} className={inputCls} />, defaults.issuedNetKg ? "Filled from the truck's net weight" : undefined)}
          </div>
          <QualityInputs prefix="input" values={form} onChange={(k, v) => setForm((f) => ({ ...f, [k]: v }))} />
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy} className={btnPrimary}>{busy ? "Saving…" : "Start sun drying"}</button>
            <button type="button" className={btnSecondary} onClick={() => { setMode("idle"); setError(null); }}>Cancel</button>
          </div>
        </form>
      )}

      {canEdit && mode === "return" && open && (
        <form
          className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(() => api.returnDrying(open.id, { receivedNetKg: back.receivedNetKg ?? "", receivedBags: back.receivedBags, destinationBin: back.destinationBin || undefined }));
          }}
        >
          <h4 className="text-[14px] font-bold text-warmstone-900">Round {open.round ?? 1} · what came back from the yard</h4>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {field("Weight after drying: net kg returned *", <input required inputMode="decimal" value={back.receivedNetKg ?? ""} onChange={(e) => setBack((d) => ({ ...d, receivedNetKg: e.target.value }))} className={inputCls} />, `${n(open.issuedNetWeightKg, " kg")} were issued`)}
            {field("Bags returned", <input inputMode="numeric" value={back.receivedBags ?? ""} onChange={(e) => setBack((d) => ({ ...d, receivedBags: e.target.value }))} className={inputCls} />)}
            {field("Destination bin", (
              <select value={back.destinationBin ?? ""} onChange={(e) => setBack((d) => ({ ...d, destinationBin: e.target.value }))} className={inputCls}>
                <option value="">{open.destinationBinNo ?? "-"}</option>{bins.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            ), "Where the dried stock goes")}
          </div>
          {returnLoss && (
            <p className="text-[13px] text-warmstone-700">
              Worked out for you: <b className="tabular-nums">{n(returnLoss.lossKg, " kg")}</b> lost{returnLoss.lossPct !== null ? <> (<b>{returnLoss.lossPct}%</b>)</> : null}. The quality check comes next.
            </p>
          )}
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy} className={btnPrimary}>{busy ? "Saving…" : "Save what came back"}</button>
            <button type="button" className={btnSecondary} onClick={() => { setMode("idle"); setError(null); }}>Cancel</button>
          </div>
        </form>
      )}

      {canEdit && mode === "check" && open && (
        <form
          className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 space-y-5"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(() => api.checkDrying(open.id, { decision: check.decision as "pass" | "redry", ...quality(check, "output") }));
          }}
        >
          <h4 className="text-[14px] font-bold text-warmstone-900">Round {open.round ?? 1} · quality check after drying</h4>
          <p className="text-[12.5px] text-warmstone-600">Before this round: moisture <b>{n(open.inputMoisturePct, "%")}</b> · KOR <b>{n(open.inputKor)}</b> · nut count <b>{n(open.inputNutCount)}</b></p>
          <QualityInputs prefix="output" values={check} onChange={(k, v) => setCheck((c) => ({ ...c, [k]: v }))} />
          <fieldset>
            <legend className="text-[13px] font-bold text-warmstone-900 mb-2">Result</legend>
            <div className="flex flex-wrap gap-4 text-[13px]">
              <label className="flex items-center gap-2"><input type="radio" name="decision" checked={check.decision === "pass"} onChange={() => setCheck((c) => ({ ...c, decision: "pass" }))} />Passed: dry enough</label>
              <label className="flex items-center gap-2"><input type="radio" name="decision" checked={check.decision === "redry"} onChange={() => setCheck((c) => ({ ...c, decision: "redry" }))} />Dry it again: starts round {(open.round ?? 1) + 1} with what came back</label>
            </div>
          </fieldset>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy} className={btnPrimary}>{busy ? "Saving…" : check.decision === "redry" ? "Save and re-dry" : "Save: passed"}</button>
            <button type="button" className={btnSecondary} onClick={() => { setMode("idle"); setError(null); }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
