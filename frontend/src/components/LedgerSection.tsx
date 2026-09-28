import { useState, type FormEvent } from "react";
import type { JuteLedger, JuteLedgerColumn } from "../types/stage";
import { useTracking } from "../state/TrackingContext";
import { usePagination } from "./ui/usePagination";
import { Pagination } from "./ui/Pagination";
import { FilterBar } from "./ui/FilterBar";
import { DateRangeInputs } from "./ui/DateRangeInputs";
import { useDateRangeFilter } from "./ui/useDateRangeFilter";
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

const inputCls =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";

interface Props {
  ledger: JuteLedger;
  /** Overrides ledgerEntries[ledger.id] from context — set by a host page's own site filter (see
   * WarehouseStockPage/WarehouseTransfersPage), since a site-scoped read comes from a different
   * endpoint than the globally-loaded unfiltered one and needs its own row set, not a client-side
   * slice of it (see useJuteLedgerEntries's header comment for why). */
  rows?: Row[];
  /** Called right after a new entry is submitted, in addition to the always-unscoped write itself
   * — lets a filtered host page refetch its own filtered set. */
  onEntryAdded?: () => void;
}

export function LedgerSection({ ledger, rows: rowsOverride, onEntryAdded }: Props) {
  const { ledgerEntries, addLedgerEntry } = useTracking();
  const inputColumns = ledger.columns.filter((c) => !DERIVED_COLUMNS.has(c.label));
  const [draft, setDraft] = useState<Row>(() => blankRow(ledger.columns));

  // Every row comes from the server, sample rows included.
  const allRows = rowsOverride ?? (ledgerEntries[ledger.id] ?? []);
  // Every ledger has exactly one "Date"-labeled column today (see juteBags.ts) — matched by label
  // rather than hardcoded per ledger, since JuteLedgerColumn carries no `kind: "date"` flag of its
  // own. Falls back to no filter row at all if a future ledger genuinely has none.
  const dateColumn = ledger.columns.find((c) => c.label.toLowerCase().includes("date"));
  const dateFilter = useDateRangeFilter(allRows, (row) => (dateColumn ? row[dateColumn.label] : undefined));
  const page = usePagination(dateFilter.filtered);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // "S N" and "Balance" are assigned by the server: computing them here raced whenever two
    // people added a row at once, and the balance is now a SQL window function with no column to
    // drift. The row that comes back is what gets displayed.
    addLedgerEntry(ledger.id, { ...draft });
    setDraft(blankRow(ledger.columns));
    onEntryAdded?.();
  }

  return (
    <div id={ledger.id} className="scroll-mt-6 bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs">
      <h3 className="text-lg font-bold text-warmstone-900 mb-2.5">{ledger.title}</h3>
      {ledger.file && (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-warmstone-100 text-warmstone-600 text-[11px] font-medium mb-2.5">
          <span className="material-symbols-outlined text-[13px]">description</span>
          {ledger.file}
          {ledger.sheet ? ` · ${ledger.sheet}` : ""}
        </span>
      )}
      {ledger.description && <p className="text-[13px] text-warmstone-500 leading-relaxed mb-3.5">{ledger.description}</p>}

      <details className="group mb-4">
        <summary className="list-none cursor-pointer inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-warmstone-50 border border-warmstone-200 text-warmstone-700 text-[13px] font-semibold hover:bg-warmstone-100 transition-colors">
          <span className="material-symbols-outlined text-[17px]">add</span>
          Add entry
        </summary>
        <form onSubmit={handleSubmit} className="mt-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {inputColumns.map((c) => {
              const id = `ledger-${ledger.id}-${c.col}`;
              return (
                <div key={c.label}>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <label htmlFor={id} className="text-[12.5px] font-semibold text-warmstone-700">
                      {c.label}
                    </label>
                    {!c.real && (
                      <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-ambernut-100 text-ambernut-800">
                        new
                      </span>
                    )}
                  </div>
                  {c.label === "Activities type" ? (
                    <>
                      <input
                        id={id}
                        list="jute-activity-types"
                        value={draft[c.label] ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, [c.label]: e.target.value }))}
                        placeholder="Movement category, or a supplier name"
                        className={inputCls}
                      />
                      <datalist id="jute-activity-types">
                        {KNOWN_ACTIVITY_TYPES.map((t) => (
                          <option value={t} key={t} />
                        ))}
                      </datalist>
                    </>
                  ) : (
                    <input
                      id={id}
                      value={draft[c.label] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [c.label]: e.target.value }))}
                      placeholder={c.real ? "" : "Not recorded yet"}
                      className={inputCls}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="submit"
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold transition-all shadow-sm"
          >
            <span className="material-symbols-outlined text-[17px]">add</span>
            Save entry
          </button>
        </form>
      </details>

      {dateColumn && (
        <FilterBar>
          <DateRangeInputs value={dateFilter.range} onChange={dateFilter.setRange} />
        </FilterBar>
      )}

      <div className="overflow-x-auto border border-warmstone-200 rounded-xl">
        <table className="w-full text-[12.5px] border-collapse">
          <thead>
            <tr className="border-b border-warmstone-200 bg-warmstone-50">
              {ledger.columns.map((c) => (
                <th key={c.label} className="text-left px-3 py-2.5 text-[10.5px] font-bold uppercase tracking-wider text-warmstone-500 whitespace-nowrap">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dateFilter.filtered.length === 0 && (
              <tr>
                <td colSpan={ledger.columns.length} className="px-3 py-4 text-warmstone-400 italic">
                  {allRows.length === 0 ? "No entries yet — add one above." : "No entries in this date range."}
                </td>
              </tr>
            )}
            {page.pageRows.map((row, i) => (
              <tr key={i} className="border-b border-warmstone-100 last:border-0 hover:bg-warmstone-50">
                {ledger.columns.map((c) => (
                  <td key={c.label} className="px-3 py-2 text-warmstone-800 whitespace-nowrap tabular-nums">
                    {row[c.label] || "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination state={page} />
      </div>

      {ledger.flag && (
        <details className="mt-3.5">
          <summary className="list-none cursor-pointer inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ambernut-700">
            <span className="material-symbols-outlined text-[15px]">info</span>
            Worth knowing
          </summary>
          <p className="text-[12.5px] text-warmstone-500 leading-relaxed mt-1.5 pl-5.25">{ledger.flag}</p>
        </details>
      )}
    </div>
  );
}
