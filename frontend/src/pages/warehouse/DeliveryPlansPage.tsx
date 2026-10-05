import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { Pill } from "../../components/ui/Pill";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { useTracking, useDeliveryPlans } from "../../state/TrackingContext";
import { useSite, useSwitchSite } from "../../state/SiteContext";
import { useCanEditDirectly } from "../../state/AuthContext";
import { api } from "../../repository/api";
import type { DeliveryPlan, DeliveryStatus } from "../../types/receipt";

const STATUS: Record<DeliveryStatus, { label: string; tone: string }> = {
  planned: { label: "Planned", tone: "decision" },
  overdue: { label: "Overdue", tone: "gap" },
  arrived: { label: "Arrived", tone: "entry" },
};

const inputClass =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * What is expected to arrive, recorded before the truck comes (Oct 2026 team feedback), so receiving
 * can be compared against the plan. A truck may still arrive with no plan at all — "Record arrival"
 * on a plan opens the receipt with the plan's supplier already filled in, and the plan then reads
 * as arrived. The actual arrival date, truck and status shown here are read from that receipt.
 */
export function DeliveryPlansPage() {
  const site = useSite();
  const switchSite = useSwitchSite();
  const navigate = useNavigate();
  const canEdit = useCanEditDirectly();
  const { masters, createReceipt } = useTracking();
  const { plans, refetch } = useDeliveryPlans(site.warehouseName);
  const search = useTableSearch(plans, (p) => [p.id, p.supplierName, p.supplierCode, p.truckNo, p.expectedTruckType]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [supplierName, setSupplierName] = useState("");
  const [supplierCode, setSupplierCode] = useState("");
  const [quantity, setQuantity] = useState("");
  const [truckType, setTruckType] = useState("");
  const [expected, setExpected] = useState(today());
  const [remarks, setRemarks] = useState("");

  const supplierByName = useMemo(() => new Map(masters.suppliers.map((s) => [s.name, s.code])), [masters.suppliers]);

  function pickSupplier(name: string) {
    setSupplierName(name);
    // A known supplier brings its code along, so it is not typed twice.
    const code = supplierByName.get(name);
    if (code) setSupplierCode(code);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.createDeliveryPlan({
        supplierName: supplierName.trim(),
        supplierCode: supplierCode.trim() || null,
        expectedQuantityKg: quantity.trim() ? Number(quantity.replace(/\s/g, "").replace(",", ".")) : null,
        expectedTruckType: truckType.trim() || null,
        expectedArrivalDate: expected,
        plannedDeliveryDate: expected,
        destinationWarehouse: site.warehouseName,
        remarks: remarks.trim() || null,
      });
      setSupplierName(""); setSupplierCode(""); setQuantity(""); setTruckType(""); setRemarks("");
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function recordArrival(plan: DeliveryPlan) {
    setError(null);
    try {
      const id = await createReceipt(site.warehouseName, { arrivalDate: today(), deliveryPlanId: plan.id });
      await refetch();
      navigate(`/${site.slug}/receipts/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const columns: Column<DeliveryPlan>[] = [
    { label: "Plan", render: (p) => <span className="font-mono text-[12.5px]">{p.id}</span> },
    { label: "Supplier", render: (p) => <span>{p.supplierName}{p.supplierCode ? <span className="text-warmstone-400"> · {p.supplierCode}</span> : null}</span> },
    { label: "Expected", render: (p) => p.expectedArrivalDate },
    { label: "Quantity (kg)", render: (p) => (p.expectedQuantityKg === null ? "—" : p.expectedQuantityKg.toLocaleString()) },
    { label: "Truck type", render: (p) => p.expectedTruckType || "—" },
    { label: "Status", render: (p) => <Pill tone={STATUS[p.deliveryStatus].tone} label={STATUS[p.deliveryStatus].label} /> },
    { label: "Arrived", render: (p) => p.actualArrivalDate ?? "—" },
    { label: "Truck no.", render: (p) => p.truckNo ?? "—" },
    {
      label: "",
      render: (p) =>
        p.receiptIds.length ? (
          <Link to={`/${site.slug}/receipts/${p.receiptIds[0]}`} className="text-[11.5px] font-semibold text-brand-700 hover:text-brand-800 whitespace-nowrap">
            Open receipt
          </Link>
        ) : canEdit ? (
          <button type="button" onClick={() => void recordArrival(p)} className="text-[11.5px] font-semibold text-brand-700 hover:text-brand-800 whitespace-nowrap">
            Record arrival
          </button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        kicker={`${site.label} · ${site.sublabel}`}
        title="Delivery plans"
        lede="What is expected to arrive, planned before the truck comes. A truck can also arrive with no plan — it is never turned away for lacking one."
        actions={<SiteSwitcher value={site.slug} onChange={(s) => s && switchSite(s)} />}
      />

      {canEdit && (
        <CollapsibleCard title="New delivery plan" meta={`for ${site.warehouseName}`}>
          <form onSubmit={handleCreate} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-3">
            <div>
              <label htmlFor="dp-supplier" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">Supplier</label>
              <input id="dp-supplier" list="dp-suppliers" required value={supplierName} onChange={(e) => pickSupplier(e.target.value)} className={inputClass} placeholder="Start typing a supplier…" />
              <datalist id="dp-suppliers">{masters.suppliers.map((s) => <option key={s.code} value={s.name} />)}</datalist>
            </div>
            <div>
              <label htmlFor="dp-code" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">Supplier code</label>
              <input id="dp-code" value={supplierCode} onChange={(e) => setSupplierCode(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="dp-expected" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">Expected arrival date</label>
              <input id="dp-expected" type="date" required value={expected} onChange={(e) => setExpected(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="dp-qty" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">Expected quantity (kg)</label>
              <input id="dp-qty" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="dp-truck" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">Expected truck type</label>
              <input id="dp-truck" value={truckType} onChange={(e) => setTruckType(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="dp-remarks" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">Remarks</label>
              <input id="dp-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} className={inputClass} />
            </div>
            <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3">
              <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold transition-all shadow-sm disabled:opacity-50">
                <span className="material-symbols-outlined text-[17px]">add</span>
                Add plan
              </button>
              <span className="text-[12px] text-warmstone-500">The plan's ID is issued when you add it.</span>
            </div>
          </form>
        </CollapsibleCard>
      )}

      {error && <p role="alert" className="px-1 text-[13px] text-danger-700">{error}</p>}

      <FilterBar>
        <input placeholder="Search plan, supplier, truck…" value={search.q} onChange={(e) => search.setQ(e.target.value)} className="w-full sm:w-64" />
      </FilterBar>
      <DataTable
        columns={columns}
        rows={search.filtered}
        keyFn={(p) => p.id}
        emptyTitle="No delivery plans yet"
        emptyHint="Add a plan for each delivery you expect, so what arrives can be compared with what was planned."
      />
    </div>
  );
}
