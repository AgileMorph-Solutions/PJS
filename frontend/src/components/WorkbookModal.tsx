import { useEffect, useRef, useState } from "react";
import { Modal } from "./ui/Modal";
import { DateRangeInputs, type DateRange } from "./ui/DateRangeInputs";
import { api, ApiError } from "../repository/api";
import type { WorkbookCommitResult, WorkbookInfo, WorkbookPreview } from "../repository/api";

interface Props {
  /** "export" downloads the workbook; "upload" takes the same file back. One format, both ways. */
  mode: "upload" | "export";
  /** The section's warehouse (a site name). A Warehouse Incharge's is pinned to their own by the API. */
  warehouse: string;
  /** Shown in the dialog, e.g. "Unit / Regional Warehouse · Bouaké". */
  sectionLabel: string;
  onClose: () => void;
  /** After an upload is applied, so the host page can refresh its data. */
  onCommitted?: (result: WorkbookCommitResult) => void;
}

const ghostBtn =
  "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-warmstone-200 text-warmstone-700 text-[12.5px] font-semibold hover:bg-warmstone-50 hover:border-warmstone-300 transition-colors whitespace-nowrap disabled:opacity-50";
const primaryBtn =
  "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold transition-all shadow-sm disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap";

/** Saves a fetched file through a temporary link — the browser's own download, no new tab. */
function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The Reception/Drying/Lots/Jute pages' Export and Upload dialogs. There is ONE file format — the
 * ANAGROCI workbook, one sheet per kind of record — and these are its two ends: Export downloads
 * it, Upload takes it back (and offers a blank copy). It differs only by section: which sheets it
 * carries and whose rows it holds (this warehouse's), both decided by the API.
 */
export function WorkbookModal({ mode, warehouse, sectionLabel, onClose, onCommitted }: Props) {
  return (
    <Modal title={mode === "upload" ? "Upload workbook" : "Export workbook"} onClose={onClose} wide={mode === "upload"}>
      {mode === "export" ? (
        <>
          <p className="text-[12.5px] text-warmstone-500 mb-4">
            The Excel file for <span className="font-semibold text-warmstone-800">{sectionLabel}</span>, with one sheet for each kind of
            record. You can edit it and upload it again - the same file works both ways.
          </p>
          <ExportBody warehouse={warehouse} />
        </>
      ) : (
        <UploadBody warehouse={warehouse} sectionLabel={sectionLabel} onCommitted={onCommitted} />
      )}
    </Modal>
  );
}

function useInfo(warehouse: string) {
  const [info, setInfo] = useState<WorkbookInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.workbookInfo(warehouse).then(setInfo).catch((e) => setError(msgOf(e)));
  }, [warehouse]);
  return { info, error };
}

function SheetChips({ info }: { info: WorkbookInfo }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {info.sheets.map((s) => (
        <span key={s.name} className="px-2 py-0.5 rounded-md bg-warmstone-100 border border-warmstone-200 text-[11.5px] font-medium text-warmstone-700">
          {s.name}
        </span>
      ))}
    </div>
  );
}

