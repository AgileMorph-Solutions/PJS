/**
 * Production Phase 5: Colour sorting. A camera machine splits the shelled kernels into wholes, pieces, rejection + oil
 * and black rejection. The kg are already in the shelling day record; this phase measures how well the sorter worked
 * (QC-7, a sample before and after it) and sends black rejection to storage for sale. Source: the client's "Production
 * module" document (Oct 2026), Phase 5, and docs/Production/12. Shelled Kernels Quality Report ("Meyer Quality Report").
 */

const num = (v: string | undefined | null): number | null => {
  const t = (v ?? "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const n0 = (v: string | undefined | null) => num(v) || 0;

/** The doc's "stream": what the sample was taken from. Each one goes on to Borma once its after-sorter check is OK. */
export const SORTER_STREAMS = ["Wholes", "Pieces", "Rejection + oil"] as const;
export type SorterStream = (typeof SORTER_STREAMS)[number];

/** The doc's size groups, as the sheet's Sizes column writes them ("A++ to B" 1,276 rows, "BC to E" 1,251). */
export const SORTER_SIZE_GROUPS = ["A++ to B", "BC to E"];

/**
 * The doc's QC-7 formulas. All five were checked against the client's 3,153 samples: rejection, brokens, shell, knife
 * mark (the sheet's "Backcut") and edge cut hold on every row, wholes on all but 14. Wholes is what the rest leaves, so
 * knife marks, edge cuts, uncut and unscoop count inside it, as in the sheet.
 */
export function sorterFigures(v: Record<string, string | undefined>) {
  const sample = n0(v.sampleG);
  const pct = (g: number) => (sample > 0 ? (g / sample) * 100 : 0);
  const rejectionPct = pct(n0(v.rejectionG) + n0(v.oilDirtG));
  const brokensPct = pct(n0(v.brokensG) + n0(v.buttsG));
  const shellPct = pct(n0(v.shellG));
  const parts = ["wholesG", "brokensG", "buttsG", "knifeMarkG", "rejectionG", "oilDirtG", "edgeCutG", "uncutG", "unscoopG", "shellG"].reduce((n, k) => n + n0(v[k]), 0);
  return {
    rejectionPct, brokensPct, shellPct,
    wholesPct: sample > 0 ? 100 - rejectionPct - brokensPct - shellPct : 0,
    knifeMarkPct: pct(n0(v.knifeMarkG)),
    edgeCutPct: pct(n0(v.edgeCutG)),
    errorG: sample - parts,
  };
}

/** Each stream's kg out of the shelling day records: what the sorter split, and so what has to be checked after it. */
export function sorterStreamKg(days: { kg: Partial<Record<string, string>> }[]): Record<SorterStream, number> {
  const sum = (keys: string[]) => Math.round(days.reduce((n, d) => n + keys.reduce((m, k) => m + n0(d.kg[k]), 0), 0) * 100) / 100;
  return { Wholes: sum(["wholesKg"]), Pieces: sum(["piecesKg"]), "Rejection + oil": sum(["rejectionKg", "oilKg"]) };
}

/** A stream's QC-7: "QC-7 = NO: stream is passed through the sorter again", so it is held until a newer check passes it. */
export type SortCheckState = "not_checked" | "waiting" | "ok" | "resort";

export const SORT_CHECK_LABELS: Record<SortCheckState, string> = {
  not_checked: "Not checked yet",
  waiting: "Waiting for approval",
  ok: "OK",
  resort: "Sort again",
};

interface AfterCheck {
  id: number;
  status: string;
  decision: string | null;
  values: Record<string, string | undefined>;
}

export function sortChecks(streams: SorterStream[], after: AfterCheck[]): Record<string, SortCheckState> {
  const newestFirst = [...after].filter((c) => c.status !== "rejected").sort((a, b) => b.id - a.id);
  return Object.fromEntries(streams.map((s) => {
    const mine = newestFirst.filter((c) => c.values.stream === s);
    if (mine[0]?.status === "submitted") return [s, "waiting"];
    const decided = mine.find((c) => c.status === "approved");
    return [s, !decided ? "not_checked" : decided.decision === "ok" ? "ok" : "resort"];
  }));
}

/** Colour sorted once every stream that has kg passed its check after the sorter. */
export const isColourSorted = (streams: SorterStream[], checks: Record<string, SortCheckState>): boolean =>
  streams.length > 0 && streams.every((s) => checks[s] === "ok");

export interface SortComparison {
  stream: string;
  sizes: string;
  before: ReturnType<typeof sorterFigures> | null;
  after: ReturnType<typeof sorterFigures> | null;
}

/**
 * The doc's step 3, "Compare: % per defect, before vs after": each stream and size group's newest approved sample on
 * either side of the sorter, side by side. A side with no sample yet is null.
 */
export function sorterComparison(samples: { id: number; kind: string; status: string; values: Record<string, string | undefined> }[]): SortComparison[] {
  // A Lot's records hold every kind; only the sorter's samples belong here.
  const usable = samples.filter((s) => s.status === "approved" && (s.kind === "qc7_before" || s.kind === "qc7_after")).sort((a, b) => b.id - a.id);
  const keys = [...new Set(usable.map((s) => `${s.values.stream ?? ""}|${s.values.sizes ?? ""}`))];
  return keys.map((key) => {
    const [stream, sizes] = key.split("|") as [string, string];
    const newest = (kind: string) => usable.find((s) => s.kind === kind && `${s.values.stream ?? ""}|${s.values.sizes ?? ""}` === key);
    const b = newest("qc7_before");
    const a = newest("qc7_after");
    return { stream, sizes, before: b ? sorterFigures(b.values) : null, after: a ? sorterFigures(a.values) : null };
  }).sort((x, y) => SORTER_STREAMS.indexOf(x.stream as SorterStream) - SORTER_STREAMS.indexOf(y.stream as SorterStream) || x.sizes.localeCompare(y.sizes));
}

export type ColourSortStep = "before" | "after" | "none";

/** The one job to point this person at, for a shelled Lot. Re-sorting is the floor's; its new sample is the QFS Officer's. */
export function nextColourSortStep(v: { canCheck: boolean; beforeSamples: number; streams: SorterStream[]; checks: Record<string, SortCheckState> }): ColourSortStep {
  if (!v.canCheck) return "none";
  if (v.beforeSamples === 0) return "before";
  if (v.streams.some((s) => v.checks[s] === "not_checked" || v.checks[s] === "resort")) return "after";
  return "none";
}
