// Small localStorage helpers, wrapped so blocked or corrupt storage degrades instead of crashing.
//
// This used to hold the whole application state. The server owns that now; what's left here is
// per-browser convenience only. Nothing the app needs to be correct lives in here.

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    // corrupt or blocked storage — fall back rather than crash
  }
  return fallback;
}

export function saveJSON<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best-effort persistence only
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * The pre-API state blob. It must be cleared on boot: it holds a full copy of the receipts, and a
 * stale copy shadowing freshly-loaded server data is the worst possible failure here — the user
 * sees old numbers with no indication they're old.
 */
export const LEGACY_STATE_KEY = "anagroci-tracking-v2";
