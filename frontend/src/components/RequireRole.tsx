import { Navigate, Outlet } from "react-router-dom";
import { homePathFor, useMe } from "../state/AuthContext";
import type { Role } from "../data/roles";

/** Layout-route guard: renders the nested routes only for the listed roles, otherwise sends the
 * user home. This is a courtesy — the API enforces the same rules (auth/policy.ts) and is the
 * actual gate; this just keeps a Branch Manager from landing on a page that would only 403. */
export function RequireRole({ roles }: { roles: Role[] }) {
  const me = useMe();
  return roles.includes(me.role) ? <Outlet /> : <Navigate to={homePathFor(me)} replace />;
}
