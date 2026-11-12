import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { useTracking, useDeliveryPlans } from "../../state/TrackingContext";
import { useReceptionStore, useSite } from "../../state/SiteContext";
import { api } from "../../repository/api";
import { normalizeSupplierName } from "@anagroci/contract/domain/supplierCode";
import { isOpenPlan, supplierOpenPlans } from "@anagroci/contract/domain/deliveryPlan";
import { formatDate } from "@anagroci/contract/domain/dateFormat";
import { BATCH_TRUCK_COLUMNS, BATCH_REQUIRED_LABEL, BATCH_MAX_ROWS, type BatchTruckRow } from "../../data/batchEntry";
import { todayIso } from "@anagroci/contract/domain/dateFormat";
import { DateInput } from "../../components/ui/DateInput";
import { isUnlistedOrigin } from "@anagroci/contract/domain/origin";
import { UNLISTED_ORIGIN } from "../../components/receipt/originPicker";

/** A grid row's values, keyed by the stage field label (so it maps straight onto the API payload). */
type Values = Record<string, string>;
interface Row { key: number; v: Values }

/** Grid layout. Supplier is one picker that fills both SUPPLIERS NAME and LBA CODE, so the two can
 * never disagree; every other column is one stage field, looked up by its label. */
const SUPPLIER = "SUPPLIER";
/** Which delivery plan the truck is for. Not a stage field: it travels beside the rows (see save()). */
const PLAN = "DELIVERY PLAN";
/** Set when the person chose "No plan · unplanned truck" themselves, so a plan made later isn't linked over it. Never sent. */
const UNPLANNED = "UNPLANNED";
/** The origin a delivery plan filled in, so changing the plan can take it back out. Never sent. */
const PLAN_ORIGIN = "PLAN_ORIGIN";

/**
 * The row with `plan` as its delivery plan (or none). The plan's origin comes along — but only into an origin the
 * person hasn't typed: an origin that came from the previous plan is replaced (or cleared when there is no plan now),
 * one they typed themselves is left alone.
 */
function withPlan(v: Values, plan: { id: string; expectedOrigin: string | null } | undefined): Values {
  const origin = (v["ORIGIN"] ?? "").trim();
  const typed = origin !== "" && origin !== (v[PLAN_ORIGIN] ?? "");
  const fromPlan = plan?.expectedOrigin ?? "";
  return {
    ...v,
    [PLAN]: plan?.id ?? "",
    ORIGIN: typed ? v["ORIGIN"]! : fromPlan,
    [PLAN_ORIGIN]: typed ? "" : fromPlan,
  };
}
const COLUMNS: { key: string; label: string; type?: string; width: string }[] = [
  { key: "DATE OF ARRIVAL", label: "Date of arrival", type: "date", width: "w-40" },
  { key: BATCH_REQUIRED_LABEL, label: "Vehicle no.", width: "w-40" },
  { key: SUPPLIER, label: "Supplier", width: "w-64" },
  { key: PLAN, label: "Delivery plan", width: "w-56" },
  { key: "FICHE", label: "Fiche no.", width: "w-32" },
  { key: "CREDIT/CASH", label: "Credit / cash", width: "w-32" },
  { key: "ORIGIN", label: "Origin", width: "w-40" },
  { key: "REMARKS", label: "Remarks", width: "w-56" },
];

const cellCls =
  "w-full px-2.5 py-1.5 rounded-lg border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";
const btnSecondary =
  "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-warmstone-200 text-warmstone-700 text-[13px] font-semibold hover:bg-warmstone-50 transition-all";

const today = todayIso;
const INITIAL_ROWS = 5;

let nextKey = 1;
const newRow = (date: string): Row => ({ key: nextKey++, v: { "DATE OF ARRIVAL": date } });

/** Only the date is pre-filled, so a row counts as untouched until something else is typed. */
const isBlank = (v: Values) => Object.entries(v).every(([k, val]) => k === "DATE OF ARRIVAL" || !val.trim());

function toPayload(v: Values): BatchTruckRow {
  const row: BatchTruckRow = {};
  for (const { stageId, label } of BATCH_TRUCK_COLUMNS) {
    const val = (v[label] ?? "").trim();
    if (val) (row[stageId] ??= {})[label] = val;
  }
  return row;
}

/**
 * Warehouse Incharge: open several trucks at once. One row per truck (the fields known at the gate),
 * one Save creates every receipt — all or nothing. Anything further (weights, lot, bin, …) is filled
 * on each receipt afterwards, exactly as for a truck opened one at a time.
 */
