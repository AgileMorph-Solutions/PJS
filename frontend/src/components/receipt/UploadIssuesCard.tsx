import { useCallback, useEffect, useState } from "react";
import { api } from "../../repository/api";
import type { UploadIssueRecord } from "../../types/receipt";

/**
 * What an Excel upload flagged in this truck's row. The upload went through unchanged; this only
 * says what looked wrong, and "Mark reviewed" says someone has seen it. Nothing here edits the data.
 */
export function UploadIssuesCard({ receiptId }: { receiptId: string }) {
  const [issues, setIssues] = useState<UploadIssueRecord[] | null>(null);
  const load = useCallback(() => api.listUploadIssues(receiptId).then(setIssues).catch(() => setIssues([])), [receiptId]);
  useEffect(() => { void load(); }, [load]);

  if (!issues?.length) return null; // nothing flagged, nothing to show
  const open = issues.filter((i) => !i.reviewedAt);

  return (
    <section className="bg-white border border-ambernut-200 rounded-2xl shadow-xs p-5">
      <h2 className="text-base font-bold text-warmstone-900 flex items-center gap-2 mb-1">
        <span className="material-symbols-outlined text-[19px] text-ambernut-700">rule</span>
        Checks from the Excel upload
      </h2>
      <p className="text-[12.5px] text-warmstone-500 mb-3">
        {open.length ? `${open.length} to look at` : "All reviewed"}. The upload was accepted as it was; these are things that look wrong.
      </p>
      <ul className="space-y-2">
        {issues.map((i) => (
          <li key={i.id} className={`flex items-start justify-between gap-3 text-[13px] ${i.reviewedAt ? "text-warmstone-400" : "text-warmstone-800"}`}>
            <span>
              {i.column && <span className="font-semibold">{i.column}: </span>}{i.message}
              <span className="block text-[11.5px] text-warmstone-400">{i.filename} · {i.sheet} · row {i.row}{i.uploadedBy ? ` · ${i.uploadedBy}` : ""}</span>
            </span>
            {i.reviewedAt
              ? <span className="text-[11.5px] whitespace-nowrap">Reviewed{i.reviewedBy ? ` by ${i.reviewedBy}` : ""}</span>
              : <button type="button" onClick={() => void api.reviewUploadIssue(receiptId, i.id).then(load)} className="text-[11.5px] font-semibold text-brand-700 hover:text-brand-800 whitespace-nowrap">Mark reviewed</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}
