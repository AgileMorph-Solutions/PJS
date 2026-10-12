/**
 * Identity for every request. One global hook resolves the cookie to `req.user`; everything except
 * the public paths below is 401 without it. Role checks are opt-in per route via requireRole —
 * the role → stage rules themselves live in contract's roles.ts, not here.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { parseCookie } from "cookie";
import type { User } from "@prisma/client";
import { isRole, type Role } from "@anagroci/contract/data/roles";
import { ForbiddenError, UnauthorizedError } from "../domain/validation.js";
import { isAllowed } from "./policy.js";
import { SESSION_COOKIE, userForToken } from "./session.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: User;
  }
}

// Sign out is public on purpose: it needs no identity (it only deletes the session of the token it is given),
// and a person whose session already expired must still be able to clear the cookie.
const PUBLIC_PATHS = new Set(["/api/health", "/api/auth/login", "/api/auth/logout"]);

/**
 * Called directly (not app.register) so the hook lands on the root instance and covers every route
 * registered after it — a registered plugin's hooks would stay encapsulated inside it. 
 */
export function registerAuth(app: FastifyInstance) {
  app.addHook("onRequest", async (req) => {
    const path = req.url.split("?")[0];
    // Only /api is gated: the SPA itself is served by nginx, not this process.
    if (!path.startsWith("/api") || PUBLIC_PATHS.has(path)) return;
    const token = parseCookie(req.headers.cookie ?? "")[SESSION_COOKIE];
    const user = token ? await userForToken(token) : null;
    if (!user) throw new UnauthorizedError();
    req.user = user;
    if (isRole(user.role) && !isAllowed(user.role, req.method, path)) throw new ForbiddenError();
  });
}

export function currentUser(req: FastifyRequest): User & { role: Role } {
  if (!req.user || !isRole(req.user.role)) throw new UnauthorizedError();
  return req.user as User & { role: Role };
}

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest) => {
    const user = currentUser(req);
    if (!roles.includes(user.role)) throw new ForbiddenError();
  };
}