export function BatchEntryPage() {
  const site = useSite();
  // The trucks are entered at the store Reception was showing (?store=); the site itself only when it has no store.
  const { store, isNoStore } = useReceptionStore();
  const at = store && !isNoStore ? store : site.warehouseName;
  const back = `/${site.slug}/receipts${at !== site.warehouseName ? `?store=${encodeURIComponent(at)}` : ""}`;
  const { masters, refresh } = useTracking();
  const { plans, refetch: refetchPlans } = useDeliveryPlans(site.warehouseName);
  // A truck can be linked to a plan that is still expecting trucks — for this store, or for the site with no store
  // named (the server refuses a plan for another store). Trucks with no plan are fine too (unplanned).
  const openPlans = plans.filter((p) => isOpenPlan(p) && (!p.destinationStore || at === site.warehouseName || p.destinationStore === at));
  // "Create a delivery plan" opens in another tab, so the rows typed here stay; coming back reads the plans again.
  useEffect(() => {
    const onFocus = () => void refetchPlans();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refetchPlans]);
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: INITIAL_ROWS }, () => newRow(today())));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string[] | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  // A row whose supplier had no plan picks up the one just created — unless the person chose "unplanned" themselves.
  useEffect(() => {
    setRows((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        const code = r.v["LBA CODE"];
        if (!code || r.v[PLAN] || r.v[UNPLANNED] === "1") return r;
        const latest = supplierOpenPlans(openPlans, code)[0];
        if (!latest) return r;
        changed = true;
        return { ...r, v: withPlan(r.v, latest) };
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans]);

  const filled = rows.filter((r) => !isBlank(r.v));
  const missingVehicle = filled.filter((r) => !(r.v[BATCH_REQUIRED_LABEL] ?? "").trim());
  const tooMany = filled.length > BATCH_MAX_ROWS;
  const canSave = filled.length > 0 && missingVehicle.length === 0 && !tooMany && !saving;

  function setValue(key: number, col: string, value: string) {
    setRows((prev) => prev.map((r) => {
      if (r.key !== key) return r;
      // Picking a supplier sets both stage fields, and links the truck to that supplier's latest open delivery plan —
      // the plan already names the supplier, so it is the one the truck most likely came under. A plan already picked
      // for this same supplier is kept; with no open plan the truck goes in unplanned (the row says so).
      if (col === SUPPLIER) {
        const s = masters.suppliers.find((x) => x.code === value);
        const current = openPlans.find((p) => p.id === r.v[PLAN]);
        const keep = current && s && current.supplierCode === s.code;
        const latest = s ? supplierOpenPlans(openPlans, s.code)[0] : undefined;
        const v = { ...r.v, "LBA CODE": s?.code ?? "", "SUPPLIERS NAME": s?.name ?? "", [UNPLANNED]: "" };
        return { ...r, v: keep ? v : withPlan(v, latest) };
      }
      // Picking a plan brings along what it already knows (its supplier and origin) so they aren't typed again; the
      // person still sees them in the row and can change them before saving. Choosing no plan takes a plan's origin out.
      if (col === PLAN) {
        const plan = openPlans.find((p) => p.id === value);
        const s = plan?.supplierCode ? masters.suppliers.find((x) => x.code === plan.supplierCode) : undefined;
        const v = { ...r.v, [UNPLANNED]: value || !r.v["LBA CODE"] ? "" : "1", ...(s ? { "LBA CODE": s.code, "SUPPLIERS NAME": s.name } : {}) };
        return { ...r, v: withPlan(v, plan) };
      }
      return { ...r, v: { ...r.v, [col]: value } };
    }));
  }

  const lastDate = (list: Row[]) => list[list.length - 1]?.v["DATE OF ARRIVAL"] || today();
  // New rows copy the previous row's date: trucks in one sitting usually arrived the same day.
  const addRows = (n: number) => setRows((prev) => [...prev, ...Array.from({ length: n }, () => newRow(lastDate(prev)))]);
  const duplicate = (key: number) =>
    setRows((prev) => prev.flatMap((r) => (r.key === key ? [r, { key: nextKey++, v: { ...r.v, "VEHICLE NO.": "", FICHE: "" } }] : [r])));
  const remove = (key: number) => setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));

  /** Enter moves down the column (adding a row at the bottom), like a spreadsheet. */
  function onEnter(e: KeyboardEvent<HTMLElement>, rowIndex: number, colKey: string) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const focusNext = () =>
      tableRef.current?.querySelector<HTMLElement>(`[data-row="${rowIndex + 1}"][data-col="${colKey}"]`)?.focus();
    if (rowIndex + 1 >= rows.length) {
      addRows(1);
      setTimeout(focusNext, 0);
    } else {
      focusNext();
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // The server numbers "Row N" over what we send, so blank rows are dropped first and the
      // message is mapped back to the row on screen below.
      const { ids } = await api.createReceiptsBatch(at, filled.map((r) => toPayload(r.v)), filled.map((r) => r.v[PLAN] || null));
      await refresh();
      setCreated(ids);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const m = /^Row (\d+):/.exec(msg);
      const shown = m ? rows.indexOf(filled[Number(m[1]) - 1]) + 1 : 0;
      setError(m && shown ? msg.replace(/^Row \d+/, `Row ${shown}`) : msg);
    } finally {
      setSaving(false);
    }
  }

  if (created) {
    return (
      <div className="space-y-5">
        <PageHeader kicker={`${site.label} · ${site.sublabel} · ${at}`} title={`${created.length} receipt${created.length === 1 ? "" : "s"} created`} lede="Open each one to continue with weights, lot and bin." />
        <div className="bg-white border border-warmstone-200 rounded-2xl shadow-xs p-5 flex flex-wrap gap-2">
          {created.map((id) => (
            <Link key={id} to={`/${site.slug}/receipts/${id}`} className="text-[12.5px] font-bold text-brand-700 bg-brand-50 border border-brand-200 px-2.5 py-1 rounded-md hover:bg-brand-100">
              {id}
            </Link>
          ))}
        </div>
        <div className="flex gap-3">
          <button className={btnSecondary} onClick={() => { setRows(Array.from({ length: INITIAL_ROWS }, () => newRow(today()))); setCreated(null); }}>
            <span className="material-symbols-outlined text-[16px]">add</span>Add more entries
          </button>
          <Link to={back} className={btnSecondary}>Back to Reception</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        kicker={`${site.label} · ${site.sublabel} · ${at}`}
        title="Add entries"
        lede="One row per truck. Picking a supplier links the truck to that supplier's latest open delivery plan (change it, or choose no plan for an unplanned truck). Save creates all of them together - if a row is wrong, none are created. Weights, lot and bin are filled on each receipt afterwards."
        actions={<Link to={back} className={btnSecondary}>Cancel</Link>}
      />

      <datalist id="batch-credit-cash"><option value="CASH" /><option value="CREDIT" /></datalist>
      <datalist id="batch-origins">{masters.origins.map((o) => <option key={o} value={o} />)}</datalist>

      <div className="overflow-x-auto bg-white border border-warmstone-200 rounded-2xl shadow-xs">
        <table ref={tableRef} className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="border-b border-warmstone-200">
              <th className="px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-warmstone-500 w-10">#</th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-2 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-warmstone-500 whitespace-nowrap">
                  {c.label}{c.key === BATCH_REQUIRED_LABEL && <span className="text-danger-700"> *</span>}
                </th>
              ))}
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const bad = !isBlank(r.v) && !(r.v[BATCH_REQUIRED_LABEL] ?? "").trim();
              return (
                <tr key={r.key} className={`border-b border-warmstone-100 last:border-0 ${bad ? "bg-danger-50" : ""}`}>
                  <td className="px-3 py-2 text-warmstone-400 tabular-nums">{i + 1}</td>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className={`px-2 py-1.5 ${c.width}`}>
                      {c.key === SUPPLIER ? (
                        <>
                        <select
                          aria-label={`Supplier, row ${i + 1}`} data-row={i} data-col={c.key}
                          value={r.v["LBA CODE"] ?? ""} onChange={(e) => setValue(r.key, SUPPLIER, e.target.value)}
                          onKeyDown={(e) => onEnter(e, i, c.key)} className={cellCls}
                        >
                          <option value="">-</option>
                          {masters.suppliers.filter((s) => s.active !== false).map((s) => <option key={s.code} value={s.code}>{s.code} · {s.name}{s.status === "suspended" ? " (suspended)" : ""}</option>)}
                        </select>
                        {/* Suspended is a warning, not a block (client decision): the truck can still be entered. */}
                        {masters.suppliers.find((s) => s.code === r.v["LBA CODE"])?.status === "suspended" && (
                          <span className="block mt-1 text-[11px] font-semibold text-ambernut-700">Supplier is suspended</span>
                        )}
                        </>
                      ) : c.key === PLAN ? (
                        <PlanCell
                          row={i} supplierCode={r.v["LBA CODE"] ?? ""} value={r.v[PLAN] ?? ""} openPlans={openPlans}
                          createHref={`/${site.slug}/delivery-plans?new=1${r.v["LBA CODE"] ? `&supplier=${encodeURIComponent(r.v["LBA CODE"])}` : ""}`}
                          onChange={(v) => setValue(r.key, PLAN, v)} onKeyDown={(e) => onEnter(e, i, c.key)}
                        />
                      ) : (
                        c.type === "date" ? (
                          <DateInput
                            aria-label={`${c.label}, row ${i + 1}`} data-row={i} data-col={c.key}
                            value={r.v[c.key] ?? ""} onChange={(d) => setValue(r.key, c.key, d)}
                            onKeyDown={(e) => onEnter(e, i, c.key)} className={cellCls}
                          />
                        ) : (
                        <input
                          aria-label={`${c.label}, row ${i + 1}`} data-row={i} data-col={c.key}
                          type={c.type ?? "text"} value={r.v[c.key] ?? ""}
                          list={c.key === "CREDIT/CASH" ? "batch-credit-cash" : c.key === "ORIGIN" ? "batch-origins" : undefined}
                          onChange={(e) => setValue(r.key, c.key, e.target.value)}
                          onKeyDown={(e) => onEnter(e, i, c.key)}
                          // A town the master doesn't have is marked, not refused (see originPicker.ts).
                          title={c.key === "ORIGIN" && isUnlistedOrigin(r.v[c.key], masters.origins) ? UNLISTED_ORIGIN : undefined}
                          className={c.key === "ORIGIN" && isUnlistedOrigin(r.v[c.key], masters.origins) ? `${cellCls} border-ambernut-500! bg-ambernut-50!` : cellCls}
                        />
                        )
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <button type="button" onClick={() => duplicate(r.key)} title="Duplicate row (keeps supplier, date and the rest; clears vehicle and fiche)" aria-label={`Duplicate row ${i + 1}`} className="p-1 rounded-md text-warmstone-400 hover:text-brand-700 hover:bg-warmstone-100">
                      <span className="material-symbols-outlined text-[18px]">content_copy</span>
                    </button>
                    <button type="button" onClick={() => remove(r.key)} disabled={rows.length === 1} title="Remove row" aria-label={`Remove row ${i + 1}`} className="p-1 rounded-md text-warmstone-400 hover:text-danger-700 hover:bg-warmstone-100 disabled:opacity-30">
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btnSecondary} onClick={() => addRows(1)}><span className="material-symbols-outlined text-[16px]">add</span>Add row</button>
        <button type="button" className={btnSecondary} onClick={() => addRows(5)}>Add 5 rows</button>
        <span className="text-[12.5px] text-warmstone-500">
          {filled.length} truck{filled.length === 1 ? "" : "s"} to create
          {missingVehicle.length > 0 && <span className="text-danger-700 font-semibold"> · {missingVehicle.length} missing a vehicle no.</span>}
          {tooMany && <span className="text-danger-700 font-semibold"> · at most {BATCH_MAX_ROWS} per batch</span>}
        </span>
        <button
          type="button" onClick={save} disabled={!canSave}
          className="ml-auto inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold transition-all shadow-sm disabled:opacity-40 disabled:pointer-events-none"
        >
          <span className="material-symbols-outlined text-[17px]">save</span>
          {saving ? "Creating…" : `Create ${filled.length || ""} receipt${filled.length === 1 ? "" : "s"}`.replace("  ", " ")}
        </button>
      </div>
      {error && <p role="alert" className="text-[13px] font-medium text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{error}</p>}
      <p className="text-xs text-warmstone-400">Tip: press Enter to jump to the same column in the next row.</p>
    </div>
  );
}

type OpenPlan = ReturnType<typeof useDeliveryPlans>["plans"][number];

/**
 * A row's Delivery plan. Before a supplier is picked: every open plan (picking one fills the supplier in). With a
 * supplier: only that supplier's open plans, the latest first and picked for it — or, when it has none, a plain
 * "no delivery plan for this supplier" with a link to create one; the truck can still be saved as unplanned.
 */
function PlanCell({ row, supplierCode, value, openPlans, createHref, onChange, onKeyDown }: {
  row: number;
  supplierCode: string;
  value: string;
  openPlans: OpenPlan[];
  createHref: string;
  onChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}) {
  const mine = supplierCode ? supplierOpenPlans(openPlans, supplierCode) : openPlans;
  const label = (p: OpenPlan) => `${p.id} · ${supplierCode ? `arrival ${formatDate(p.expectedArrivalDate)}` : normalizeSupplierName(p.supplierName)}`;

  if (supplierCode && mine.length === 0) {
    return (
      <div>
        <select aria-label={`Delivery plan, row ${row + 1}`} data-row={row} data-col={PLAN} value="" disabled className={cellCls}>
          <option value="">No delivery plan for this supplier</option>
        </select>
        <span className="block mt-1 text-[11px] text-warmstone-500">
          <a href={createHref} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 hover:underline">Create a delivery plan</a>
          {" "}or save the truck without one.
        </span>
      </div>
    );
  }
  return (
    <select aria-label={`Delivery plan, row ${row + 1}`} data-row={row} data-col={PLAN} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} className={cellCls}>
      {!supplierCode && <option value="">No plan</option>}
      {mine.map((p, i) => <option key={p.id} value={p.id}>{label(p)}{supplierCode && i === 0 ? " (latest)" : ""}</option>)}
      {/* A truck can still arrive outside its supplier's plans (an unplanned truck, as the client's workbook records). */}
      {supplierCode && <option value="">No plan · unplanned truck</option>}
    </select>
  );
}
