import { useParams } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { ProductionTableSection } from "../../components/production/ProductionTableSection";
import { api } from "../../repository/api";
import { productionTableById } from "@anagroci/contract/data/productionTables";

/** One page, parameterized by :tableId, for every standalone production table (no Lot/BTM/Bin
 * column — shell-dispatch, waste-dispatch, boiler-consumption, wip-stock-report). A new standalone
 * table is a nav.ts entry, not a new page file. */
export function StandaloneTablePage() {
  const { tableId } = useParams<{ tableId: string }>();
  const table = tableId ? productionTableById[tableId] : undefined;

  if (!table || table.spine !== "standalone") {
    return <div className="p-10 text-warmstone-400 text-sm">Unknown production table "{tableId}".</div>;
  }

  return (
    <div className="space-y-5">
      <PageHeader kicker="Production" title={table.model.replace(/([a-z])([A-Z])/g, "$1 $2")} lede={`Source: ${table.sourceNodeIds.join(", ")}`} />
      <ProductionTableSection
        idPrefix={tableId!}
        title="Records"
        fields={table.fields}
        load={() => api.listStandaloneTable(tableId!)}
        submitLabel="Add row"
        onSubmit={async (values) => {
          await api.addStandaloneRow(tableId!, values);
        }}
      />
    </div>
  );
}
