interface Props {
  value: string;
  onChange: (warehouse: string) => void;
  warehouses: string[];
}

/** Narrows a jute page to one warehouse of the master, or shows them all. */
export function WarehouseFilter({ value, onChange, warehouses }: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Warehouse"
      className="px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] font-semibold text-warmstone-800 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700"
    >
      <option value="">All warehouses</option>
      {warehouses.map((w) => <option key={w} value={w}>{w}</option>)}
    </select>
  );
}
