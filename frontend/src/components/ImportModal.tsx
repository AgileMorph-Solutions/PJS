import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";
import { ImportPanel } from "./ImportPanel";
import { api, BASE } from "../repository/api";
import type { ImporterTypeInfo, CommitImportResponse } from "../repository/api";
import { importerBelongsToSite } from "../config/importerSites";
import { SITES, type SiteSlug } from "../config/sites";

interface Props {
  /** Which of the registry's importer ids this page's Upload button offers — a curated subset,
   * not every shape the backend knows (see ReceiptsListPage for the current list: everything that
   * belongs on Reception, per docs/UPLOAD_GUIDE.md's per-section mapping). */
  importerIds: string[];
  /** When given, narrows `importerIds` further to only the shapes relevant to this site (see
   * config/importerSites.ts) — e.g. Bouaké's Upload button never offers Issued to Production,
   * Yakro's never offers CHARGEMENT dispatch or the Bouaké-only jute ledger. Omit on a
   * site-agnostic page (e.g. a future Jute page) to show every id passed in unfiltered. */
  siteSlug?: SiteSlug;
  /** Which action this dialog was opened for — "upload" offers Template + Import per row (no
   * Export data button, since this flow is about getting data in); "export" offers Template +
   * Export data per row (no Import button — picking one just downloads, never opens the
   * ImportPanel). Same picker list either way, different action per row. */
  mode: "upload" | "export";
  onClose: () => void;
  onCommitted?: (result: CommitImportResponse) => void;
}

const ghostBtn =
  "inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-warmstone-200 text-warmstone-600 text-[11.5px] font-semibold hover:bg-warmstone-50 hover:text-warmstone-800 hover:border-warmstone-300 transition-colors whitespace-nowrap";
const primaryBtn =
  "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-brand-700 hover:bg-brand-800 text-white text-[11.5px] font-bold transition-colors whitespace-nowrap ml-auto";

/** One "Upload" button's worth of workbook shapes, behind a picker instead of a wall of always-
 * expanded panels — pick the sheet, then the familiar ImportPanel preview → commit flow runs
 * inside the same dialog. Labels come from the backend registry (GET /api/imports/types), not
 * hand-typed here, so they can't drift from the importer's own `label`. */
export function ImportModal({ importerIds, siteSlug, mode, onClose, onCommitted }: Props) {
  const [types, setTypes] = useState<ImporterTypeInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    api.listImporterTypes().then(setTypes).catch(() => setTypes([]));
  }, []);

  const options = (types ?? []).filter(
    (t) => importerIds.includes(t.id) && (!siteSlug || importerBelongsToSite(t.id, siteSlug))
  );
  // Export never drills into a "chosen" sub-view — both row buttons are plain downloads, so
  // `selected` only ever gets set from the Import button, which export mode doesn't render.
  const chosen = mode === "upload" ? options.find((t) => t.id === selected) : undefined;
  const verb = mode === "upload" ? "uploading" : "exporting";

  return (
    <Modal
      title={chosen ? `Upload — ${chosen.label}` : mode === "upload" ? "Upload a workbook" : "Export a workbook"}
      onClose={onClose}
      wide={Boolean(chosen)}
    >
      {!types ? (
        <p className="text-[12.5px] text-warmstone-400 animate-pulse">Loading workbook shapes…</p>
      ) : !chosen ? (
        <div className="space-y-2">
          <p className="text-[12.5px] text-warmstone-500 mb-3">Which workbook are you {verb}?</p>
          {options.map((t) => (
            <div key={t.id} className="rounded-xl border border-warmstone-200 p-4">
              <div className="mb-3">
                <span className="block text-[13.5px] font-bold text-warmstone-900">{t.label}</span>
                <span className="block text-[11.5px] text-warmstone-500 mt-0.5">
                  sheet <code className="font-mono">{t.expectedSheet}</code>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`${BASE}/imports/${encodeURIComponent(t.id)}/template`}
                  className={ghostBtn}
                  title={`Download a blank ${t.label} template`}
                >
                  <span className="material-symbols-outlined text-[15px]">description</span>
                  Template
                </a>
                {mode === "export" ? (
                  <a
                    href={`${BASE}/imports/${encodeURIComponent(t.id)}/export${siteSlug ? `?warehouse=${encodeURIComponent(SITES[siteSlug].warehouseName)}` : ""}`}
                    className={primaryBtn}
                    title={`Export current ${t.label} data`}
                  >
                    <span className="material-symbols-outlined text-[15px]">download</span>
                    Export data
                  </a>
                ) : (
                  <button type="button" onClick={() => setSelected(t.id)} className={primaryBtn}>
                    <span className="material-symbols-outlined text-[15px]">upload</span>
                    Import
                  </button>
                )}
              </div>
            </div>
          ))}
          {options.length === 0 && (
            <p className="text-[12.5px] text-warmstone-400">No workbook shapes apply to this section.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:text-brand-800"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Choose a different workbook
          </button>
          <ImportPanel importerId={chosen.id} onCommitted={onCommitted} />
        </div>
      )}
    </Modal>
  );
}
