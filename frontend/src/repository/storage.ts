// Generic localStorage helpers. Every persisted read/write in the app goes through here, so
// swapping this for real API calls later touches one file, not every page.

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
