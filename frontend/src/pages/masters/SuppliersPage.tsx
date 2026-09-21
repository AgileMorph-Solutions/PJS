import { useState, type FormEvent } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { useTracking } from "../../state/TrackingContext";
import type { Supplier } from "../../repository/mastersRepo";

export function SuppliersPage() {
  const { masters, addSupplier } = useTracking();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;
    addSupplier({ code: code.trim(), name: name.trim() });
    setCode("");
    setName("");
  }

  const columns: Column<Supplier>[] = [
    { label: "LBA Code", render: (s) => <span className="mono">{s.code}</span> },
    { label: "Supplier name", render: (s) => s.name },
  ];

  return (
    <>
      <PageHeader
        kicker="Masters"
        title="Suppliers"
        lede={`${masters.suppliers.length} suppliers, seeded from the real LBA codes in Rcn Offloading Details 2026.xlsx.`}
      />
      <div className="card">
        <form onSubmit={handleSubmit} className="ledger-form-grid">
          <div className="field-row">
            <div className="field-label">
              <span>LBA Code</span>
            </div>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="LBA-0XX-ABC" />
          </div>
          <div className="field-row">
            <div className="field-label">
              <span>Supplier name</span>
            </div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="RCN SCOOP …" />
          </div>
          <div style={{ alignSelf: "end" }}>
            <button className="btn btn-primary" type="submit">
              + Add supplier
            </button>
          </div>
        </form>
      </div>
      <DataTable columns={columns} rows={masters.suppliers} keyFn={(s) => s.code} emptyTitle="No suppliers yet" />
    </>
  );
}
