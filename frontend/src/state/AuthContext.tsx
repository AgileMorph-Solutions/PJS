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
import { CENTRAL_ONLY_ROLES, canAccessProduction, canRecordIntake, canRunProduction, canSeeFactory, canWriteStageDirectly, type Role } from "../data/roles";
import { warehouseSlug } from "../config/sites";

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
    try {
      await api.logout();
    } catch (e) {
      // 401 means there is no live session left, which is what signing out wanted. Anything else means the server did
      // NOT end the session, and reloading would reopen the same profile - so say so and stay where we are.
      if (!(e instanceof ApiError && e.status === 401)) {
        window.alert("Couldn't sign out - the server didn't respond. Check your connection and try again.");
        return;
      }
    }
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

/** Production is the Central (factory) warehouse's work; a Unit warehouse user never sees it (contract's canAccessProduction). */
export function useCanAccessProduction(): boolean {
  const me = useMe();
  return canAccessProduction(me.role, me.warehouseType);
}

export function useHasRole(...roles: Role[]): boolean {
  return roles.includes(useMe().role);
}

/**
 * Who does which side of a production load (contract's canRecordIntake / canRunProduction / canSeeFactory): the warehouse
 * team records, checks and weighs it and sees only that; the production team sees the whole of production, the
 * warehouse's forms included, and accepts the load and runs what follows.
 */
export function useProductionPermissions() {
  const role = useMe().role;
  const isQfs = role === "qfs_officer";
  const intake = canRecordIntake(role);
  const factory = canRunProduction(role);
  return {
    /** Record and weigh a load, approve its moisture check (Admin / Warehouse Incharge). */
    intake,
    /** Accept a load, every record after it and its quality checks (Admin / Production Incharge). */
    factory,
    /** See production past the intake: silos, Lots, every stage (the production team and Admin). */
    seeFactory: canSeeFactory(role),
    /** Take a moisture check on a load (the warehouse team's QFS Officer, or its Incharge directly). */
    moistureCheck: intake || isQfs,
    /** Take a quality check after acceptance (QC-2 onwards): production's own. */
    factoryCheck: factory,
    /** Download the production workbook: everyone with Production but the QFS Officer, whose checks are on screen. */
    exportWorkbook: !isQfs,
    /** Admin is the one who may still correct a load production has accepted. */
    isAdmin: role === "admin",
  };
}

/** Where this user lands: admin sees the dashboard; the factory's roles go to Production; everyone else goes to their own
 * warehouse's Reception (a Branch Manager / QFS Officer has no dashboard access). */
export function homePathFor(me: UserView): string {
  const site = me.site ?? me.warehouse;
  if (me.role === "admin" || !site) return "/";
  if (CENTRAL_ONLY_ROLES.includes(me.role)) return "/production/runs";
  return `/${warehouseSlug(site)}/receipts`;
}
