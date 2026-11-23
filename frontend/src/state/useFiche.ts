/**
 * A truck's CCA fiche on its receipt page: what's kept, what was read, and the upload. Its own hook rather than part of
 * TrackingApi (frontend/CLAUDE.md: a new capability doesn't reshape the shared context). Warehouse Incharge / admin only,
 * like the routes behind it, so it asks for nothing when `enabled` is false.
 */
import { useCallback, useEffect, useState } from "react";
import type { FicheView } from "@anagroci/contract/domain/fiche";
import { FICHE_FILE_TYPES, FICHE_MAX_BYTES } from "@anagroci/contract/domain/fiche";
import { api } from "../repository/api";
import { shrinkPhoto } from "../components/receipt/shrinkPhoto";

export type FicheBusy = "upload" | "read" | null;

/**
 * `onFilled` runs after an upload or read that filled some of the step's fields on the server, so the page reloads the
 * truck and shows them.
 */
export function useFiche(receiptId: string | undefined, enabled: boolean, onFilled?: () => void) {
  const [view, setView] = useState<FicheView | null>(null);
  const [busy, setBusy] = useState<FicheBusy>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!receiptId || !enabled) { setView(null); return; }
    let alive = true;
    api.fiche(receiptId).then((v) => { if (alive) setView(v); }).catch(() => { if (alive) setView(null); });
    return () => { alive = false; };
  }, [receiptId, enabled]);

  const run = useCallback(async (kind: Exclude<FicheBusy, null>, call: () => Promise<FicheView>) => {
    setBusy(kind); setError(null);
    try {
      const v = await call();
      setView(v);
      if (v.filled?.length) onFilled?.();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  }, [onFilled]);

  const upload = useCallback(async (file: File) => {
    if (!receiptId) return;
    // Said here at once rather than after a slow upload the server would refuse anyway.
    if (!FICHE_FILE_TYPES[file.type]) { setError(`A fiche can be a ${Object.values(FICHE_FILE_TYPES).join(", ")} file.`); return; }
    await run("upload", async () => {
      const { blob, name } = await shrinkPhoto(file);
      if (blob.size > FICHE_MAX_BYTES) throw new Error(`The file is over ${FICHE_MAX_BYTES / 1024 / 1024} MB. Scan it as a PDF at a lower resolution.`);
      return api.uploadFiche(receiptId, blob, name);
    });
  }, [receiptId, run]);

  const reread = useCallback(() => (receiptId ? run("read", () => api.rereadFiche(receiptId)) : Promise.resolve()), [receiptId, run]);

  return { view, busy, error, upload, reread };
}
