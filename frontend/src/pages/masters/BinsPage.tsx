import { useState, type FormEvent } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { useTracking } from "../../state/TrackingContext";

export function BinsPage() {
  const { masters, addBin, receipts } = useTracking();
  const [name, setName] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    addBin(name.trim().toUpperCase());
    setName("");
  }

  return (
    <>
      <PageHeader
        kicker="Masters"
        title="Bins"
        lede="Physical storage locations. One Bin can hold RCN from several different Lots/trucks at once."
      />
      <div className="card">
        <form onSubmit={handleSubmit} style={{ display: "flex", gap: 12, alignItems: "end" }}>
          <div className="field-row" style={{ flex: 1, marginBottom: 0 }}>
            <div className="field-label">
              <span>Bin code</span>
            </div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. BKE-004" />
          </div>
          <button className="btn btn-primary" type="submit">
            + Add bin
          </button>
        </form>
      </div>
      {masters.bins.map((b) => (
        <div className="summary-row" key={b}>
          <span className="fname mono">{b}</span>
          <span className="fval">{receipts.filter((r) => r.binNo === b).length} Lots stored</span>
        </div>
      ))}
    </>
  );
}
