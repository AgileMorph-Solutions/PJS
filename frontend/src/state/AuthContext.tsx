/**
 * Who is signed in. Its own context, not part of TrackingApi (frontend/CLAUDE.md: new capabilities
 * are new hooks, not a reshaped TrackingApi).
 *
 * `status` is three-valued on purpose: "loading" (asking the server who we are) must not flash the
 * login form at someone who is already signed in.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { UserView } from "../types/user";
import { api, ApiError, UNAUTHORIZED_EVENT } from "../repository/api";
import { canWriteStageDirectly, type Role } from "../data/roles";
import { siteSlugForType, type SiteSlug } from "../config/sites";

type Status = "loading" | "anonymous" | "authenticated";

interface AuthApi {
  status: Status;
  me: UserView | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthCtx = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<UserView | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    api.me()
      .then((u) => { setMe(u); setStatus("authenticated"); })
      .catch(() => setStatus("anonymous")); // 401 = not signed in; anything else also can't proceed
  }, []);

  // Any API call that comes back 401 (expired/revoked session) drops us back to the login form.
  useEffect(() => {
    const onUnauthorized = () => { setMe(null); setStatus("anonymous"); };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const u = await api.login(username, password);
    setMe(u);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch (e) { if (!(e instanceof ApiError)) throw e; }
    setMe(null);
    setStatus("anonymous");
    // The session itself is revoked server-side and its cookie cleared by the logout call. What is
    // left is this browser: remembered site, drafts, and every cached record in memory. A full
    // reload drops the in-memory state in one go, so the next person to sign in on this machine
    // starts from nothing of the previous user's.
    try { localStorage.clear(); sessionStorage.clear(); } catch { /* storage blocked - nothing to clear */ }
    window.location.replace("/");
  }, []);

  const value = useMemo(() => ({ status, me, login, logout }), [status, me, login, logout]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** For pages that only render once signed in (everything behind AuthGate): `me` is never null. */
export function useMe(): UserView {
  const { me } = useAuth();
  if (!me) throw new Error("useMe called while signed out");
  return me;
}

/** Admin / Warehouse Incharge: their stage edits apply directly, no approval step. */
export function useCanEditDirectly(): boolean {
  return canWriteStageDirectly(useMe().role);
}

export function useHasRole(...roles: Role[]): boolean {
  return roles.includes(useMe().role);
}

/** Where this user lands: admin sees the dashboard; everyone else goes to their own section's
 * Reception (a Branch Manager / QFS Officer has no dashboard access). */
export function homePathFor(me: UserView): string {
  if (me.role === "admin") return "/";
  const slug: SiteSlug | undefined = siteSlugForType(me.warehouseType);
  return slug ? `/${slug}/receipts` : "/";
}
