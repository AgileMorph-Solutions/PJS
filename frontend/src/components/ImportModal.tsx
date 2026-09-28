import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";
import { ImportPanel } from "./ImportPanel";
import { api } from "../repository/api";
import type { ImporterTypeInfo, CommitImportResponse } from "../repository/api";

interface Props {
  /** Which of the registry's importer ids this page's Upload button offers — a curated subset,
   * not every shape the backend knows (see ReceiptsListPage for the current list: everything that
   * belongs on Reception, per docs/UPLOAD_GUIDE.md's per-section mapping). */
  importerIds: string[];
  onClose: () => void;
  onCommitted?: (result: CommitImportResponse) => void;
}

/** One "Upload" button's worth of workbook shapes, behind a picker instead of a wall of always-
 * expanded panels — pick the sheet, then the familiar ImportPanel preview → commit flow runs
 * inside the same dialog. Labels come from the backend registry (GET /api/imports/types), not
 * hand-typed here, so they can't drift from the importer's own `label`. */
export function ImportModal({ importerIds, onClose, onCommitted }: Props) {
  const [types, setTypes] = useState<ImporterTypeInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    api.listImporterTypes().then(setTypes).catch(() => setTypes([]));
  }, []);

  const options = types?.filter((t) => importerIds.includes(t.id)) ?? [];
  const chosen = options.find((t) => t.id === selected);

  return (
    <Modal title={chosen ? `Upload — ${chosen.label}` : "Upload a workbook"} onClose={onClose} wide={Boolean(chosen)}>
      {!types ? (
        <p className="text-[12.5px] text-warmstone-400 animate-pulse">Loading workbook shapes…</p>
      ) : !chosen ? (
        <div className="space-y-2">
          <p className="text-[12.5px] text-warmstone-500 mb-3">Which workbook are you uploading?</p>
          {options.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelected(t.id)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-warmstone-200 hover:border-brand-300 hover:bg-brand-50/50 transition-colors text-left"
            >
              <span>
                <span className="block text-[13.5px] font-bold text-warmstone-900">{t.label}</span>
                <span className="block text-[11.5px] text-warmstone-500 mt-0.5">
                  sheet <code className="font-mono">{t.expectedSheet}</code>
                </span>
              </span>
              <span className="material-symbols-outlined text-[18px] text-warmstone-400">chevron_right</span>
            </button>
          ))}
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
