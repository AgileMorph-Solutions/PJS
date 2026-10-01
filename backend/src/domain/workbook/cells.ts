/**
 * Cell <-> database value, both directions, for the ANAGROCI workbook.
 *
 * The property everything else leans on: a value written by `serializeCell` and read back by
 * `parseCell` compares EQUAL (by `canonical`) to what was in the database — so exporting a section
 * and uploading the file unchanged finds nothing to write. Nothing here coerces or "fixes" data:
 * a value that doesn't fit its column's type is reported, never guessed at (a French decimal comma,
 * a day-first date, a number where a date belongs).
 */
import { Prisma } from "@prisma/client";

// ── Writing ──────────────────────────────────────────────────────────────────────────────────────

/** Prisma.Decimal/Date/BigInt -> a plain cell value ExcelJS can write, never coerced to a number
 * that would lose precision (Decimal becomes text). A Date at exactly midnight UTC is a calendar
 * date, anything else is a real timestamp and keeps its time. */
export function serializeCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Prisma.Decimal) return value.toString();
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

// ── Reading ──────────────────────────────────────────────────────────────────────────────────────

/** ExcelJS hands back a union of shapes; reduce it to a plain string/number/boolean/Date/null. */
export function cellToPlain(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((t) => t.text ?? "").join("");
    if ("result" in o) return cellToPlain(o.result);                  // formula: the value it computed
    if (typeof o.text === "string" && "hyperlink" in o) return o.text; // hyperlink: the label
    if ("error" in o) return { error: String(o.error) };              // #N/A, #REF!, …
  }
  return String(v);
}

export type ParsedCell = { ok: true; value: unknown } | { ok: false; error: string };

const DECIMAL_RE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const INT_RE = /^-?\d+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INT4_MAX = 2_147_483_647;

/** A blank is exactly "" or null. Whitespace-only text is a real (if odd) value, kept as-is, so a
 * string the database holds survives the round trip untouched. */
const isBlank = (v: unknown) => v === null || v === undefined || v === "";

export function parseCell(raw: unknown, type: string): ParsedCell {
  const v = cellToPlain(raw);
  if (v && typeof v === "object" && !(v instanceof Date) && "error" in (v as object)) {
    return { ok: false, error: `the cell holds an Excel error (${(v as { error: string }).error})` };
  }
  if (isBlank(v)) return { ok: true, value: null };

  switch (type) {
    case "String":
      if (typeof v === "string") return { ok: true, value: v };
      if (v instanceof Date) return { ok: true, value: v.toISOString().slice(0, 10) };
      return { ok: true, value: String(v) };

    case "Int": {
      const n = typeof v === "number" ? v : typeof v === "string" && INT_RE.test(v.trim()) ? Number(v.trim()) : NaN;
      if (!Number.isInteger(n)) return { ok: false, error: `"${String(v)}" isn't a whole number` };
      if (Math.abs(n) > INT4_MAX) return { ok: false, error: `${n} is too large for this column` };
      return { ok: true, value: n };
    }

    case "Float": {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: `"${String(v)}" isn't a number` };
    }

    case "Decimal": {
      // Text and numbers both become a Decimal from their decimal text, so nothing passes through a
      // lossy double. A comma decimal ("44,94") is refused rather than reinterpreted.
      const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
      return DECIMAL_RE.test(s) ? { ok: true, value: new Prisma.Decimal(s) } : { ok: false, error: `"${String(v)}" isn't a number (use a decimal point)` };
    }

    case "DateTime": {
      if (v instanceof Date) return Number.isNaN(v.getTime()) ? { ok: false, error: "not a valid date" } : { ok: true, value: v };
      if (typeof v === "string") {
        const s = v.trim();
        const d = ISO_DATE_RE.test(s) ? new Date(`${s}T00:00:00Z`) : new Date(s);
        // Re-serialising catches rollovers ("2026-02-31" silently becoming 3 March).
        const real = !Number.isNaN(d.getTime()) && (!ISO_DATE_RE.test(s) || d.toISOString().slice(0, 10) === s) && /^\d{4}-\d{2}-\d{2}/.test(s);
        if (real) return { ok: true, value: d };
      }
      return { ok: false, error: `"${String(v)}" isn't a date (use YYYY-MM-DD)` };
    }

    case "Boolean":
      if (typeof v === "boolean") return { ok: true, value: v };
      if (typeof v === "string" && /^(true|false)$/i.test(v.trim())) return { ok: true, value: v.trim().toLowerCase() === "true" };
      return { ok: false, error: `"${String(v)}" isn't TRUE or FALSE` };

    default:
      return { ok: false, error: `columns of type ${type} can't be set from a workbook` };
  }
}

/** A database value (or a parsed cell) as a comparable string: null and "" are the same blank, a
 * Decimal compares by value (5.250 = 5.25), a date-only Date by its calendar date. */
export function canonical(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Prisma.Decimal) return value.toString();
  if (value instanceof Date) return serializeCell(value) as string;
  return String(value);
}
