import { SearchSelect } from "../ui/SearchSelect";

interface Props {
  value: string;
  onChange: (warehouse: string) => void;
  warehouses: string[];
}

/**
 * Narrows a jute page to one warehouse of the master, or shows them all: the shared searchable dropdown (26 Nov 2026), empty
 * for "All warehouses" and cleared with its × to go back to them.
 */
export function WarehouseFilter({ value, onChange, warehouses }: Props) {
  return (
    <div className="w-56">
      <SearchSelect id="jute-warehouse-filter" aria-label="Warehouse" value={value} options={warehouses} onChange={onChange} placeholder="All warehouses" />
    </div>
  );
}
