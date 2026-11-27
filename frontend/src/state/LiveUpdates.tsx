import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { BASE } from "../repository/api";

/**
 * Live updates (27 Nov 2026, user: the QFS Officer had to reload to see the check the Incharge just asked for). One
 * Server-Sent Events stream per tab (backend routes/events.ts) says "something changed at your warehouse"; `version`
 * counts those, and a page passes it as `reloadOn` to read its own records again. The stream carries no data, so a page
 * never shows anything but what its own reads return.
 *
 * A burst of changes (a form saving several things) is one re-read: the count moves once the burst settles. The browser
 * reconnects by itself after a drop; reconnecting counts as a change, since anything may have happened meanwhile.
 */
const Ctx = createContext(0);
const SETTLE_MS = 400;

export function LiveUpdatesProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource(`${BASE}/events`, { withCredentials: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let opened = false;
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => setVersion((v) => v + 1), SETTLE_MS); };
    source.addEventListener("change", bump);
    source.onopen = () => { if (opened) bump(); opened = true; };
    return () => { clearTimeout(timer); source.close(); };
  }, []);
  return <Ctx.Provider value={version}>{children}</Ctx.Provider>;
}

/** Moves each time something was saved at this person's warehouse, by anyone. */
export const useLiveVersion = () => useContext(Ctx);
