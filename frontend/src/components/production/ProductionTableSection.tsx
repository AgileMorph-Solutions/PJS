import { useEffect, useState } from "react";
import { CollapsibleCard } from "../ui/CollapsibleCard";
import { DataTable, type Column } from "../ui/DataTable";
import { ProductionRowForm } from "./ProductionRowForm";

interface Field { n: string; v: string; col: string }
interface Row { id?: string; [key: string]: unknown }

interface BodyProps {
  title: string;
  fields: Field[];
  idPrefix: string;
  /** Fetches existing rows for this table — real seeded/uploaded history, not a placeholder. */
  load: () => Promise<Row[]>;
  onSubmit: (values: Record<string, string>) => Promise<void>;
  submitLabel: string;
  /** Reported up so a caller (e.g. ProductionStageAccordion) can show "N rows" without its own fetch. */
  onLoaded?: (count: number) => void;
}

/** The content half of a production table's UI: a real DataTable of existing rows (driven by the
 * table's own field dictionary, no hand-typed columns) plus an "Add a row" form below it. No
 * wrapper of its own — used both standalone (ProductionTableSection, below) and as one step's body
 * inside ProductionStageAccordion, so the same fetch/render logic isn't duplicated between them. */
export function ProductionTableBody({ fields, idPrefix, load, onSubmit, submitLabel, onLoaded }: BodyProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    load()
      .then((r) => { if (alive) { setRows(r); onLoaded?.(r.length); } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idPrefix]);

  const columns: Column<Row>[] = fields.map((f) => ({
    label: f.n,
    render: (row) => {
      const v = row[f.col];
      return v === null || v === undefined || v === "" ? "—" : String(v);
    },
  }));

  return (
    <div className="space-y-4">
      {error && <p className="text-[12.5px] text-danger-700">{error}</p>}
      {loading && <p className="text-[12.5px] text-warmstone-400">Loading…</p>}
      {!loading && rows.length > 0 && (
        <div className="max-h-96 overflow-y-auto">
          <DataTable columns={columns} rows={rows} keyFn={(r) => String(r.id ?? JSON.stringify(r))} emptyTitle="No rows" />
        </div>
      )}
      <details className="text-[13px]">
        <summary className="cursor-pointer font-semibold text-warmstone-600 hover:text-brand-700">Add a row</summary>
        <div className="mt-3">
          <ProductionRowForm idPrefix={idPrefix} fields={fields} submitLabel={submitLabel} onSubmit={onSubmit} />
        </div>
      </details>
    </div>
  );
}

/** ProductionTableBody wrapped in the app's standard collapsible card — for pages that just need
 * one table shown on its own (the standalone tracker pages), not inside a bigger stage accordion. */
export function ProductionTableSection(props: BodyProps & { meta?: string }) {
  const [count, setCount] = useState<number | null>(null);
  return (
    <CollapsibleCard title={props.title} meta={props.meta ?? (count === null ? undefined : `${count} row${count === 1 ? "" : "s"}`)}>
      <ProductionTableBody {...props} onLoaded={setCount} />
    </CollapsibleCard>
  );
}
