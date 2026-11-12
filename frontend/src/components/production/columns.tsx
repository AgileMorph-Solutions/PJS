/**
 * The column kinds every production table is built from, so each table gets the same look and the same filters without
 * writing them again: a date filters by a date range, a kg or a count by a number range, a status or a short text by a
 * checklist (DataTable's own column filters; paging comes with DataTable too). One place to change how kg read, or how
 * a date column filters, for all of Production.
 */
import type { ReactNode } from "react";
import type { Column } from "../ui/DataTable";
import { formatKg } from "./batchUi";
import { formatDate } from "@anagroci/contract/domain/dateFormat";

type Get<T, V> = (row: T) => V;

/**
 * Rows per page in every production table. Smaller than the app's default 25: production tables sit inside a stage,
 * one under another, so a long one would push the next out of sight.
 */
export const PRODUCTION_PAGE_SIZE = 10;

/** A date. Filters by a date range; shows DD/MM/YYYY. */
export function dateCol<T>(label: string, get: Get<T, string | null | undefined>): Column<T> {
  return { label, nowrap: true, filter: { value: get, kind: "date" }, render: (r) => formatDate(get(r) ?? "") || "-" };
}

/** Kilograms. Filters by a number range; `strong` for the column the table is about (a total); `zeroAsDash` where 0 means "none". */
export function kgCol<T>(label: string, get: Get<T, number | null | undefined>, opts: { strong?: boolean; zeroAsDash?: boolean } = {}): Column<T> {
  return {
    label, align: "right", nowrap: true,
    filter: { value: get, kind: "number" },
    render: (r) => {
      const kg = get(r);
      if (kg === null || kg === undefined || Number.isNaN(kg) || (opts.zeroAsDash && kg === 0)) return "-";
      return opts.strong ? <b className="font-semibold">{formatKg(kg)}</b> : formatKg(kg);
    },
  };
}

/** A plain number (bags, nut count, hours). Filters by a number range. */
export function numCol<T>(label: string, get: Get<T, number | null | undefined>, opts: { digits?: number } = {}): Column<T> {
  return {
    label, align: "right", nowrap: true,
    filter: { value: get, kind: "number" },
    render: (r) => {
      const n = get(r);
      return n === null || n === undefined || Number.isNaN(n) ? "-" : n.toLocaleString("en-US", { maximumFractionDigits: opts.digits ?? 2 });
    },
  };
}

/** A percentage. Filters by a number range. */
export function pctCol<T>(label: string, get: Get<T, number | null | undefined>, digits = 2): Column<T> {
  return {
    label, align: "right", nowrap: true,
    filter: { value: get, kind: "number" },
    render: (r) => {
      const n = get(r);
      return n === null || n === undefined || Number.isNaN(n) ? "-" : `${n.toFixed(digits)} %`;
    },
  };
}

/**
 * Text: an ID, a bin, a stream, a name. Filters by a checklist when the column has few distinct values (DataTable
 * decides); `mono` for codes, `strong` for the column that names the row.
 */
export function textCol<T>(label: string, get: Get<T, string | null | undefined>, opts: { mono?: boolean; strong?: boolean; wrap?: boolean } = {}): Column<T> {
  return {
    label, nowrap: !opts.wrap,
    filter: { value: get },
    render: (r) => {
      const v = get(r);
      if (!v) return "-";
      const cls = [opts.mono && "font-mono", opts.strong && "font-semibold"].filter(Boolean).join(" ");
      return cls ? <span className={cls}>{v}</span> : v;
    },
  };
}

/** A status shown as a pill. Filters by a checklist of the words the pill shows. */
export function statusCol<T>(label: string, word: Get<T, string>, pill: (row: T) => ReactNode): Column<T> {
  return { label, nowrap: true, filter: { value: word, kind: "select" }, render: pill };
}
