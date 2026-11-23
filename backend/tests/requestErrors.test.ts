/**
 * A mistake in the request is the caller's (4xx), not the server's. QA found a body that isn't JSON answered 500, and an
 * unknown receipt id logged "reply already sent" errors because the route returned after the 404 had gone out.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
let cookie: string;

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { username: "req-err" } });
  await prisma.user.create({ data: { username: "req-err", displayName: "Err", role: "admin", passwordHash: hashPassword(PW) } });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "req-err", password: PW } });
  cookie = String(res.headers["set-cookie"]).split(";")[0]!;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: "req-err" } });
  await prisma.$disconnect();
  await app.close();
});

describe("request errors", () => {
  it("answers a body that isn't valid JSON with 400, not 500", async () => {
    const res = await app.inject({ method: "POST", url: "/api/receipts", headers: { cookie, "content-type": "application/json" }, payload: "{not json" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });

  it("answers an unknown receipt with a single clean 404", async () => {
    const res = await app.inject({ method: "GET", url: "/api/receipts/NOPE-0000", headers: { cookie } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBeTruthy();
  });
});
