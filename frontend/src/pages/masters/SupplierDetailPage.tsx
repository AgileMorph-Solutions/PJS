import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  PROFILE_FIELDS, PROFILE_SECTIONS, SUPPLIER_STATUS_LABELS, missingRequired,
  type ProfileField, type SupplierProfileValues, type SupplierStatus,
} from "@anagroci/contract/domain/supplierProfile";
import { PageHeader } from "../../components/ui/PageHeader";
import { KpiTile } from "../../components/ui/KpiTile";
import { InfoCard, InfoRow } from "../../components/ui/InfoCard";
import { Pill } from "../../components/ui/Pill";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { useTracking } from "../../state/TrackingContext";
import { api, type SupplierInput } from "../../repository/api";
import type { SupplierDetail } from "../../types/receipt";

const inputCls =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";
const btnPrimary = "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold shadow-sm disabled:opacity-50";
const btnSecondary = "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-warmstone-200 bg-white hover:bg-warmstone-50 text-warmstone-800 text-[13px] font-semibold";

const STATUS_TONE: Record<SupplierStatus, string> = { active: "entry", suspended: "decision", inactive: "gap" };
const REQ_LABEL: Record<ProfileField["requirement"], string> = { required: "Required", recommended: "Recommended", optional: "Optional" };
const kg = (n: number | null) => (n === null ? null : `${n.toLocaleString()} kg`);

interface FormState { code: string; status: SupplierStatus; statusReason: string; values: Record<string, string> }
const formFrom = (d: SupplierDetail | null): FormState => ({
  code: d?.code ?? "",
  status: d?.status ?? "active",
  statusReason: d?.statusReason ?? "",
  values: Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, (d?.profile[f.key] as string | null) ?? (f.key === "name" ? d?.name ?? "" : "")])),
});

/**
 * One supplier's LBA register entry: the details the client asked to keep (Identification, Location, Contact,
 * Administrative identification, Payment, Control) and the figures worked out from its trucks, delivery plans and
 * jute movements. Admin and Warehouse Incharge only — it carries bank details. `/masters/suppliers/new` adds one.
 */
