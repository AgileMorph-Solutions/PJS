import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { dryingLoss } from "@anagroci/contract/domain/dryingLoss";
import { DECISION_BRANCHES } from "@anagroci/contract/domain/decisions";
import { api, type DryingStartPayload, type LinkedDryingBatchRow } from "../../repository/api";
import type { ReceiptRecord } from "../../types/receipt";
import { formatDate, todayIso } from "@anagroci/contract/domain/dateFormat";
import { DateInput } from "../ui/DateInput";

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

interface Props {
  receipt: ReceiptRecord;
  /** This Lot's drying batches (from the receipt's links), newest last. */
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
 * The drying decision as the team asked for it: "Does this Lot need drying? Yes / No". No is just recorded. Yes opens the drying
 * form (what is issued, its moisture before); when the dried Lot comes back, "Complete drying" takes what returned and the
 * app works out the loss. Net kg, bags, moisture and KOR are offered from the truck's own record so nothing is typed twice.
 */
export function DryingPanel({ receipt, batches, dryTypes, bins, canEdit, onChanged, onSayNo }: Props) {
  const decision = receipt.branches["n-drying"];
  const open = batches.find((b) => /progress/i.test(b.status ?? ""));
  const latest = batches.at(-1);
  const [mode, setMode] = useState<"idle" | "start" | "complete">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sd = receipt.stageData;
  // What the truck already says, offered as the starting values.
  const defaults = useMemo(() => ({
    issuedNetKg: sd["n-netwt"]?.["NET WT KGS"] ?? "",
    issuedBags: sd["n-unload"]?.["SACS (bags)"] ?? "",
    inputMoisture: sd["n-qfs"]?.["MOIS. (moisture)"] ?? "",
    inputKor: sd["n-qfs"]?.["FINAL KOR"] || sd["n-qfs"]?.["KOR"] || "",
    sourceBin: receipt.binNo ?? "",
  }), [sd, receipt.binNo]);
  const [form, setForm] = useState<Record<string, string>>({ route: "direct", dryType: dryTypes[0] ?? "SUN DRYING", date: todayIso(), ...defaults });
  const [done, setDone] = useState<Record<string, string>>({ destinationBin: "" });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await action(); setMode("idle"); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const loss = open
    ? dryingLoss(open.issuedNetWeightKg ?? 0, Number(done.receivedNetKg) || 0, open.inputMoisturePct, done.outputMoisture === "" || done.outputMoisture === undefined ? null : Number(done.outputMoisture))
    : null;
  const showLoss = Boolean(open && done.receivedNetKg && done.outputMoisture !== "" && done.outputMoisture !== undefined);

  const summary = (b: LinkedDryingBatchRow) => (
    <dl className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2 text-[13px]">
      {[
        ["Batch", `#${b.sn} · ${b.status ?? "-"}`], ["Type", b.dryType ?? "-"], ["Date", formatDate(b.dryingDate) || "-"],
        ["Bins", `${b.sourceBinNo ?? "-"} → ${b.destinationBinNo ?? b.destinationRaw ?? "-"}`],
        ["Issued", `${n(b.issuedNetWeightKg, " kg")}${b.inputBags ? ` · ${n(b.inputBags)} bags` : ""}`],
        ["Returned", `${n(b.receivedNetWeightKg, " kg")}${b.outputBags ? ` · ${n(b.outputBags)} bags` : ""}`],
        ["Moisture", `${n(b.inputMoisturePct, "%")} → ${n(b.outputMoisturePct, "%")}`], ["Loss", b.dryingLossKg === null ? "-" : `${n(b.dryingLossKg, " kg")}`],
      ].map(([k, v]) => (
        <div key={k}><dt className="text-warmstone-500 text-[12px]">{k}</dt><dd className="font-semibold text-warmstone-900 tabular-nums">{v}</dd></div>
      ))}
    </dl>
  );

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-[13px] font-medium text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{error}</p>}

      {batches.map((b) => <div key={b.id} className="rounded-xl border border-warmstone-200 bg-white p-4">{summary(b)}</div>)}

      {canEdit && mode === "idle" && (
        <div className="flex flex-wrap items-center gap-3">
          {open ? (
            <button type="button" className={btnPrimary} onClick={() => setMode("complete")}><span className="material-symbols-outlined text-[17px]">task_alt</span>Complete drying</button>
          ) : decision === "none" ? (
            <>
              <span className="text-[13px] text-warmstone-600">Recorded: no drying needed.</span>
              <button type="button" className={btnSecondary} onClick={() => setMode("start")}>Change to Yes</button>
            </>
          ) : (
            <>
              <span className="text-[13px] font-semibold text-warmstone-800">{latest ? "Dry this Lot again?" : "Does this Lot need drying?"}</span>
              <button type="button" className={btnPrimary} onClick={() => setMode("start")}>Yes</button>
              {!latest && <button type="button" className={btnSecondary} onClick={onSayNo}>No</button>}
            </>
          )}
        </div>
      )}
      {!canEdit && !batches.length && <p className="text-[13px] text-warmstone-500">{decision === "none" ? "No drying needed." : "Not decided yet."}</p>}

