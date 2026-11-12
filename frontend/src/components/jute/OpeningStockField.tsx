import { useEffect, useState, type FormEvent } from "react";
import { openingBalanceProblems } from "@anagroci/contract/domain/juteOpeningBalance";
import { formatDate, todayIso } from "@anagroci/contract/domain/dateFormat";
import { api, type OpeningBalanceRow } from "../../repository/api";
import { useCanEditDirectly } from "../../state/AuthContext";
import { useOpeningBalances } from "../../state/TrackingContext";
import { DateInput } from "../ui/DateInput";

const inputCls =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-white text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100";
const labelCls = "block text-[12.5px] font-semibold text-warmstone-700 mb-1.5";
const boxCls = "mb-4 rounded-xl border border-warmstone-200 bg-warmstone-50 px-4 py-3";

const summary = (o: OpeningBalanceRow) => (
  <>
    <b className="text-warmstone-900">{o.bags.toLocaleString()} bags</b>, counted on {formatDate(o.date)}
  </>
);

interface Props {
  /** The warehouse selected. Undefined is the "All warehouses" view, where nothing can be entered. */
  warehouse?: string;
  /** Every warehouse in the master. */
  warehouses: string[];
  onSelectWarehouse: (warehouse: string) => void;
  onSaved: () => void;
}

/**
 * Opening stock, inside the Warehouse stock section. It always belongs to one warehouse, so it is only entered with one
 * selected: "All warehouses" lists each one's figure instead of guessing where a number should go.
 */
export function OpeningStockField({ warehouse, warehouses, onSelectWarehouse, onSaved }: Props) {
  const { rows, loading, refetch } = useOpeningBalances();
  if (loading) return null;
  if (!warehouse) return <AllWarehouses rows={rows} warehouses={warehouses} onSelectWarehouse={onSelectWarehouse} />;
  return (
    <OneWarehouse
      warehouse={warehouse}
      current={rows.find((r) => r.warehouse === warehouse)}
      onSaved={() => { void refetch(); onSaved(); }}
    />
  );
}

function AllWarehouses({ rows, warehouses, onSelectWarehouse }: { rows: OpeningBalanceRow[]; warehouses: string[]; onSelectWarehouse: (warehouse: string) => void }) {
  return (
    <div className={boxCls}>
      <p className="text-[13px] font-bold text-warmstone-900">Opening stock</p>
      <p className="mt-0.5 mb-2 text-[12.5px] text-warmstone-500">Each warehouse has its own. Select a warehouse to set or change it.</p>
      <ul className="space-y-1.5">
        {warehouses.map((name) => {
          const opening = rows.find((r) => r.warehouse === name);
          return (
            <li key={name} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-warmstone-600">
              <span className="font-semibold text-warmstone-800">{name}</span>
              <span>{opening ? summary(opening) : "Not set yet"}</span>
              <button type="button" onClick={() => onSelectWarehouse(name)} className="text-[12.5px] font-semibold text-brand-700 hover:text-brand-800">
                Select
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function OneWarehouse({ warehouse, current, onSaved }: { warehouse: string; current?: OpeningBalanceRow; onSaved: () => void }) {
  const canEdit = useCanEditDirectly();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState({ bags: "", date: todayIso(), remarks: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A correction starts from what is recorded; switching warehouse must not carry another warehouse's figure across.
  useEffect(() => {
    setEditing(false);
    setError(null);
    setV(current ? { bags: String(current.bags), date: current.date ?? todayIso(), remarks: current.remarks ?? "" } : { bags: "", date: todayIso(), remarks: "" });
  }, [current, warehouse]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.setOpeningBalance({ ...v, warehouse });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const showForm = canEdit && (!current || editing);
  const problems = openingBalanceProblems(v);

  return (
    <div className={boxCls}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] text-warmstone-600">
          <span className="font-bold text-warmstone-900">Opening stock, {warehouse}: </span>
          {current ? (
            <>
              {summary(current)}
              {current.remarks ? ` · ${current.remarks}` : ""}
              {current.createdBy ? ` · entered by ${current.createdBy}` : ""}
              {current.updatedBy ? ` · last changed by ${current.updatedBy}` : ""}
            </>
          ) : (
            "not set yet, so the balance starts from 0."
          )}
        </p>
        {current && canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="text-[12px] font-semibold text-brand-700 hover:text-brand-800 whitespace-nowrap">
            Change
          </button>
        )}
      </div>
      {showForm && (
        <form onSubmit={(e) => void save(e)} className="mt-3 space-y-3">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <label className="block">
              <span className={labelCls}>Opening stock (bags) *</span>
              <input inputMode="numeric" value={v.bags} onChange={(e) => setV({ ...v, bags: e.target.value })} className={inputCls} />
            </label>
            <label className="block">
              <span className={labelCls}>Date counted *</span>
              <DateInput value={v.date} onChange={(date) => setV({ ...v, date })} className={inputCls} />
            </label>
            <label className="block">
              <span className={labelCls}>Remarks</span>
              <input value={v.remarks} onChange={(e) => setV({ ...v, remarks: e.target.value })} className={inputCls} />
            </label>
          </div>
          <p className="text-[12px] text-warmstone-500">
            Saved for {warehouse} only. Its running balance starts from this number, including the rows already entered.
            {current && " Changing it moves every balance after it."}
          </p>
          {error && <p role="alert" className="text-[13px] font-medium text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy || problems.length > 0}
              title={problems.join(" ")}
              className="inline-flex items-center px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? "Saving…" : "Save opening stock"}
            </button>
            {editing && (
              <button type="button" onClick={() => setEditing(false)} className="text-[12.5px] font-semibold text-warmstone-600 hover:text-warmstone-800">
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
