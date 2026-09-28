import { useState } from "react";

/** Free-text, multi-field client-side search — the one piece every list-table page needs before
 * handing rows to `DataTable` (which paginates but never filters). `fields` picks which columns
 * of a row are searchable; each page decides that for itself, this just does the lowercase
 * multi-field `includes()` match generically instead of every page re-writing it. */
export function useTableSearch<T>(rows: T[], fields: (row: T) => (string | null | undefined)[]) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = needle ? rows.filter((r) => fields(r).some((f) => f?.toLowerCase().includes(needle))) : rows;
  return { q, setQ, filtered };
}
