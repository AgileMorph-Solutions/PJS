import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { demoUsersFor, ensureDemoUsers } from "../prisma/demoUsers.js";
import { isRole } from "@anagroci/contract/data/roles";
import { verifyPassword } from "../src/auth/password.js";

const prisma = new PrismaClient();
const SITE = "DEMOTEST SITE";
afterAll(() => prisma.$disconnect());

// Demo accounts follow the Warehouses master: no site is named in code, and a non-admin only ever lands on a typed
// site (the same rule the users API enforces), or they'd have no section to land in.
describe("demo users", () => {
  it("gives every site one of each non-admin role, plus one admin", () => {
    const users = demoUsersFor(["NORTH HUB", "MAIN PLANT"]);
    expect(users.filter((u) => u.role === "admin")).toHaveLength(1);
    for (const role of ["branch_manager", "qfs_officer", "warehouse_incharge"]) {
      expect(users.filter((u) => u.role === role).map((u) => u.warehouse).sort(), role).toEqual(["MAIN PLANT", "NORTH HUB"]);
    }
    expect(users.map((u) => u.username)).toContain("incharge.north-hub");
    expect(users.every((u) => isRole(u.role))).toBe(true);
    expect(demoUsersFor([]).map((u) => u.role)).toEqual(["admin"]);
  });

  it("creates nothing unless explicitly enabled with a password", async () => {
    expect(await ensureDemoUsers(prisma, {})).toEqual([]);
    expect(await ensureDemoUsers(prisma, { SEED_DEMO_USERS: "true" })).toEqual([]);
    expect(await ensureDemoUsers(prisma, { DEMO_PASSWORD: "x-pass-123" })).toEqual([]);
  });

  describe("when enabled", () => {
    const existing = new Set<string>();
    beforeAll(async () => {
      await prisma.warehouse.upsert({ where: { name: SITE }, update: { type: "UNIT", code: "DMT" }, create: { name: SITE, kind: "VILLAGE", type: "UNIT", code: "DMT" } });
      for (const u of await prisma.user.findMany({ select: { username: true } })) existing.add(u.username);
    });
    afterAll(async () => {
      // Only remove what this test created — the dev database may already have real demo users.
      await prisma.user.deleteMany({ where: { username: { notIn: [...existing] } } });
      await prisma.warehouse.deleteMany({ where: { name: SITE } });
    });

    it("puts accounts on every typed site in the master, idempotently, never resetting a password", async () => {
      const env = { SEED_DEMO_USERS: "true", DEMO_PASSWORD: "first-pass-123" };
      await ensureDemoUsers(prisma, env);
      expect(await ensureDemoUsers(prisma, { ...env, DEMO_PASSWORD: "second-pass-123" })).toEqual([]);
      const u = await prisma.user.findUniqueOrThrow({ where: { username: "manager.demotest-site" } });
      expect(u.warehouse).toBe(SITE);
      expect(verifyPassword("first-pass-123", u.passwordHash)).toBe(true);
      expect(verifyPassword("second-pass-123", u.passwordHash)).toBe(false);
    });
  });
});
