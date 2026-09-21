import { useState, type FormEvent } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { useTracking } from "../../state/TrackingContext";

export function WarehousesPage() {
  const { masters, addWarehouse, receipts } = useTracking();
  const [name, setName] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    addWarehouse(name.trim().toUpperCase());
    setName("");
  }

  return (
    <>
      <PageHeader
        kicker="Masters"
        title="Warehouses"
        lede="Village, Regional Central, or Factory warehouses — the same truck arrival sequence applies at any of them."
      />
      <div className="card">
        <form onSubmit={handleSubmit} style={{ display: "flex", gap: 12, alignItems: "end" }}>
          <div className="field-row" style={{ flex: 1, marginBottom: 0 }}>
            <div className="field-label">
              <span>Warehouse name</span>
            </div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. BONDOUKOU" />
          </div>
          <button className="btn btn-primary" type="submit">
            + Add warehouse
          </button>
        </form>
      </div>
      {masters.warehouses.map((w) => (
        <div className="summary-row" key={w}>
          <span className="fname">{w}</span>
          <span className="fval">{receipts.filter((r) => r.warehouse === w).length} receipts</span>
        </div>
      ))}
    </>
  );
}
