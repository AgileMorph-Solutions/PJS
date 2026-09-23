import { useEffect, useState } from "react";
import { Pill } from "./ui/Pill";
import { api, ApiError } from "../repository/api";
import type { ImporterTypeInfo, PreviewImportResponse, CommitImportResponse } from "../repository/api";

const btnPrimary =
  "inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold transition-all shadow-sm disabled:opacity-40 disabled:pointer-events-none";

const SEVERITY_TONE: Record<string, string> = { critical: "gap", warning: "decision", info: "system" };

/** The shape of ImportRejectedError's `detail` — a HeaderCheckResult, when the rejection was a
 * shape mismatch rather than "not an .xlsx file at all". Narrowed defensively since it's opaque
 * `unknown` on the wire. */
function asHeaderMismatch(detail: unknown): { expectedSheet: string; expected?: string[]; found?: string[]; foundSheets?: string[] } | null {
  if (detail && typeof detail === "object" && "expectedSheet" in detail) return detail as any;
  return null;
}

interface ImportPanelProps {
  /** Which of the 4 registered shapes (backend/src/domain/imports/registry.ts) this panel accepts
   * — each lives embedded on the one page that shape's rows land on, so there's no shape picker
   * here, unlike the old standalone Import Data page. */
  importerId: string;
  /** Called after a successful commit, so the host page can refresh its own data (e.g. a
   * TrackingContext `refresh()`) instead of relying on a full reload. */
  onCommitted?: (result: CommitImportResponse) => void;
}

/** The upload → preview → commit flow for one workbook shape, embedded in a CollapsibleCard on
 * the page that shape's rows land on — see ReceiptsListPage, DryingJobsPage, WarehouseStockPage,
 * WarehouseTransfersPage. Fetches /imports/types itself (rather than taking the expected sheet
 * name / example filename as props) so this stays the one place that data comes from — the
 * backend registry, not a copy hand-typed onto 4 pages that could drift from it. */
