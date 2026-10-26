/** Creating an Origin from Masters: capitals, unique even across spellings, not mistaken for an upload's orphan. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { scanAll } from "../src/domain/dataQuality/index.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
let cookie = "";
let qfsCookie = "";

async function cleanup() {
  await prisma.origin.deleteMany({ where: { name: { startsWith: "ORGC" } } });
  await prisma.user.deleteMany({ where: { username: { in: ["orgc-wi", "orgc-qfs"] } } });
}
const login = async (username: string) =>
  String((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: PW } })).headers["set-cookie"]).split(";")[0]!;

beforeAll(async () => {
  await cleanup();
  const site = await prisma.warehouse.findFirstOrThrow({ where: { site: null, type: { not: null } }, select: { name: true } });
  await prisma.user.create({ data: { username: "orgc-wi", displayName: "Ama", role: "warehouse_incharge", warehouse: site.name, passwordHash: hashPassword(PW) } });
  await prisma.user.create({ data: { username: "orgc-qfs", displayName: "Kofi", role: "qfs_officer", warehouse: site.name, passwordHash: hashPassword(PW) } });
  cookie = await login("orgc-wi");
  qfsCookie = await login("orgc-qfs");
});
afterAll(async () => { await cleanup(); await prisma.$disconnect(); await app.close(); });

const post = (payload: unknown, c = cookie) =>
  app.inject({ method: "POST", url: "/api/masters/origins", payload: payload as object, headers: { cookie: c, "content-type": "application/json" } });

describe("creating an Origin", () => {
  it("stores it in capitals, stamped as entered with when it was made, and the masters list carries it", async () => {
    const res = await post({ name: "  orgc   kassou " });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: "ORGC KASSOU", source: "entered" });
    expect(res.json().createdAt).toBeTruthy();
    const masters = (await app.inject({ method: "GET", url: "/api/masters", headers: { cookie } })).json();
    expect(masters.origins).toContain("ORGC KASSOU");
    expect(masters.originInfo).toContainEqual(expect.objectContaining({ name: "ORGC KASSOU", source: "entered" }));
  });

  it("refuses an exact duplicate, the same town spelled another way, a blank name and stray symbols", async () => {
    const cases: [object, RegExp][] = [
      [{ name: "orgc kassou" }, /already exists/],
      [{ name: "ORGC KKASSOU" }, /ORGC KASSOU is already in the master/],
      [{ name: "ORGC'KASSOU" }, /ORGC KASSOU is already in the master/],
      [{ name: "   " }, /needs a name/],
      [{ name: "ORGC/2" }, /can only use letters/],
    ];
    for (const [body, message] of cases) {
      const res = await post(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(422);
      expect(res.json().error).toMatch(message);
    }
    expect(await prisma.origin.count({ where: { name: { startsWith: "ORGC" } } })).toBe(1);
  });

  it("is closed to a QFS Officer, who can only read the masters", async () => {
    expect((await post({ name: "ORGC QFS" }, qfsCookie)).statusCode).toBe(403);
  });

  it("is not reported as an upload's origin missing from the curated master", async () => {
    const findings = (await scanAll()).checks;
    const orphan = findings.find((f) => f.id === "origin_not_in_master");
    expect(orphan?.sampleIds ?? []).not.toContain("ORGC KASSOU");
    const fromUploads = await prisma.origin.count({ where: { source: { notIn: ["seed/origins.json", "entered"] } } });
    expect(orphan?.affectedCount ?? 0).toBe(fromUploads);
  });
});
