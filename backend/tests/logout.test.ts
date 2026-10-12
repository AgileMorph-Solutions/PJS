/**
 * Signing out must end the session for real: the cookie is httpOnly, so only the server can clear it, and a
 * session left alive behind a cleared screen just reopens the same profile on the next load. The browser
 * client sends the request as JSON; before this guard a body-less JSON POST was rejected by the framework and
 * the handler never ran.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { SESSION_COOKIE } from "../src/auth/session.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { username: "lgo-a" } });
  await prisma.user.create({ data: { username: "lgo-a", displayName: "Ama", role: "admin", passwordHash: hashPassword(PW) } });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: "lgo-a" } });
  await prisma.$disconnect();
  await app.close();
});

async function signIn() {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "lgo-a", password: PW } });
  expect(res.statusCode).toBe(200);
  return String(res.headers["set-cookie"]).split(";")[0]!;
}

describe("sign out", () => {
  it("revokes the session and clears the cookie, even when the request is marked JSON and has no body (as the browser sends it)", async () => {
    const cookie = await signIn();
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } })).statusCode).toBe(200);

    const out = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie, "content-type": "application/json" } });
    expect(out.statusCode).toBe(200);
    expect(String(out.headers["set-cookie"])).toMatch(new RegExp(`${SESSION_COOKIE}=;`));
    expect(String(out.headers["set-cookie"])).toMatch(/Max-Age=0/i);

    // The old cookie no longer opens the profile.
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } })).statusCode).toBe(401);
    expect(await prisma.session.count({ where: { user: { username: "lgo-a" } } })).toBe(0);
  });

  it("also works with no content-type at all, and signing out twice is harmless", async () => {
    const cookie = await signIn();
    expect((await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } })).statusCode).toBe(401);
  });
});