export function ImportPanel({ importerId, onCommitted }: ImportPanelProps) {
  const [typeInfo, setTypeInfo] = useState<ImporterTypeInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewImportResponse | null>(null);
  const [previewError, setPreviewError] = useState<ApiError | null>(null);

  const [skipFlagged, setSkipFlagged] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<CommitImportResponse | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);

  useEffect(() => {
    api.listImporterTypes()
      .then((types) => setTypeInfo(types.find((t) => t.id === importerId) ?? null))
      .catch(() => {});
  }, [importerId]);

  function reset(nextFile: File | null) {
    setFile(nextFile);
    setPreview(null);
    setPreviewError(null);
    setCommitResult(null);
    setCommitError(null);
  }

  async function runPreview() {
    if (!file) return;
    setPreviewing(true);
    setPreview(null);
    setPreviewError(null);
    setCommitResult(null);
    setCommitError(null);
    try {
      setPreview(await api.previewImport(file, importerId));
    } catch (e) {
      setPreviewError(e instanceof ApiError ? e : new ApiError(String(e), 0));
    } finally {
      setPreviewing(false);
    }
  }

  async function runCommit() {
    if (!preview) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const result = await api.commitImport(preview.token, skipFlagged);
      setCommitResult(result);
      onCommitted?.(result);
    } catch (e) {
      setCommitError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setCommitting(false);
    }
  }

  const mismatch = previewError ? asHeaderMismatch(previewError.detail) : null;

  return (
    <div className="space-y-4">
      {typeInfo && (
        <p className="text-[12.5px] text-warmstone-500">
          Accepts a <span className="font-semibold text-warmstone-700">{typeInfo.label}</span> workbook — a sheet
          named <code className="font-mono text-warmstone-700">{typeInfo.expectedSheet}</code>, e.g.{" "}
          <code className="font-mono text-warmstone-700">{typeInfo.exampleFilename}</code>.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex-1 min-w-60">
          <span className="block text-[11px] font-bold text-warmstone-500 uppercase tracking-wider mb-1.5">Workbook (.xlsx)</span>
          <input
            type="file"
            accept=".xlsx"
            onChange={(e) => reset(e.target.files?.[0] ?? null)}
            className="block w-full text-[13px] text-warmstone-700 file:mr-3 file:px-4 file:py-2 file:rounded-xl file:border-0 file:bg-warmstone-100 file:text-warmstone-700 file:text-[13px] file:font-semibold hover:file:bg-warmstone-200 file:cursor-pointer"
          />
        </label>

        <button className={btnPrimary} disabled={!file || previewing} onClick={runPreview}>
          <span className="material-symbols-outlined text-[16px]">{previewing ? "hourglass_top" : "search"}</span>
          {previewing ? "Reading…" : "Preview"}
        </button>
      </div>

      {previewError && (
        <div className="rounded-xl border border-danger-200 bg-danger-50 p-4 text-[13px] text-danger-800 space-y-2">
          <p className="font-semibold">{previewError.message}</p>
          {mismatch?.foundSheets && (
            <p>
              Expected a sheet named <code className="font-mono">{mismatch.expectedSheet}</code>. Sheets in this file:{" "}
              {mismatch.foundSheets.join(", ") || "(none)"}.
            </p>
          )}
          {mismatch?.expected && mismatch?.found && (
            <div className="space-y-1">
              <p>The header row doesn't match what this shape expects. Nothing was written.</p>
              <div className="grid grid-cols-2 gap-3 font-mono text-[11.5px] bg-white rounded-lg border border-danger-100 p-3">
                <div>
                  <p className="font-sans font-bold not-italic mb-1 text-warmstone-500">Expected</p>
                  {mismatch.expected.map((c, i) => (
                    <div key={i} className={c !== mismatch.found![i] ? "text-danger-700 font-bold" : ""}>{c || "(blank)"}</div>
                  ))}
                </div>
                <div>
                  <p className="font-sans font-bold not-italic mb-1 text-warmstone-500">Found</p>
                  {mismatch.found.map((c, i) => (
                    <div key={i} className={c !== mismatch.expected![i] ? "text-danger-700 font-bold" : ""}>{c || "(blank)"}</div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {preview && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-bold text-warmstone-900">{preview.label}</h3>
              <p className="text-[13px] text-warmstone-500 mt-0.5">
                {preview.rowCount} row{preview.rowCount === 1 ? "" : "s"} parsed
                {preview.skippedCount > 0 && ` · ${preview.skippedCount} skipped (blank/invalid)`}
                {preview.duplicateCount > 0 && ` · ${preview.duplicateCount} look like duplicates of existing data`}
              </p>
            </div>
            {!commitResult && (
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-[13px] text-warmstone-700 select-none cursor-pointer">
                  <input type="checkbox" checked={skipFlagged} onChange={(e) => setSkipFlagged(e.target.checked)} className="accent-brand-700" />
                  Skip rows that look like duplicates
                </label>
                <button className={btnPrimary} onClick={runCommit} disabled={committing}>
                  <span className="material-symbols-outlined text-[16px]">{committing ? "hourglass_top" : "publish"}</span>
                  {committing ? "Writing…" : "Commit"}
                </button>
              </div>
            )}
          </div>

          {preview.findings.length > 0 && (
            <div className="space-y-2">
              {preview.findings.map((f) => (
                <div key={f.id} className="rounded-xl border border-warmstone-200 p-3.5 text-[13px]">
                  <div className="flex items-center gap-2 mb-1">
                    <Pill tone={SEVERITY_TONE[f.severity] ?? "system"} label={f.severity} />
                    <span className="font-semibold text-warmstone-900">{f.title}</span>
                    <span className="text-warmstone-400">· {f.affectedCount} row{f.affectedCount === 1 ? "" : "s"}</span>
                  </div>
                  <p className="text-warmstone-600 leading-relaxed">{f.evidence}</p>
                  {f.sampleIds.length > 0 && (
                    <p className="text-warmstone-400 mt-1 font-mono text-[11.5px]">{f.sampleIds.join(" · ")}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {preview.sampleRows.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-warmstone-200">
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr className="border-b border-warmstone-200 bg-warmstone-50">
                    {Object.keys(preview.sampleRows[0] as object).map((k) => (
                      <th key={k} className="text-left px-3 py-2 font-bold uppercase tracking-wider text-warmstone-500 whitespace-nowrap text-[10.5px]">{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sampleRows.map((row, i) => (
                    <tr key={i} className="border-b border-warmstone-100 last:border-0">
                      {Object.entries(row as Record<string, unknown>).map(([k, v]) => (
                        <td key={k} className="px-3 py-2 text-warmstone-700 whitespace-nowrap max-w-55 overflow-hidden text-ellipsis">
                          {typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "—")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-warmstone-400 px-3 py-2">Showing the first {preview.sampleRows.length} of {preview.rowCount} rows.</p>
            </div>
          )}

          {commitResult && (
            <div className="rounded-xl border border-success-200 bg-success-50 p-4 text-[13px] text-success-800">
              <p className="font-semibold">
                {commitResult.created} row{commitResult.created === 1 ? "" : "s"} written
                {commitResult.skippedDuplicates > 0 && ` · ${commitResult.skippedDuplicates} duplicate${commitResult.skippedDuplicates === 1 ? "" : "s"} skipped`}
                {commitResult.skippedInvalid > 0 && ` · ${commitResult.skippedInvalid} invalid row${commitResult.skippedInvalid === 1 ? "" : "s"} skipped`}
              </p>
            </div>
          )}
          {commitError && (
            <div className="rounded-xl border border-danger-200 bg-danger-50 p-4 text-[13px] text-danger-800">{commitError}</div>
          )}
        </div>
      )}
    </div>
  );
}
