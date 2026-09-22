import { useState, type FormEvent } from "react";
import type { JuteLedger, JuteLedgerColumn } from "../types/stage";
import { useTracking } from "../state/TrackingContext";
// NOTE: allRowsFor() is deliberately NOT used any more. It prepended juteBags.ts's hardcoded
// sampleRows to the entered rows, which was right when the ledger was empty demo data. The API now
// serves the real 298/367 workbook rows — and those sample rows are among them — so prepending
// would show three rows twice and corrupt the running balance.

type Row = Record<string, string>;

// A handful of real, observed movement categories from BOUAKE WAREHOUSE JUTE BAGS MOVEMENT
// REPORT.xlsx — offered as suggestions, not a closed list, since the real sheet also uses this
// same column to hold a supplier name for issue-to-supplier rows.
const KNOWN_ACTIVITY_TYPES = [
  "JUTE BAGS PURCHASED/UNLOADINGS",
  "REBAGGING DURING UNLOADING",
  "REBAGGING DURING LOADING",
  "REBAGGING DURING STACKING",
  "REBAGGING DURING DRYING",
  "TRANSFFER TO YAMOUSSOUKRO",
];

const DERIVED_COLUMNS = new Set(["S N", "Balance"]);

function blankRow(columns: JuteLedgerColumn[]): Row {
  return Object.fromEntries(columns.filter((c) => !DERIVED_COLUMNS.has(c.label)).map((c) => [c.label, ""]));
}

export function LedgerSection({ ledger }: { ledger: JuteLedger }) {
  const { ledgerEntries, addLedgerEntry } = useTracking();
  const inputColumns = ledger.columns.filter((c) => !DERIVED_COLUMNS.has(c.label));
  const [draft, setDraft] = useState<Row>(() => blankRow(ledger.columns));

  // Every row comes from the server, sample rows included.
  const allRows = ledgerEntries[ledger.id] ?? [];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // "S N" and "Balance" are assigned by the server: computing them here raced whenever two
    // people added a row at once, and the balance is now a SQL window function with no column to
    // drift. The row that comes back is what gets displayed.
    addLedgerEntry(ledger.id, { ...draft });
    setDraft(blankRow(ledger.columns));
  }

  return (
    <div className="card" id={ledger.id} style={{ scrollMarginTop: 24 }}>
      <h3 style={{ marginBottom: 10 }}>{ledger.title}</h3>
      {ledger.file && (
        <div className="file-chip">
          📄 {ledger.file}
          {ledger.sheet ? ` · ${ledger.sheet}` : ""}
        </div>
      )}
      {ledger.description && (
        <p className="stage-note" style={{ marginBottom: 14 }}>
          {ledger.description}
        </p>
      )}

      <form onSubmit={handleSubmit}>
        <div className="ledger-form-grid">
          {inputColumns.map((c) => (
            <div className="field-row" key={c.label}>
              <div className="field-label">
                <span>{c.label}</span>
                <span className={`field-badge ${c.real ? "xl" : "new"}`}>{c.real ? "workbook" : "new"}</span>
              </div>
              {c.label === "Activities type" ? (
                <>
                  <input
                    list="jute-activity-types"
                    value={draft[c.label] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [c.label]: e.target.value }))}
                    placeholder="Movement category, or a supplier name"
                  />
                  <datalist id="jute-activity-types">
                    {KNOWN_ACTIVITY_TYPES.map((t) => (
                      <option value={t} key={t} />
                    ))}
                  </datalist>
                </>
              ) : (
                <input
                  value={draft[c.label] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [c.label]: e.target.value }))}
                  placeholder={c.real ? "" : "Not captured anywhere today — try it out"}
                />
              )}
            </div>
          ))}
        </div>
        <button type="submit" className="btn btn-primary" style={{ marginTop: 4 }}>
          + Add entry
        </button>
      </form>

      <div style={{ overflowX: "auto", marginTop: 22 }}>
        <table className="ledger-table">
          <thead>
            <tr>
              {ledger.columns.map((c) => (
                <th key={c.label}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allRows.length === 0 && (
              <tr>
                <td colSpan={ledger.columns.length} style={{ color: "var(--ink-soft)", fontStyle: "italic" }}>
                  No entries yet — add one above.
                </td>
              </tr>
            )}
            {allRows.map((row, i) => (
              <tr key={i}>
                {ledger.columns.map((c) => (
                  <td key={c.label}>{row[c.label] || "—"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ledger.flag && (
        <p className="stage-note" style={{ marginTop: 14, marginBottom: 0 }}>
          <b>Worth knowing:</b> {ledger.flag}
        </p>
      )}
    </div>
  );
}
