import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { dryingLoss } from "@anagroci/contract/domain/dryingLoss";
import { averageKgPerBag, binDryingProblem, canSendDryingToProduction, estimatedIssuedKg, DRYING_PHASE_LABELS, DRYING_YARD, dryingFieldProblem, dryingPhase, isOpenRound, truckDryingBlocker } from "@anagroci/contract/domain/sunDrying";
import { siteTypeOf } from "@anagroci/contract/domain/siteType";
import { useTracking } from "../../state/TrackingContext";
import { Link } from "react-router-dom";
import { useSite } from "../../state/SiteContext";
import { api, type DryingCutGrams, type DryingQualityPayload, type LinkedDryingBatchRow } from "../../repository/api";
import type { ReceiptRecord } from "../../types/receipt";
import { formatDate, formatDateTime, todayIso } from "@anagroci/contract/domain/dateFormat";
import { DateInput } from "../ui/DateInput";
import { Pill } from "../ui/Pill";
import { Button } from "../ui/Button";
import { Field, Input, inputClass } from "../ui/Input";
import { SearchSelect } from "../ui/SearchSelect";
import { DryingQualityInputs } from "../quality/DryingQualityInputs";
import { hasHardProblem, qualityKeys } from "../quality/dryingQuality";

const n = (v: number | null | undefined, unit = "") => (v === null || v === undefined ? "-" : `${Number(v).toLocaleString()}${unit}`);
const num = (s: string | undefined) => (s === undefined || s.trim() === "" || Number.isNaN(Number(s.replace(",", "."))) ? null : Number(s.replace(",", ".")));

const PHASE_TONE = { in_drying: "decision", quality_check: "decision", passed: "entry", redry: "gap", to_production: "entry", other: "system" } as const;
const gramsLine = (g: DryingCutGrams | null) =>
  g ? `GK ${n(g.goodKernel)} · imm. ${n(g.immature)} · spot. ${n(g.spotted)} · rej. ${n(g.rejection)} · void ${n(g.void)} · oil ${n(g.oil)} · shell ${n(g.shell)} g` : null;

/**
 * What is being dried. A truck unloaded straight onto the drying yard (its own drying, on its reception record), or a Bin
 * (Sameer, 18 Nov 2026: from a Bin to the yard, then re-bagged into a new Bin — on the Bin's Warehouse activities page).
 */
export type DryingScope =
  // A truck is asked Yes or No (26 Nov 2026, after a Yes-only spell from 25 Nov): No is kept, and can be changed to Yes.
  | { kind: "truck"; receipt: ReceiptRecord }
  // A Bin is asked "Does this Bin need drying?" Yes or No (25 Nov 2026): `decision` is the answer kept, `onAnswer` gives one.
  // `kgPerBag`: the average bag of the Bin's Lots (contract averageKgPerBag), for estimating the weight from the bags issued.
  | { kind: "bin"; binCode: string; warehouse: string; binKg: number; kgPerBag: number | null; decision: "yes" | "no" | null; onAnswer: (answer: "yes" | "no") => Promise<void> };

interface Props {
  scope: DryingScope;
  /** The rounds, oldest first: in-app sun-drying rounds, and for a truck its imported workbook rows. */
  batches: LinkedDryingBatchRow[];
  /** Known drying types and Bins, offered as suggestions. */
  dryTypes: string[];
  bins: string[];
  canEdit: boolean;
  /** Told when a Bin dropdown opens, so the page reads the Bins master again (a Bin just added in Masters shows up). */
  onBinsOpen?: () => void;
  /** Called after any change, so the page can read its records again. */
  onChanged: () => void;
}

/**
 * Sun drying, in rounds (client, Oct 2026). Issuing round 1 records its weight and quality before drying. When it comes back,
 * the weight returned is recorded, then a quality check (moisture, nut count, cut test) either passes it into a new Bin, sends it
 * back as the next round starting from what came back, or — the exception — sends it straight to production with no new Bin.
 * For a truck, the QFS reception sample is shown for reference only: it stays a separate measurement and is never copied.
 */
