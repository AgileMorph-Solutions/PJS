import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { DEMO_USERS, ensureDemoUsers } from "../prisma/demoUsers.js";
import { isRole } from "@anagroci/contract/data/roles";
import { verifyPassword } from "../src/auth/password.js";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

// Demo accounts are opt-in and must satisfy the same rule the users API enforces: non-admins sit on
// a typed site, or they'd have no section to land in.
describe("demo users", () => {
  it("covers each of the four roles exactly once", () => {
    expect(DEMO_USERS.map((u) => u.role).sort()).toEqual(["admin", "branch_manager", "qfs_officer", "warehouse_incharge"]);
    expect(DEMO_USERS.every((u) => isRole(u.role))).toBe(true);
  });

  it("creates nothing unless explicitly enabled with a password", async () => {
    expect(await ensureDemoUsers(prisma, {})).toEqual([]);
    expect(await ensureDemoUsers(prisma, { SEED_DEMO_USERS: "true" })).toEqual([]);
    expect(await ensureDemoUsers(prisma, { DEMO_PASSWORD: "x-pass-123" })).toEqual([]);
  });

  it("assigns every non-admin to a typed site", async () => {
    for (const u of DEMO_USERS.filter((x) => x.role !== "admin")) {
      const wh = await prisma.warehouse.findUnique({ where: { name: u.warehouse! } });
      expect(wh?.site, u.username).toBeNull();
      expect(wh?.type, u.username).toBeTruthy();
    }
  });

  describe("when enabled", () => {
    const existing = new Map<string, boolean>();
    beforeAll(async () => {
      for (const u of DEMO_USERS) existing.set(u.username, Boolean(await prisma.user.findUnique({ where: { username: u.username } })));
    });
    afterAll(async () => {
      // Only remove what this test created — the dev database may already have real demo users.
      for (const u of DEMO_USERS) if (!existing.get(u.username)) await prisma.user.deleteMany({ where: { username: u.username } });
    });

    it("is idempotent and never resets an existing user's password", async () => {
      const env = { SEED_DEMO_USERS: "true", DEMO_PASSWORD: "first-pass-123" };
      await ensureDemoUsers(prisma, env);
      expect(await ensureDemoUsers(prisma, { ...env, DEMO_PASSWORD: "second-pass-123" })).toEqual([]);
      const u = await prisma.user.findUniqueOrThrow({ where: { username: "manager.bouake" } });
      // Password is whatever was there first: either the pre-existing one, or our first-pass.
      if (!existing.get("manager.bouake")) expect(verifyPassword("first-pass-123", u.passwordHash)).toBe(true);
      expect(verifyPassword("second-pass-123", u.passwordHash)).toBe(false);
    });
  });
});
