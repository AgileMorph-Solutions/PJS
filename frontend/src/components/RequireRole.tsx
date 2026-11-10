import { Navigate, Outlet } from "react-router-dom";
import { homePathFor, useMe } from "../state/AuthContext";
import type { Role } from "../data/roles";
import type { UserView } from "../types/user";

/** Layout-route guard: renders the nested routes only for the listed roles (and, given `allow`, only
 * where it also holds — e.g. Production, which needs the user's warehouse too), otherwise sends the
 * user home. This is a courtesy — the API enforces the same rules (auth/policy.ts,
 * auth/productionAccess.ts) and is the actual gate; this just keeps people off pages that would only 403. */
export function RequireRole({ roles, allow }: { roles?: Role[]; allow?: (me: UserView) => boolean }) {
  const me = useMe();
  const ok = (!roles || roles.includes(me.role)) && (!allow || allow(me));
  return ok ? <Outlet /> : <Navigate to={homePathFor(me)} replace />;
}