export function SupplierDetailPage() {
  const { code = "" } = useParams();
  const isNew = code === "new";
  const navigate = useNavigate();
  // "Edit" on the supplier list opens the page ready to change.
  const [params] = useSearchParams();
  const startEditing = isNew || params.get("edit") === "1";
  const { refresh } = useTracking();
  const [detail, setDetail] = useState<SupplierDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(startEditing);
  const [form, setForm] = useState<FormState>(formFrom(null));
  const [codeEdited, setCodeEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.getSupplier(code).then((d) => { setDetail(d); setForm(formFrom(d)); }).catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    setDetail(null); setLoadError(null); setError(null);
    setEditing(startEditing); setForm(formFrom(null)); setCodeEdited(false);
    if (!isNew) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // A new supplier's LBA code is suggested from its name until the person types one of their own.
  const name = form.values.name ?? "";
  useEffect(() => {
    if (!isNew || codeEdited || !name.trim()) return;
    const t = setTimeout(() => { api.suggestSupplierCode(name).then((r) => setForm((f) => ({ ...f, code: r.code }))).catch(() => {}); }, 300);
    return () => clearTimeout(t);
  }, [isNew, codeEdited, name]);

  const missingNow = useMemo(() => missingRequired(form.values as SupplierProfileValues).map((f) => f.key), [form.values]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    const input: SupplierInput = {
      ...(Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, form.values[f.key] ?? ""])) as SupplierProfileValues),
      status: form.status, statusReason: form.status === "active" ? null : form.statusReason,
      ...(isNew || form.code.trim() !== detail?.code ? { code: form.code.trim() || undefined } : {}),
    };
    try {
      const saved = isNew ? await api.createSupplier(input) : await api.updateSupplier(code, input);
      await refresh();
      if (isNew || saved.code !== code) navigate(`/masters/suppliers/${encodeURIComponent(saved.code)}`, { replace: true });
      else { await load(); setEditing(false); }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setSaving(false); }
  }

  if (loadError) return <p className="text-sm text-danger-700">{loadError}</p>;
  if (!isNew && !detail) return <p className="text-sm text-warmstone-500">Loading…</p>;

  const field = (f: ProfileField) => {
    const id = `sup-${f.key}`;
    // A new supplier needs every required field; an existing one only flags what is still missing.
    const warn = !isNew && missingNow.includes(f.key) && f.requirement === "required";
    return (
      <div key={f.key}>
        <label htmlFor={id} className="flex items-center justify-between text-[12.5px] font-semibold text-warmstone-700 mb-1.5">
          <span>{f.label}{f.requirement === "required" && <span className="text-danger-700"> *</span>}</span>
          <span className="text-[10.5px] font-medium text-warmstone-400">{REQ_LABEL[f.requirement]}</span>
        </label>
        <input
          id={id} type={f.type ?? "text"} required={isNew && f.requirement === "required"} value={form.values[f.key] ?? ""}
          onChange={(e) => setForm((s) => ({ ...s, values: { ...s.values, [f.key]: e.target.value } }))}
          className={`${inputCls} ${warn ? "border-ambernut-300 bg-ambernut-50" : ""}`}
        />
      </div>
    );
  };

  // ── Edit / create ───────────────────────────────────────────────────────────────────────────────
  if (editing) {
    return (
      <form onSubmit={(e) => void save(e)} className="space-y-5">
        <PageHeader
          kicker={<Link to="/masters/suppliers" className="hover:text-warmstone-700">← Suppliers</Link>}
          title={isNew ? "New supplier" : `Edit ${detail!.name}`}
          lede={isNew ? "Fields marked * are required for a new supplier. The supplier ID is issued when you save." : "Fill in what is missing. A required field that has a value can't be emptied again."}
        />
        {error && <p role="alert" className="text-[13px] font-medium text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{error}</p>}

        <section className="bg-white border border-warmstone-200 rounded-2xl shadow-xs p-5 space-y-4">
          <h2 className="text-[14px] font-bold text-warmstone-900">Identification</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label htmlFor="sup-code" className="flex items-center justify-between text-[12.5px] font-semibold text-warmstone-700 mb-1.5">
                <span>Supplier code / LBA code<span className="text-danger-700"> *</span></span>
                {isNew && <span className="text-[10.5px] font-medium text-warmstone-400">suggested, you can change it</span>}
              </label>
              <input id="sup-code" value={form.code} onChange={(e) => { setCodeEdited(true); setForm((s) => ({ ...s, code: e.target.value })); }} placeholder="LBA-0XX-ABC" className={`${inputCls} font-mono`} />
            </div>
            {PROFILE_FIELDS.filter((f) => f.section === "Identification").map(field)}
            <div>
              <label htmlFor="sup-status" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">Status<span className="text-danger-700"> *</span></label>
              <select id="sup-status" value={form.status} onChange={(e) => setForm((s) => ({ ...s, status: e.target.value as SupplierStatus }))} className={inputCls}>
                {(Object.keys(SUPPLIER_STATUS_LABELS) as SupplierStatus[]).map((st) => <option key={st} value={st}>{SUPPLIER_STATUS_LABELS[st]}</option>)}
              </select>
            </div>
            {form.status !== "active" && (
              <div className="sm:col-span-2">
                <label htmlFor="sup-reason" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">Reason for {SUPPLIER_STATUS_LABELS[form.status].toLowerCase()}<span className="text-danger-700"> *</span></label>
                <input id="sup-reason" required value={form.statusReason} onChange={(e) => setForm((s) => ({ ...s, statusReason: e.target.value }))} className={inputCls} />
              </div>
            )}
          </div>
        </section>
        {PROFILE_SECTIONS.filter((s) => s !== "Identification").map((section) => (
          <section key={section} className="bg-white border border-warmstone-200 rounded-2xl shadow-xs p-5 space-y-4">
            <h2 className="text-[14px] font-bold text-warmstone-900">{section}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{PROFILE_FIELDS.filter((f) => f.section === section).map(field)}</div>
          </section>
        ))}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} className={btnPrimary}>
            <span className="material-symbols-outlined text-[17px]">save</span>{saving ? "Saving…" : isNew ? "Add supplier" : "Save details"}
          </button>
          <button type="button" onClick={() => (isNew ? navigate("/masters/suppliers") : (setEditing(false), setForm(formFrom(detail)), setError(null)))} className={btnSecondary}>Cancel</button>
        </div>
      </form>
    );
  }

  // ── View ────────────────────────────────────────────────────────────────────────────────────────
  const d = detail!;
  const p = d.performance;
  const sectionCard = (section: (typeof PROFILE_SECTIONS)[number], icon: string) => (
    <InfoCard key={section} icon={icon} title={section}>
      {PROFILE_FIELDS.filter((f) => f.section === section).map((f) => (
        <InfoRow key={f.key} label={f.label} value={(d.profile[f.key] as string | null) || (f.requirement === "required" ? <span className="text-ambernut-700 font-semibold">missing</span> : null)} />
      ))}
    </InfoCard>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        kicker={<Link to="/masters/suppliers" className="hover:text-warmstone-700">← Suppliers</Link>}
        title={d.name}
        lede={`${d.supplierNo} · LBA code ${d.code}${d.formerName ? ` · formerly "${d.formerName}"` : ""}`}
        actions={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Pill tone={STATUS_TONE[d.status]} label={SUPPLIER_STATUS_LABELS[d.status]} />
            {d.detailsSource === "sample" && <Pill tone="decision" label="Sample details" />}
            <button type="button" onClick={() => setEditing(true)} className={btnSecondary}><span className="material-symbols-outlined text-[17px]">edit</span>Edit</button>
          </div>
        )}
      />
      {d.status !== "active" && (
        <p className="text-[13px] text-ambernut-800 bg-ambernut-100 border border-ambernut-200 rounded-xl px-4 py-2.5">
          {SUPPLIER_STATUS_LABELS[d.status]}{d.statusReason ? `: ${d.statusReason}` : ""}
        </p>
      )}
      {d.detailsSource === "sample" && (
        <p className="text-[13px] text-ambernut-800 bg-ambernut-50 border border-ambernut-200 rounded-xl px-4 py-2.5">
          These register details are demo values, not the client's. They stop being marked as sample as soon as someone saves this supplier's details.
        </p>
      )}

      <section className="bg-white border border-warmstone-200 rounded-2xl shadow-xs p-5 space-y-2">
        <div className="flex items-center justify-between text-[13px]">
          <span className="font-bold text-warmstone-900">Required details</span>
          <span className="tabular-nums text-warmstone-600">{d.completeness.filled} of {d.completeness.total} filled</span>
        </div>
        <ProgressBar value={d.completeness.filled} max={d.completeness.total} tone={d.completeness.filled < d.completeness.total ? "over" : "default"} label="Required details filled" />
        {d.missing.length > 0 && <p className="text-[12.5px] text-ambernut-700">Missing: {d.missing.join(", ")}</p>}
      </section>

      <div>
        <h2 className="text-base font-bold text-warmstone-900 flex items-center gap-2 mb-3 px-1">
          <span className="material-symbols-outlined text-[19px] text-brand-700">monitoring</span>
          Performance <span className="text-[12px] font-normal text-warmstone-500">worked out from this supplier's trucks, delivery plans and jute movements</span>
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          <KpiTile label="Target / commitment" value={kg(p.targetKg) ?? "No plan"} />
          <KpiTile label={`Volume delivered (GRN${p.trucksAwaitingGrn ? `, ${p.trucksAwaitingGrn} truck${p.trucksAwaitingGrn === 1 ? "" : "s"} awaiting GRN` : ""})`} value={kg(p.volumeDeliveredKg) ?? "-"} />
          <KpiTile label="Weighed on arrival (net)" value={kg(p.weighedOnArrivalKg) ?? "-"} />
          <KpiTile label={`Achievement (${p.receivedOnPlansKg.toLocaleString()} kg on plans)`} value={p.achievementPct === null ? "-" : `${p.achievementPct}%`} />
          <KpiTile label={`Average KOR (${p.korTrucks} truck${p.korTrucks === 1 ? "" : "s"})`} value={p.averageKor ?? "-"} />
          <KpiTile label={`Average moisture (${p.moistureTrucks} truck${p.moistureTrucks === 1 ? "" : "s"})`} value={p.averageMoisture === null ? "-" : `${p.averageMoisture}%`} />
          <KpiTile label={`Rejected trucks (of ${p.trucksArrived})`} value={p.rejectedTrucks} tone={p.rejectedTrucks ? "gap" : "default"} />
          <KpiTile label="Rejection rate" value={p.rejectionRatePct === null ? "-" : `${p.rejectionRatePct}%`} tone={p.rejectionRatePct ? "gap" : "default"} />
          <KpiTile label="Last delivery" value={p.lastDeliveryDate ?? "-"} />
          <KpiTile label={p.juteBagBalance === null ? "Jute bag balance" : `Jute bags with supplier (${p.juteBagsIssued.toLocaleString()} issued, ${p.juteBagsReturned.toLocaleString()} returned)`} value={p.juteBagBalance === null ? "No movements" : p.juteBagBalance.toLocaleString()} />
          <KpiTile label="Funding exposure" value="Not tracked" />
          <KpiTile label="Outstanding amount" value="Not tracked" />
        </div>
        <p className="mt-2 px-1 text-[11.5px] text-warmstone-400">
          Target is the kg planned in this supplier's delivery plans (cancelled ones left out). Volume delivered counts only trucks whose GRN quantity is recorded; "weighed on arrival" is the net weight at the gate, a different figure.
          Averages are weighted by each truck's GRN kg, or its net weight while no GRN is recorded.
          Funding exposure and outstanding amount need advances and payments, which the app doesn't record yet.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <InfoCard icon="badge" title="Identification">
          <InfoRow label="Supplier ID" value={d.supplierNo} strong />
          <InfoRow label="Supplier code / LBA code" value={d.code} />
          <InfoRow label="Legal / official name" value={d.name} />
          <InfoRow label="Trade name" value={d.profile.tradeName} />
          <InfoRow label="Status" value={SUPPLIER_STATUS_LABELS[d.status]} />
        </InfoCard>
        {sectionCard("Location", "location_on")}
        {sectionCard("Contact", "contact_phone")}
        {sectionCard("Administrative identification", "gavel")}
        {sectionCard("Payment", "account_balance")}
        <InfoCard icon="history" title="Control">
          <InfoRow label="Created" value={`${d.createdAt.slice(0, 10)}${d.createdBy ? ` by ${d.createdBy}` : d.source && d.source !== "entered" ? " (imported)" : ""}`} />
          <InfoRow label="Last updated" value={`${d.updatedAt.slice(0, 10)}${d.updatedBy ? ` by ${d.updatedBy}` : ""}`} />
          <InfoRow label="Reason for suspension / inactivation" value={d.status !== "active" ? d.statusReason : null} />
          <InfoRow label="Used by" value={`${d.references.receipts} truck(s), ${d.references.plans} plan(s), ${d.references.jute} jute movement(s)`} />
        </InfoCard>
      </div>
    </div>
  );
}
