import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { verifyPassword } from "../auth/password.js";
import { createSession, revokeSession, SESSION_COOKIE } from "../auth/session.js";
import { currentUser } from "../auth/plugin.js";
import { getUserView } from "../services/users.js";
import { UnauthorizedError } from "../domain/validation.js";
import { parseCookie, stringifySetCookie } from "cookie";

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/login", async (req, reply) => {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    if (!username || !password) return reply.code(400).send({ error: "username and password are required" });
    const user = await prisma.user.findUnique({ where: { username: username.trim() } });
    // Same message for unknown user, wrong password and deactivated account, so the response
    // doesn't reveal which usernames exist.
    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedError("Wrong username or password.");
    }
    const { token, expiresAt } = await createSession(user.id);
    reply.header("Set-Cookie", stringifySetCookie(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: "lax", path: "/", expires: expiresAt,
      secure: process.env.COOKIE_SECURE === "true",
    }));
    return getUserView(user.id);
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = parseCookie(req.headers.cookie ?? "")[SESSION_COOKIE];
    if (token) await revokeSession(token);
    // Same name and path as the cookie login set, expired both ways (Max-Age and Expires) so every browser drops it.
    reply.header("Set-Cookie", stringifySetCookie(SESSION_COOKIE, "", {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: 0, expires: new Date(0), secure: process.env.COOKIE_SECURE === "true",
    }));
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => getUserView(currentUser(req).id));
}