      {canEdit && mode === "start" && (
        <form
          className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(() => api.startDrying(receipt.id, {
              route: form.route as DryingStartPayload["route"], date: form.date, dryType: form.dryType, sourceBin: form.sourceBin || undefined,
              destinationBin: form.destinationBin || undefined, issuedBags: form.issuedBags, issuedNetKg: form.issuedNetKg,
              inputMoisture: form.inputMoisture, inputKor: form.inputKor || undefined, inputNutCount: form.inputNutCount || undefined,
            }));
          }}
        >
          <h4 className="text-[14px] font-bold text-warmstone-900">Drying details</h4>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {field("How does it go to drying?", (
              <select value={form.route} onChange={(e) => set("route", e.target.value)} className={inputCls}>
                {DECISION_BRANCHES["n-drying"]!.filter((b) => b.id !== "none").map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            ))}
            {field("Drying date", <DateInput value={form.date} onChange={(d) => set("date", d)} className={inputCls} />, "Today unless you change it")}
            {field("Drying type", <><input list="dry-types" required value={form.dryType} onChange={(e) => set("dryType", e.target.value)} className={inputCls} /><datalist id="dry-types">{dryTypes.map((t) => <option key={t} value={t} />)}</datalist></>)}
            {field("Source bin", (
              <select value={form.sourceBin} onChange={(e) => set("sourceBin", e.target.value)} className={inputCls}>
                <option value="">-</option>{bins.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            ), "Where the Lot is now")}
            {field("Destination bin", (
              <select value={form.destinationBin ?? ""} onChange={(e) => set("destinationBin", e.target.value)} className={inputCls}>
                <option value="">Decide later</option>{bins.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            ), "Where the dried stock will go")}
            {field("Bags issued", <input inputMode="numeric" value={form.issuedBags} onChange={(e) => set("issuedBags", e.target.value)} className={inputCls} />)}
            {field("Net kg issued for drying *", <input required inputMode="decimal" value={form.issuedNetKg} onChange={(e) => set("issuedNetKg", e.target.value)} className={inputCls} />, defaults.issuedNetKg ? "Filled from the truck's net weight" : undefined)}
            {field("Moisture before (%) *", <input required inputMode="decimal" value={form.inputMoisture} onChange={(e) => set("inputMoisture", e.target.value)} className={inputCls} />, defaults.inputMoisture ? "Filled from the quality check" : undefined)}
            {field("KOR before", <input inputMode="decimal" value={form.inputKor} onChange={(e) => set("inputKor", e.target.value)} className={inputCls} />)}
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy} className={btnPrimary}>{busy ? "Saving…" : "Start drying"}</button>
            <button type="button" className={btnSecondary} onClick={() => { setMode("idle"); setError(null); }}>Cancel</button>
          </div>
        </form>
      )}

      {canEdit && mode === "complete" && open && (
        <form
          className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(() => api.completeDrying(open.id, {
              receivedNetKg: done.receivedNetKg ?? "", receivedBags: done.receivedBags, outputMoisture: done.outputMoisture ?? "",
              outputKor: done.outputKor || undefined, destinationBin: done.destinationBin || undefined,
            }));
          }}
        >
          <h4 className="text-[14px] font-bold text-warmstone-900">What came back from drying</h4>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {field("Dried net kg returned *", <input required inputMode="decimal" value={done.receivedNetKg ?? ""} onChange={(e) => setDone((d) => ({ ...d, receivedNetKg: e.target.value }))} className={inputCls} />, `${n(open.issuedNetWeightKg, " kg")} were issued`)}
            {field("Bags returned", <input inputMode="numeric" value={done.receivedBags ?? ""} onChange={(e) => setDone((d) => ({ ...d, receivedBags: e.target.value }))} className={inputCls} />)}
            {field("Moisture after (%) *", <input required inputMode="decimal" value={done.outputMoisture ?? ""} onChange={(e) => setDone((d) => ({ ...d, outputMoisture: e.target.value }))} className={inputCls} />)}
            {field("KOR after", <input inputMode="decimal" value={done.outputKor ?? ""} onChange={(e) => setDone((d) => ({ ...d, outputKor: e.target.value }))} className={inputCls} />)}
            {field("Destination bin", (
              <select value={done.destinationBin ?? ""} onChange={(e) => setDone((d) => ({ ...d, destinationBin: e.target.value }))} className={inputCls}>
                <option value="">{open.destinationBinNo ?? "-"}</option>{bins.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            ), "Where the dried stock goes")}
          </div>
          {showLoss && loss && (
            <p className="text-[13px] text-warmstone-700">
              Worked out for you: <b className="tabular-nums">{n(loss.lossKg, " kg")}</b> lost{loss.lossPct !== null ? <> (<b>{loss.lossPct}%</b>)</> : null}
              {loss.moistureLossPct !== null ? <>, moisture down <b>{loss.moistureLossPct}</b> points</> : null}.
            </p>
          )}
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy} className={btnPrimary}>{busy ? "Saving…" : "Complete drying"}</button>
            <button type="button" className={btnSecondary} onClick={() => { setMode("idle"); setError(null); }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