function ExportBody({ warehouse }: { warehouse: string }) {
  const { info, error: infoError } = useInfo(warehouse);
  const [range, setRange] = useState<DateRange>({ from: "", to: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ exported: number; withoutDate: number } | null>(null);

  const inverted = Boolean(range.from && range.to && range.from > range.to);
  const hasRange = Boolean(range.from || range.to);
  const dated = info?.sheets.filter((s) => s.dateLabel) ?? [];

  async function download() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { blob, filename, exported, withoutDate } = await api.downloadWorkbook(warehouse, { from: range.from, to: range.to });
      saveFile(blob, filename);
      setResult({ exported, withoutDate });
    } catch (e) {
      setError(msgOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (infoError) return <p role="alert" className="text-[12.5px] font-medium text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{infoError}</p>;
  if (!info) return <p className="text-[12.5px] text-warmstone-400 animate-pulse">Loading…</p>;

  return (
    <div className="space-y-4">
      <div>
        <span className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">Sheets in this workbook · {info.sheets.length}</span>
        <SheetChips info={info} />
      </div>

      <div>
        <span className="block text-[12.5px] font-semibold text-warmstone-700 mb-1.5">
          Date range <span className="font-normal text-warmstone-500">· optional</span>
        </span>
        {/* DateRangeInputs is styled by its parent (see FilterBar); these are the same rules. */}
        <div className="[&_input]:px-3 [&_input]:py-2 [&_input]:rounded-xl [&_input]:border [&_input]:border-warmstone-200 [&_input]:bg-warmstone-50 [&_input]:text-[13px] [&_input]:text-warmstone-900 [&_input]:outline-none [&_input]:focus:border-brand-700 [&_input]:focus:bg-white [&_input]:focus:ring-1 [&_input]:focus:ring-brand-700">
          <DateRangeInputs value={range} onChange={(r) => { setRange(r); setResult(null); }} />
        </div>
        {inverted && <p role="alert" className="mt-1.5 text-[12px] text-danger-700">"From" is after "To".</p>}
        <p className="mt-1.5 text-[12px] text-warmstone-500">
          Each dated sheet is filtered on its own date ({dated.map((s) => `${s.name}: ${s.dateLabel!.toLowerCase()}`).slice(0, 3).join("; ")}…), both ends included.
          Suppliers, bins, origins and warehouses are always complete.
          {hasRange && " Rows with no usable date are left out, and counted below."}
        </p>
      </div>

      {error && <p role="alert" className="text-[12.5px] font-medium text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{error}</p>}
      {result && (
        <div role="status" className="text-[12.5px] rounded-lg bg-success-100 text-success-800 px-3 py-2 space-y-1">
          <div>Exported {plural(result.exported, "row")} across {plural(info.sheets.length, "sheet")}.</div>
          {result.withoutDate > 0 && (
            <div className="text-ambernut-800">
              {plural(result.withoutDate, "row")} had no usable date and {result.withoutDate === 1 ? "was" : "were"} left out.
              Export without a date range to include {result.withoutDate === 1 ? "it" : "them"}.
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={download} disabled={busy || inverted} className={primaryBtn}>
          <span className="material-symbols-outlined text-[17px]">download</span>
          {busy ? "Preparing…" : "Download workbook"}
        </button>
      </div>
    </div>
  );
}

function UploadBody({ warehouse, sectionLabel, onCommitted }: { warehouse: string; sectionLabel: string; onCommitted?: (r: WorkbookCommitResult) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<WorkbookPreview | null>(null);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<WorkbookCommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFile(null); setPreview(null); setDone(null); setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function downloadBlank() {
    setError(null);
    try {
      const { blob, filename } = await api.downloadWorkbook(warehouse, { blank: true });
      saveFile(blob, filename);
    } catch (e) {
      setError(msgOf(e));
    }
  }

  /** Choosing a file IS the action: it is checked straight away, nothing is written. */
  async function pick(f: File | null) {
    setFile(f);
    setPreview(null);
    setError(null);
    if (!f) return;
    setPreviewing(true);
    try {
      setPreview(await api.previewWorkbook(f, warehouse));
    } catch (e) {
      setError(msgOf(e));
    } finally {
      setPreviewing(false);
    }
  }

  async function apply() {
    if (!preview) return;
    setApplying(true);
    setError(null);
    try {
      const result = await api.commitWorkbook(preview.token);
      setDone(result);
      onCommitted?.(result);
    } catch (e) {
      // A commit can fail if the data moved since the preview; the message says so, nothing was written.
      setError(e instanceof ApiError ? e.message : msgOf(e));
      setPreview(null);
    } finally {
      setApplying(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <div role="status" className="rounded-xl bg-success-100 text-success-800 px-4 py-3 text-[13px] space-y-1">
          <div className="font-bold">Done - {plural(done.totalCreated, "row")} added, {plural(done.totalUpdated, "row")} updated.</div>
          {done.applied.map((a) => (
            <div key={a.name} className="text-[12.5px]"><span className="font-semibold">{a.name}</span>: {a.created} added, {a.updated} updated</div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={reset} className={ghostBtn}>Upload another</button>
        </div>
      </div>
    );
  }

  const changes = preview ? preview.totalCreated + preview.totalChanged : 0;
  const shown = preview?.sheets.filter((s) => s.rows > 0 || s.errorCount > 0) ?? [];
  const empty = preview?.sheets.filter((s) => s.rows === 0 && s.errorCount === 0) ?? [];

  return (
    <div className="space-y-5">
      {/* Sample: a quiet link at the top right - the file chooser below is the point of this dialog. */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-warmstone-500">{sectionLabel}</span>
        <button type="button" onClick={downloadBlank} className={ghostBtn} title="A blank workbook with every sheet and column, to fill in">
          <span className="material-symbols-outlined text-[16px]">description</span>
          Download sample
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx"
        aria-label="Workbook to upload"
        className="sr-only"
        onChange={(e) => void pick(e.target.files?.[0] ?? null)}
      />

      {!file ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); void pick(e.dataTransfer.files?.[0] ?? null); }}
          className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
            dragging ? "border-brand-700 bg-brand-50" : "border-warmstone-300 bg-warmstone-50"
          }`}
        >
          <span className="material-symbols-outlined text-[44px] text-brand-700">upload_file</span>
          <button type="button" onClick={() => fileRef.current?.click()} className={`${primaryBtn} px-6 py-2.5 text-[14px]`}>
            Choose file
          </button>
          <p className="text-[12.5px] text-warmstone-500">or drop an .xlsx here</p>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-warmstone-200 bg-warmstone-50 px-4 py-3">
          <span className="material-symbols-outlined text-[22px] text-brand-700">description</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-warmstone-900">{file.name}</div>
            <div className="text-[12px] text-warmstone-500">{previewing ? "Checking…" : "Nothing is written until you apply."}</div>
          </div>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={previewing || applying} className={ghostBtn}>
            Choose another
          </button>
        </div>
      )}

      {!preview && !done && (
        <p className="text-center text-[12px] text-warmstone-400">
          To add a new row, leave its first column (Receipt ID / Row ID) empty. Nothing is ever deleted.
        </p>
      )}

      {error && <p role="alert" className="text-[12.5px] font-medium text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{error}</p>}

      {preview && (
        <div className="space-y-4">
          {preview.notices.length > 0 && (
            <ul className="text-[12.5px] text-ambernut-800 bg-ambernut-100 rounded-lg px-3 py-2 space-y-0.5 list-disc list-inside">
              {preview.notices.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}

          <div className="overflow-x-auto border border-warmstone-200 rounded-xl">
            <table className="w-full text-[12.5px] border-collapse">
              <thead>
                <tr className="border-b border-warmstone-200 text-left text-[11px] uppercase tracking-wider text-warmstone-500">
                  <th className="px-3 py-2">Sheet</th>
                  <th className="px-3 py-2 text-right">Rows</th>
                  <th className="px-3 py-2 text-right">New</th>
                  <th className="px-3 py-2 text-right">Changed</th>
                  <th className="px-3 py-2 text-right">Same</th>
                  <th className="px-3 py-2 text-right">Problems</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.name} className="border-b border-warmstone-100 last:border-0 tabular-nums">
                    <td className="px-3 py-1.5 font-semibold text-warmstone-800">{s.name}</td>
                    <td className="px-3 py-1.5 text-right">{s.rows}</td>
                    <td className={`px-3 py-1.5 text-right ${s.created ? "font-bold text-brand-800" : "text-warmstone-400"}`}>{s.created}</td>
                    <td className={`px-3 py-1.5 text-right ${s.changed ? "font-bold text-brand-800" : "text-warmstone-400"}`}>{s.changed}</td>
                    <td className="px-3 py-1.5 text-right text-warmstone-500">{s.unchanged}</td>
                    <td className={`px-3 py-1.5 text-right ${s.errorCount ? "font-bold text-danger-700" : "text-warmstone-400"}`}>{s.errorCount}</td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={6} className="px-3 py-3 text-warmstone-400">No data rows in this file.</td></tr>}
              </tbody>
            </table>
          </div>
          {empty.length > 0 && (
            <p className="text-[12px] text-warmstone-400">No rows in: {empty.map((s) => s.name).join(", ")}.</p>
          )}

          {preview.errorCount > 0 && (
            <div className="space-y-2">
              <h3 className="text-[12.5px] font-bold text-danger-700">{plural(preview.errorCount, "problem")} to fix - nothing has been written</h3>
              <ul className="space-y-1 text-[12.5px] max-h-56 overflow-y-auto">
                {preview.sheets.filter((s) => s.errorCount > 0).flatMap((s) => [
                  ...s.errors.map((e, i) => (
                    <li key={`${s.name}-${i}`} className="text-warmstone-700">
                      <span className="font-semibold text-warmstone-900">{s.name}</span> · row {e.row}{e.column ? ` · ${e.column}` : ""}: {e.message}
                    </li>
                  )),
                  ...(s.errorCount > s.errors.length
                    ? [<li key={`${s.name}-more`} className="text-warmstone-400">…and {s.errorCount - s.errors.length} more in {s.name}</li>]
                    : []),
                ])}
              </ul>
            </div>
          )}

          {preview.warningCount > 0 && (
            <div className="space-y-2">
              <h3 className="text-[12.5px] font-bold text-ambernut-700">
                {plural(preview.warningCount, "thing")} to check - the upload still goes through, and each is saved on its truck
              </h3>
              <ul className="space-y-1 text-[12.5px] max-h-40 overflow-y-auto">
                {preview.sheets.filter((s) => s.warningCount > 0).flatMap((s) => [
                  ...s.warnings.map((w, i) => (
                    <li key={`${s.name}-w${i}`} className="text-warmstone-700">
                      <span className="font-semibold text-warmstone-900">{s.name}</span> · row {w.row}{w.column ? ` · ${w.column}` : ""}: {w.message}
                    </li>
                  )),
                  ...(s.warningCount > s.warnings.length
                    ? [<li key={`${s.name}-wmore`} className="text-warmstone-400">…and {s.warningCount - s.warnings.length} more in {s.name}</li>]
                    : []),
                ])}
              </ul>
            </div>
          )}

          {changes > 0 && (
            <details className="text-[12.5px]">
              <summary className="cursor-pointer font-semibold text-warmstone-700">What changes ({plural(changes, "row")})</summary>
              <ul className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                {preview.sheets.flatMap((s) => s.samples.map((x) => (
                  <li key={`${s.name}-${x.row}`} className="text-warmstone-600">
                    <span className="font-semibold text-warmstone-900">{s.name}</span> · row {x.row} · <span className="font-medium">{x.key}</span>:{" "}
                    {x.changes.map((c) => `${c.column} ${c.from || "∅"} → ${c.to || "∅"}`).join("; ")}
                  </li>
                )))}
              </ul>
              <p className="mt-1 text-warmstone-400">A few of each sheet's rows are shown.</p>
            </details>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3">
            {preview.errorCount > 0 && <span className="text-[12.5px] text-danger-700">Fix these in Excel and preview again.</span>}
            {preview.errorCount === 0 && changes === 0 && <span className="text-[12.5px] text-warmstone-500">Nothing to change - this file matches the database.</span>}
            <button type="button" onClick={apply} disabled={applying || preview.errorCount > 0 || changes === 0} className={primaryBtn}>
              <span className="material-symbols-outlined text-[17px]">check</span>
              {applying ? "Applying…" : changes > 0 ? `Apply ${plural(changes, "change")}` : "Apply"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
