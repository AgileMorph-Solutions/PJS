import { useMemo, useState, type FormEvent } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { FilterBar } from "../../components/ui/FilterBar";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { usePagination } from "../../components/ui/usePagination";
import { Pagination } from "../../components/ui/Pagination";
import { useTracking } from "../../state/TrackingContext";
import { api } from "../../repository/api";
import { findSimilarOrigin, normalizeOriginName } from "@anagroci/contract/domain/origin";

const inputCls =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";

/** Where an Origin came from, in words: the curated list, a workbook it was seen in, an upload, or added here. */
function sourceLabel(source: string | null | undefined): string {
  if (!source) return "";
  if (source === "entered") return "Added in the app";
  if (source === "seed/origins.json") return "Origins list";
  return source.startsWith("upload: ") ? `Seen in upload ${source.slice(8)}` : `Seen in ${source}`;
}

export function OriginsPage() {
  const { masters, receipts, refresh } = useTracking();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const infoOf = useMemo(() => new Map((masters.originInfo ?? []).map((o) => [o.name, o])), [masters.originInfo]);
  const trucksFrom = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of receipts) if (r.origin) counts.set(r.origin, (counts.get(r.origin) ?? 0) + 1);
    return counts;
  }, [receipts]);
  const search = useTableSearch(masters.origins, (o) => [o, sourceLabel(infoOf.get(o)?.source)]);
  const page = usePagination(search.filtered);
  // Said before saving, so nobody adds a second spelling of a town that's already there (the server refuses it too).
  const typed = normalizeOriginName(name);
  const similar = typed ? findSimilarOrigin(typed, masters.origins) : undefined;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null); setNotice(null);
    try {
      await api.createOrigin(name);
      await refresh();
      setNotice(`Origin ${typed} added.`);
      setName("");
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Masters"
        title="Origins"
        lede="The town the RCN comes from. Delivery plans and trucks pick their origin from this list."
      />
      <CollapsibleCard title="Add origin">
        <form onSubmit={(e) => void handleSubmit(e)} className="grid sm:grid-cols-[1fr_auto] gap-4 items-end">
          <div>
            <label htmlFor="origin-name" className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">Origin name</label>
            <input id="origin-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. KORHOGO" className={inputCls} />
          </div>
          <button type="submit" disabled={saving || !typed || Boolean(similar)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white text-[13px] font-bold transition-all shadow-sm">
            <span className="material-symbols-outlined text-[17px]">add</span>
            Add origin
          </button>
        </form>
        {similar && (
          <p className="mt-3 text-[13px] font-semibold text-ambernut-700">
            {similar === typed ? `${similar} is already in the list.` : `${similar} is already in the list and looks like the same town. Use ${similar}.`}
          </p>
        )}
        {error && <p role="alert" className="mt-3 text-[13px] text-danger-700">{error}</p>}
        {notice && <p className="mt-3 text-[13px] text-success-700">{notice}</p>}
      </CollapsibleCard>
      <FilterBar>
        <input
          placeholder="Search origin…"
          value={search.q}
          onChange={(e) => search.setQ(e.target.value)}
          className="w-full sm:w-64"
        />
      </FilterBar>
      <div className="bg-white border border-warmstone-200 rounded-2xl shadow-xs divide-y divide-warmstone-100">
        {page.pageRows.map((o) => (
          <div key={o} className="flex items-center justify-between gap-4 px-5 py-3 text-[13px]">
            <span className="font-semibold text-warmstone-800 flex items-center gap-2">
              <span className="material-symbols-outlined text-[17px] text-brand-700">location_on</span>
              {o}
              {sourceLabel(infoOf.get(o)?.source) && <span className="font-normal text-[12px] text-warmstone-400">· {sourceLabel(infoOf.get(o)?.source)}</span>}
            </span>
            <span className="text-warmstone-500 tabular-nums">{trucksFrom.get(o) ?? 0} trucks</span>
          </div>
        ))}
        <Pagination state={page} />
      </div>
    </div>
  );
}