export function DryingPanel({ scope, batches, dryTypes, bins, canEdit, onBinsOpen, onChanged }: Props) {
  const truck = scope.kind === "truck" ? scope.receipt : null;
  const source = scope.kind === "bin" ? scope.binCode : DRYING_YARD;
  const decision = truck?.branches["n-drying"];
  const open = batches.find((b) => isOpenRound(b.status));
  const openPhase = open ? dryingPhase(open.status) : null;
  const latest = batches.at(-1);
  const [mode, setMode] = useState<"idle" | "start" | "return" | "check">("idle");
  const site = useSite();
  const { masters } = useTracking();
  // Straight to production is a Central warehouse's (contract canSendDryingToProduction): a Unit's RCN goes on to Central first.
  const toProduction = canSendDryingToProduction(siteTypeOf(masters.warehouses, masters.aliases, truck?.warehouse ?? site.warehouseName));
  // The two ways to dry are exclusive (contract truckDryingBlocker): a truck already in a Bin is dried from that Bin's page,
  // with the Bin's other Lots; RCN sent straight to production has nothing left to dry. A Bin holding nothing can't give any.
  const truckBin = truck ? (truck.stageData["n-bin"]?.["Bin Number"] || truck.binNo || "").trim() : "";
  const blocked = truck && !open ? truckDryingBlocker(truckBin, batches) : undefined;
  const emptyBin = scope.kind === "bin" && !open && scope.binKg <= 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sd = truck?.stageData;
  const qfs = sd?.["n-qfs"];
  // A truck starts from its own weights; a Bin from what it holds. Quality is never copied from QFS (it is measured again).
  // A Bin starts empty (26 Nov 2026, user): its whole stock was offered as the weight, which is rarely what goes; the weight
  // fills itself from the bags issued instead.
  const defaults = useMemo(() => (truck
    ? { issuedNetKg: sd?.["n-netwt"]?.["NET WT KGS"] ?? "", issuedBags: sd?.["n-unload"]?.["SACS (bags)"] ?? "" }
    : { issuedNetKg: "", issuedBags: "" }), [truck, sd]);
  const [form, setForm] = useState<Record<string, string>>({ dryType: dryTypes[0] ?? "SUN DRYING", date: todayIso(), ...defaults });
  // Weight before drying follows the bags issued (26 Nov 2026, user): bags × the RCN's average kg a bag, until the person types
  // a weight of their own, which then stays.
  const kgPerBag = useMemo(() => (truck
    ? averageKgPerBag([{ netKg: num(sd?.["n-netwt"]?.["NET WT KGS"]), bags: num(sd?.["n-unload"]?.["SACS (bags)"]) }])
    : scope.kind === "bin" ? scope.kgPerBag : null), [truck, sd, scope]);
  const [weightTyped, setWeightTyped] = useState(false);
  const estimate = estimatedIssuedKg(form.issuedBags, kgPerBag);
  const setBagsIssued = (bags: string) => setForm((f) => ({
    ...f, issuedBags: bags, ...(weightTyped ? {} : { issuedNetKg: estimatedIssuedKg(bags, kgPerBag) ?? defaults.issuedNetKg }),
  }));
  const weightHint = !weightTyped && estimate
    ? `Estimated: ${n(num(form.issuedBags))} bags × ${n(Math.round(kgPerBag! * 10) / 10)} kg a bag (${truck ? "this truck's" : "this Bin's Lots'"} average). Change it to the weighed figure.`
    : defaults.issuedNetKg && !weightTyped && form.issuedNetKg === defaults.issuedNetKg ? "Filled from the truck's net weight"
    : weightTyped ? undefined
    : kgPerBag ? "Fills itself when you enter the bags issued." : "Type it: no bag weight is recorded to estimate it from the bags.";
  const [back, setBack] = useState<Record<string, string>>({});
  const [check, setCheck] = useState<Record<string, string>>({ decision: "pass" });
  // Out of a Bin, the dried RCN goes into a NEW Bin: the source Bin isn't offered. `bins` is the warehouse's own Bins only
  // (binsAtSite): picked from the searchable dropdown every master list uses (26 Nov 2026, user).
  const newBins = scope.kind === "bin" ? bins.filter((b) => b !== scope.binCode) : bins;
  const pickerId = `drying-${scope.kind === "bin" ? scope.binCode : scope.receipt.id}`;
  const sameBin = (to: string | undefined) => (scope.kind === "bin" ? binDryingProblem(scope.binCode, to) : null);

  /** Saves, then tells the page to read its records again. Says whether it was saved, so what follows a save waits for it. */
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true); setError(null);
    try { await action(); setMode("idle"); onChanged(); return true; } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; } finally { setBusy(false); }
  }
  const quality = <P extends "input" | "output">(values: Record<string, string>, prefix: P) =>
    Object.fromEntries(Object.entries(values).filter(([k, v]) => k.startsWith(prefix) && v.trim() !== "")) as DryingQualityPayload<P>;

  const returnLoss = open && back.receivedNetKg ? dryingLoss(open.issuedNetWeightKg ?? 0, Number(back.receivedNetKg) || 0, null, null) : null;
  // Passing needs the new Bin: chosen with what came back, or here.
  const passBin = check.destinationBin || open?.destinationBinNo || "";
  const passProblem = check.decision === "pass" && scope.kind === "bin" ? (passBin ? sameBin(passBin) : "Choose the new Bin the dried RCN goes into.") : null;

  const roundCard = (b: LinkedDryingBatchRow) => {
    const phase = dryingPhase(b.status);
    const rows: [string, ReactNode][] = [
      ["Date", formatDate(b.dryingDate) || "-"], ["Type", b.dryType ?? "-"],
      ["Bins", `${b.sourceBinNo ?? (truck ? DRYING_YARD : "-")} → ${phase === "to_production" ? "production" : (b.destinationBinNo ?? b.destinationRaw ?? "-")}`],
      ["Issued", `${n(b.issuedNetWeightKg, " kg")}${(b.issuedBags ?? b.inputBags) ? ` · ${n(b.issuedBags ?? b.inputBags)} bags` : ""}`],
      ["Returned", `${n(b.receivedNetWeightKg, " kg")}${(b.receivedBags ?? b.outputBags) ? ` · ${n(b.receivedBags ?? b.outputBags)} bags` : ""}`],
      ["Weight loss", b.dryingLossKg === null ? "-" : `${n(b.dryingLossKg, " kg")}${b.dryingLossPct !== null ? ` (${b.dryingLossPct}%)` : ""}`],
      ["Moisture", `${n(b.inputMoisturePct, "%")} → ${n(b.outputMoisturePct, "%")}`],
      ["KOR", `${n(b.inputKor)} → ${n(b.outputKor)}`],
      ["Nut count", `${n(b.inputNutCount)} → ${n(b.outputNutCount)}`],
      ...(phase === "to_production" ? [["BTM", b.btmNo ?? "-"] as [string, ReactNode]] : []),
    ];
    const people = [b.startedBy && `issued by ${b.startedBy}`, b.returnedBy && `returned ${formatDateTime(b.returnedAt)} by ${b.returnedBy}`, b.checkedBy && `checked ${formatDateTime(b.checkedAt)} by ${b.checkedBy}`].filter(Boolean);
    return (
      <div key={b.id} className="rounded-xl border border-warmstone-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-bold text-warmstone-900">{b.round ? `Round ${b.round}` : `Batch #${b.sn}`}</span>
          <Pill tone={PHASE_TONE[phase]} label={phase === "other" ? (b.status ?? "Recorded") : DRYING_PHASE_LABELS[phase]} />
          {b.source !== "entered" && <span className="text-[11px] text-warmstone-500">from the drying workbook</span>}
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
        {people.length > 0 && <p className="text-[11px] text-warmstone-500">{people.join(" · ")}</p>}
      </div>
    );
  };

  const startLabel = scope.kind === "bin" ? "Dry RCN from this Bin" : latest ? "Dry this truck again?" : "Was this truck unloaded straight onto the drying yard?";
  // A Bin's answer: Yes leads into drying; No is kept until changed. A Bin that has been dried already needs no answer.
  const binAnswer = scope.kind === "bin" ? scope.decision : null;
  const answer = (a: "yes" | "no", then?: () => void) => {
    if (scope.kind !== "bin") return;
    void run(() => scope.onAnswer(a)).then((saved) => { if (saved) then?.(); });
  };

  return (
    <div className="space-y-4">
      {qfs && (qfs["Final moisture (%)"] || qfs["KOR"] || qfs["FINAL KOR"]) && (
        <p className="text-[12px] text-warmstone-600">
          Reception quality (QFS sample, kept separate): moisture <b>{qfs["Final moisture (%)"] || "-"}%</b> · KOR <b>{qfs["FINAL KOR"] || qfs["KOR"] || "-"}</b> · nut count <b>{qfs["Final nut count"] || "-"}</b>
        </p>
      )}
      {error && <p role="alert" className="text-[13px] font-medium text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{error}</p>}

      {batches.map(roundCard)}

      {canEdit && mode === "idle" && (
        <div className="flex flex-wrap items-center gap-3">
          {openPhase === "in_drying" ? (
            <Button icon="scale" onClick={() => setMode("return")}>Record what came back</Button>
          ) : openPhase === "quality_check" ? (
            <Button icon="science" onClick={() => setMode("check")}>Quality check after drying</Button>
          ) : blocked ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warmstone-200 bg-warmstone-100 px-3 py-2">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-warmstone-500">info</span>
              <span className="flex-1 min-w-[16rem] text-[13px] text-warmstone-800">{blocked}</span>
              {truckBin && (
                <Link to={`/${site.slug}/warehouse-activities/${encodeURIComponent(truckBin)}`} className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:text-brand-800">
                  Open Bin {truckBin}
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">arrow_forward</span>
                </Link>
              )}
            </div>
          ) : emptyBin ? (
            <span className="text-[13px] text-warmstone-600">This Bin holds no RCN right now, so there is nothing to dry from it.</span>
          ) : truck && decision === "none" ? (
            <>
              <span className="text-[13px] text-warmstone-600">Recorded: not dried on the yard.</span>
              <Button variant="secondary" onClick={() => setMode("start")}>Change to Yes</Button>
            </>
          ) : scope.kind === "bin" && !latest && binAnswer === null ? (
            <>
              <span className="text-[13px] font-semibold text-warmstone-800">Does this Bin need drying?</span>
              <Button disabled={busy} onClick={() => answer("yes", () => setMode("start"))}>Yes</Button>
              <Button variant="secondary" disabled={busy} onClick={() => answer("no")}>No</Button>
            </>
          ) : scope.kind === "bin" && !latest && binAnswer === "no" ? (
            <>
              <span className="text-[13px] text-warmstone-600">Recorded: no drying needed.</span>
              <Button variant="secondary" disabled={busy} onClick={() => answer("yes", () => setMode("start"))}>Change to Yes</Button>
            </>
          ) : scope.kind === "bin" ? (
            <>
              <Button icon="wb_sunny" onClick={() => setMode("start")}>{startLabel}</Button>
              {!latest && <Button variant="secondary" disabled={busy} onClick={() => answer("no")}>No drying needed</Button>}
            </>
          ) : (
            <>
              <span className="text-[13px] font-semibold text-warmstone-800">{startLabel}</span>
              <Button onClick={() => setMode("start")}>Yes</Button>
              {/* 26 Nov 2026 (user): No again, kept as "not dried on the yard" and changeable to Yes. A truck dried before needs no answer. */}
              {truck && !latest && <Button variant="secondary" disabled={busy} onClick={() => void run(() => api.setBranch(truck.id, "n-drying", "none"))}>No</Button>}
            </>
          )}
        </div>
      )}
      {!canEdit && !batches.length && <p className="text-[13px] text-warmstone-500">{decision === "none" ? "Not dried on the yard." : "No drying recorded."}</p>}

      {canEdit && mode === "start" && (
        <form
          className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 space-y-5"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            const common = {
              date: form.date, dryType: form.dryType ?? "",
              issuedBags: form.issuedBags, issuedNetKg: form.issuedNetKg ?? "", ...quality(form, "input"),
            };
            void run(() => scope.kind === "bin"
              ? api.startBinDrying(scope.binCode, scope.warehouse, common)
              : api.startDrying(scope.receipt.id, { route: "direct", ...common }));
          }}
        >
          <h4 className="text-[13px] font-bold text-warmstone-900">Sun drying · round 1</h4>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label="Taken from" hint={scope.kind === "bin" ? "Drying starts from this Bin" : "Unloaded straight off the truck: no Bin yet"}>
              <input readOnly value={source} className={`${inputClass} bg-warmstone-100 cursor-default`} />
            </Field>
            <Field label="Drying date" hint="Today unless you change it. It can't be in the future."><DateInput value={form.date ?? ""} max={todayIso()} onChange={(d) => setForm((f) => ({ ...f, date: d }))} className={inputClass} /></Field>
            <Field label="Drying type">
              <><input list="dry-types" required value={form.dryType} onChange={(e) => setForm((f) => ({ ...f, dryType: e.target.value }))} className={inputClass} /><datalist id="dry-types">{dryTypes.map((t) => <option key={t} value={t} />)}</datalist></>
            </Field>
            {/* Bags issued, then the weight estimated from them (26 Nov 2026, user). The new Bin is chosen after drying, not here:
                that is when the warehouse decides where the dried RCN goes (26 Nov 2026, user). */}
            <Field label="Bags issued" problem={dryingFieldProblem("issuedBags", form.issuedBags)}><Input numeric inputMode="numeric" value={form.issuedBags} onChange={(e) => setBagsIssued(e.target.value)} /></Field>
            <Field label="Weight before drying: net kg issued *" hint={weightHint} problem={dryingFieldProblem("issuedNetKg", form.issuedNetKg)}>
              <Input numeric required value={form.issuedNetKg} onChange={(e) => { setWeightTyped(e.target.value.trim() !== ""); setForm((f) => ({ ...f, issuedNetKg: e.target.value })); }} />
            </Field>
          </div>
          <DryingQualityInputs prefix="input" optional values={form} onChange={(k, v) => setForm((f) => ({ ...f, [k]: v }))} />
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={() => { setMode("idle"); setError(null); }}>Cancel</Button>
            <Button type="submit" disabled={busy || hasHardProblem(form, ["issuedNetKg", "issuedBags"]) || hasHardProblem(form, qualityKeys("input"), "input")}>{busy ? "Saving…" : "Start sun drying"}</Button>
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
          <h4 className="text-[13px] font-bold text-warmstone-900">Round {open.round ?? 1} · what came back from the yard</h4>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label="Weight after drying: net kg returned *" hint={`${n(open.issuedNetWeightKg, " kg")} were issued`} problem={dryingFieldProblem("receivedNetKg", back.receivedNetKg)}>
              <Input numeric required value={back.receivedNetKg ?? ""} onChange={(e) => setBack((d) => ({ ...d, receivedNetKg: e.target.value }))} />
            </Field>
            <Field label="Bags returned" problem={dryingFieldProblem("receivedBags", back.receivedBags)}><Input numeric inputMode="numeric" value={back.receivedBags ?? ""} onChange={(e) => setBack((d) => ({ ...d, receivedBags: e.target.value }))} /></Field>
            <Field label="New Bin" hint={toProduction ? "Where the dried RCN goes. Leave it if it is going straight to production." : "Where the dried RCN goes. You can decide at the quality check."}>
              <SearchSelect id={`${pickerId}-return-bin`} value={back.destinationBin ?? ""} options={newBins} placeholder={open.destinationBinNo ?? "Decide at the quality check"} onOpen={onBinsOpen}
                onChange={(b) => setBack((d) => ({ ...d, destinationBin: b }))} />
            </Field>
          </div>
          {returnLoss && (
            <p className="text-[13px] text-warmstone-700">
              Worked out for you: <b className="tabular-nums">{n(returnLoss.lossKg, " kg")}</b> lost{returnLoss.lossPct !== null ? <> (<b>{returnLoss.lossPct}%</b>)</> : null}. The quality check comes next.
            </p>
          )}
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={() => { setMode("idle"); setError(null); }}>Cancel</Button>
            <Button type="submit" disabled={busy || hasHardProblem(back, ["receivedNetKg", "receivedBags"])}>{busy ? "Saving…" : "Save what came back"}</Button>
          </div>
        </form>
      )}

      {canEdit && mode === "check" && open && (
        <form
          className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 space-y-5"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            const decision = check.decision as "pass" | "redry" | "production";
            void run(() => api.checkDrying(open.id, {
              decision,
              ...(decision === "pass" && check.destinationBin ? { destinationBin: check.destinationBin } : {}),
              ...(decision === "production" && check.btmNo?.trim() ? { btmNo: check.btmNo.trim() } : {}),
              ...quality(check, "output"),
            }));
          }}
        >
          <h4 className="text-[13px] font-bold text-warmstone-900">Round {open.round ?? 1} · quality check after drying</h4>
          <p className="text-[12px] text-warmstone-600">Before this round: moisture <b>{n(open.inputMoisturePct, "%")}</b> · KOR <b>{n(open.inputKor)}</b> · nut count <b>{n(open.inputNutCount)}</b></p>
          <DryingQualityInputs prefix="output" values={check} onChange={(k, v) => setCheck((c) => ({ ...c, [k]: v }))} />
          <fieldset>
            <legend className="text-[13px] font-bold text-warmstone-900 mb-2">Result</legend>
            <div className="flex flex-col gap-2 text-[13px]">
              <label className="flex items-center gap-2"><input type="radio" name="decision" checked={check.decision === "pass"} onChange={() => setCheck((c) => ({ ...c, decision: "pass" }))} />Passed: dry enough, re-bagged into a new Bin</label>
              <label className="flex items-center gap-2"><input type="radio" name="decision" checked={check.decision === "redry"} onChange={() => setCheck((c) => ({ ...c, decision: "redry" }))} />Dry it again: starts round {(open.round ?? 1) + 1} with what came back</label>
              {toProduction && <label className="flex items-center gap-2"><input type="radio" name="decision" checked={check.decision === "production"} onChange={() => setCheck((c) => ({ ...c, decision: "production" }))} />Sent straight to production: its KOR suits what production planned, so no new Bin</label>}
            </div>
          </fieldset>
          {check.decision === "pass" && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field label={scope.kind === "bin" ? "New Bin *" : "New Bin"} hint={open.destinationBinNo ? `Chosen with what came back: ${open.destinationBinNo}` : "Where the dried RCN is stored now."}>
                <SearchSelect id={`${pickerId}-check-bin`} value={check.destinationBin ?? ""} options={newBins} placeholder={open.destinationBinNo ?? "Choose the new Bin…"} onOpen={onBinsOpen}
                  onChange={(b) => setCheck((c) => ({ ...c, destinationBin: b }))} />
              </Field>
            </div>
          )}
          {check.decision === "production" && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field label="BTM number" hint="The BTM it went to production on, if you have it. You can leave it blank.">
                <Input value={check.btmNo ?? ""} onChange={(e) => setCheck((c) => ({ ...c, btmNo: e.target.value }))} placeholder="BTM-…" />
              </Field>
            </div>
          )}
          {passProblem && <p role="status" className="text-[12px] text-ambernut-800">{passProblem}</p>}
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={() => { setMode("idle"); setError(null); }}>Cancel</Button>
            <Button type="submit" disabled={busy || Boolean(passProblem) || hasHardProblem(check, qualityKeys("output"), "output") || (check.decision === "production" && !toProduction)}>
              {busy ? "Saving…" : check.decision === "redry" ? "Save and re-dry" : check.decision === "production" ? "Save: sent to production" : "Save: passed"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
