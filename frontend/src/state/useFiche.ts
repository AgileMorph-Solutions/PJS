/**
 * A truck's CCA fiche on its receipt page: what's kept, what was read, and the upload. Its own hook rather than part of
 * TrackingApi (frontend/CLAUDE.md: a new capability doesn't reshape the shared context). Warehouse Incharge / admin only,
 * like the routes behind it, so it asks for nothing when `enabled` is false.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { FicheView } from "@anagroci/contract/domain/fiche";
import { FICHE_FILE_TYPES, FICHE_MAX_BYTES } from "@anagroci/contract/domain/fiche";
import { api } from "../repository/api";
import { shrinkPhoto } from "../components/receipt/shrinkPhoto";

export type FicheBusy = "upload" | "read" | null;

/**
 * Where an upload has got to (26 Nov 2026, user: "a progress bar"): the photo made smaller in the browser, then the bytes on
 * their way (`sent` 0…1, measured), then the server reading the fiche, which can't be measured and is shown as such.
 */
export type FicheProgress = { phase: "preparing" } | { phase: "sending"; sent: number } | { phase: "reading" };

/** What went wrong, and what "Try again" does: send the same file again, read the kept fiche again, or load it again. */
export interface FicheError { message: string; retry: "upload" | "read" | "load" | null }

/**
 * `onFilled` runs after an upload or read that filled some of the step's fields on the server, so the page reloads the
 * truck and shows them.
 */
export function useFiche(receiptId: string | undefined, enabled: boolean, onFilled?: () => void) {
  const [view, setView] = useState<FicheView | null>(null);
  // Until the first read comes back, nothing is known: the panel mustn't offer "Upload the fiche" over a fiche it hasn't seen.
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<FicheBusy>(null);
  const [progress, setProgress] = useState<FicheProgress | null>(null);
  const [error, setError] = useState<FicheError | null>(null);
  const lastFile = useRef<File | null>(null);
  const [loadCount, setLoadCount] = useState(0);

  useEffect(() => {
    if (!receiptId || !enabled) { setView(null); setLoaded(false); return; }
    let alive = true;
    setLoaded(false);
    api.fiche(receiptId)
      .then((v) => { if (alive) { setView(v); setError(null); } })
      .catch((e) => { if (alive) { setView(null); setError({ message: `The fiche couldn't be loaded. ${messageOf(e)}`, retry: "load" }); } })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [receiptId, enabled, loadCount]);

  const run = useCallback(async (kind: Exclude<FicheBusy, null>, call: () => Promise<FicheView>) => {
    setBusy(kind); setError(null);
    try {
      const v = await call();
      setView(v);
      if (v.filled?.length) onFilled?.();
    } catch (e) {
      setError({ message: messageOf(e), retry: kind });
    } finally {
      setBusy(null); setProgress(null);
    }
  }, [onFilled]);

  const upload = useCallback(async (file: File) => {
    if (!receiptId) return;
    lastFile.current = file;
    // Said here at once rather than after a slow upload the server would refuse anyway. Another file is the fix, not a retry.
    if (!FICHE_FILE_TYPES[file.type]) {
      setError({ message: `"${file.name}" can't be a fiche: choose a ${Object.values(FICHE_FILE_TYPES).join(", ")} file.`, retry: null });
      return;
    }
    await run("upload", async () => {
      setProgress({ phase: "preparing" });
      const { blob, name } = await shrinkPhoto(file).catch(() => { throw new Error(`"${file.name}" couldn't be opened as a picture. Take the photo again, or choose another file.`); });
      if (blob.size > FICHE_MAX_BYTES) throw new Error(`The file is over ${FICHE_MAX_BYTES / 1024 / 1024} MB. Scan it as a PDF at a lower resolution.`);
      setProgress({ phase: "sending", sent: 0 });
      return api.uploadFiche(receiptId, blob, name, (sent) => setProgress(sent >= 1 ? { phase: "reading" } : { phase: "sending", sent }));
    });
  }, [receiptId, run]);

  const reread = useCallback(() => (receiptId ? run("read", () => api.rereadFiche(receiptId)) : Promise.resolve()), [receiptId, run]);

  /** Does again what failed: the same file, the same read, or loading the fiche. */
  const retry = useCallback(() => {
    if (error?.retry === "upload" && lastFile.current) return void upload(lastFile.current);
    if (error?.retry === "read") return void reread();
    if (error?.retry === "load") { setError(null); setLoadCount((n) => n + 1); }
  }, [error, upload, reread]);

  return { view, loaded, busy, progress, error, upload, reread, retry, dismissError: () => setError(null) };
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
