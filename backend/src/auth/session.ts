// The cookie carries a random token; only its SHA-256 is stored, so reading the Session table
// can't be replayed as a login.
import { createHash, randomBytes } from "node:crypto";
import type { User } from "@prisma/client";
import { prisma } from "../db.js";

export const SESSION_COOKIE = "anagroci_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { tokenHash: sha256(token), userId, expiresAt } });
  return { token, expiresAt };
}

/** A signed-in user plus the site their warehouse belongs to (null when it IS a site, or they have none). */
export type SessionUser = User & { warehouseRef: { site: string | null } | null };

/** The active user behind a token, or null (unknown, expired, or a deactivated account). Loads the warehouse's site in
 * the same query, so scoping a request to "my store or my site" costs no extra lookup. */
export async function userForToken(token: string): Promise<SessionUser | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { warehouseRef: { select: { site: true } } } } },
  });
  if (!session || session.expiresAt.getTime() < Date.now() || !session.user.active) return null;
  return session.user;
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
}
