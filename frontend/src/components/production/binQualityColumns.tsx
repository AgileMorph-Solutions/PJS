import { binQuality, type LotInBin } from "@anagroci/contract/domain/productionBatch";
import { numCol } from "./columns";
import type { Column } from "../ui/DataTable";

const fmt = (n: number, digits: number) => n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/**
 * A Bin's moisture and KOR in place of its trucks (26 Nov 2026, user: "if we have moisture and KOR display that, we don't need
 * truck information"). The average of its Lots' latest readings by kg (contract binQuality), with the lowest–highest Lot under
 * it, since a Bin mixes Lots; "-" when no Lot in it has a reading. Filterable as numbers, like every production column.
 */
export function binQualityColumns<T>(lotsOf: (row: T) => readonly LotInBin[]): Column<T>[] {
  const cell = (row: T, key: "moisture" | "kor", unit: string, digits: number) => {
    const q = binQuality(lotsOf(row));
    const avg = q[key];
    const range = key === "moisture" ? q.moistureRange : q.korRange;
    if (avg === null) return <span className="text-warmstone-500">-</span>;
    return (
      <span className="leading-snug">
        <span className="block font-semibold text-warmstone-900">{fmt(avg, digits)}{unit}</span>
        {range && range[0] !== range[1] && <span className="block text-[11px] text-warmstone-500">{fmt(range[0], digits)}–{fmt(range[1], digits)}{unit}</span>}
        {q.measured < q.lots && <span className="block text-[11px] text-warmstone-500">{q.measured} of {q.lots} Lots measured</span>}
      </span>
    );
  };
  return [
    { ...numCol<T>("Moisture", (r) => binQuality(lotsOf(r)).moisture), render: (r) => cell(r, "moisture", " %", 1) },
    { ...numCol<T>("KOR", (r) => binQuality(lotsOf(r)).kor), render: (r) => cell(r, "kor", " lbs", 2) },
  ];
}

/** One Lot's reading, for the run's Lots table. */
export function lotQualityColumns<T extends Pick<LotInBin, "moisture" | "kor">>(): Column<T>[] {
  return [
    { ...numCol<T>("Moisture", (l) => l.moisture), render: (l) => (l.moisture === undefined ? "-" : `${fmt(l.moisture, 1)} %`) },
    { ...numCol<T>("KOR", (l) => l.kor), render: (l) => (l.kor === undefined ? "-" : `${fmt(l.kor, 2)} lbs`) },
  ];
}
