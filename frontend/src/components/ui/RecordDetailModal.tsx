import { Modal } from "./Modal";

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Human-readable label from a camelCase Prisma column name — the same kind of transform
 * `stages.ts`'s `col`/`n` split exists to avoid needing elsewhere, but these tables (WarehouseDischarge,
 * IssuedToProduction, ...) have no `stages.ts`-style label dictionary of their own, so this is the
 * pragmatic fallback rather than hand-typing ~60 labels per table. */
function labelFromKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Every field of one record, as a plain label/value list — the generic "show me everything this
 * row has" escape hatch for tables too wide to put on screen as `DataTable` columns (WarehouseDischarge,
 * DryingBatch, ledger-shaped tables, ...). Reuses `Modal` rather than a bespoke dialog.
 */
export function RecordDetailModal<T extends object>({
  title,
  record,
  omit = ["id"],
  onClose,
}: {
  title: string;
  record: T;
  /** Keys to leave out — surrogate ids and similar plumbing that carries no operational meaning. */
  omit?: string[];
  onClose: () => void;
}) {
  const entries = Object.entries(record).filter(([k]) => !omit.includes(k));
  return (
    <Modal title={title} onClose={onClose}>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 max-h-[70vh] overflow-y-auto pr-1">
        {entries.map(([key, value]) => (
          <div key={key} className="min-w-0">
            <dt className="text-[10.5px] font-bold uppercase tracking-wider text-warmstone-400">{labelFromKey(key)}</dt>
            <dd className="text-[13px] text-warmstone-800 break-words">{formatValue(value)}</dd>
          </div>
        ))}
        {entries.length === 0 && <p className="text-[12.5px] text-warmstone-400">No fields to show.</p>}
      </dl>
    </Modal>
  );
}
