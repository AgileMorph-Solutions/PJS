/**
 * Live quality requests (27 Nov 2026, user): opening a drying form asks the QFS Officer at once; the request stays until the
 * Incharge clicks Cancel (leaving the page doesn't end it); the QFS Officer's reading goes to Approvals first and only an
 * approved reading fills the form (contract domain/qualityRequests.ts). The bugs this guards against: a request cancelled
 * by someone only leaving the page, a QFS reading reaching the form or the round without the Incharge's approval, a
 * measured reading silently lost, or a round checked twice with two different readings.
 *
 * Through the HTTP routes, on throwaway warehouses, as the Incharge and the QFS Officer.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { QualityCheckItem, QualityChecksView } from "@anagroci/contract/domain/qualityChecks";
import type { QualityRequestView } from "@anagroci/contract/domain/qualityRequests";
import { CANCELLED_NOTE, requestTargetId } from "@anagroci/contract/domain/qualityRequests";
import { buildApp } from "../src/app.js";
import { isAllowed } from "../src/auth/policy.js";
import { hashPassword } from "../src/auth/password.js";
import { onChange, type ChangeEvent } from "../src/events/bus.js";
import { createReceipt, setBranch, setStageFields } from "../src/services/receipts.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const UNIT = "QREQ-UNIT";
const UNIT_STORE = "QREQ-UNIT-STORE";
const BIN = "QREQ-BIN-01";
const NEW_BIN = "QREQ-BIN-02";
const GRN = "GRN Weight (kept separate from Gross/Net/Paid)";
const cookies: Record<string, string> = {};
const BEFORE = { inputMoisture: "11.5", inputNutCount: "190" };
const START = { dryType: "SUN DRYING", issuedNetKg: "1000", issuedBags: "12" };

async function cleanup() {
  await prisma.qualityRequest.deleteMany({ where: { warehouse: { in: [UNIT, UNIT_STORE] } } });
  await prisma.qualitySubmission.deleteMany({ where: { warehouse: { in: [UNIT, UNIT_STORE] } } });
  await prisma.dryingBatch.deleteMany({ where: { warehouseSite: UNIT } });
  await prisma.warehouseActivityLedgerEntry.deleteMany({ where: { warehouse: { in: [UNIT, UNIT_STORE] } } });
  await prisma.receipt.deleteMany({ where: { warehouse: { in: [UNIT, UNIT_STORE] } } });
  await prisma.changeLog.deleteMany({ where: { user: { username: { startsWith: "qreq-" } } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "qreq-" } } });
  await prisma.bin.deleteMany({ where: { code: { startsWith: "QREQ-" } } });
  await prisma.warehouse.deleteMany({ where: { site: UNIT } });
  await prisma.warehouse.deleteMany({ where: { name: UNIT } });
}

const call = (who: string, method: "GET" | "POST", url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined, headers: { cookie: cookies[who]!, ...(payload ? { "content-type": "application/json" } : {}) } });
const list = async (who = "qfs"): Promise<QualityChecksView> => (await call(who, "GET", "/api/quality-checks")).json();
const item = async (key: string, who = "qfs"): Promise<QualityCheckItem | undefined> => (await list(who)).items.find((i) => i.key === key);
const open = async (kind: string, scope: object): Promise<QualityRequestView> => (await call("wi", "POST", "/api/quality-requests", { kind, scope })).json();
const get = async (id: number): Promise<QualityRequestView> => (await call("wi", "GET", `/api/quality-requests/${id}`)).json();
const answer = (id: number, values: object, who = "qfs") => call(who, "POST", `/api/quality-requests/${id}/answer`, { values });
const approve = (subId: number) => call("wi", "POST", `/api/quality-submissions/${subId}/approve`, {});
const reject = (subId: number, reason: string) => call("wi", "POST", `/api/quality-submissions/${subId}/reject`, { reason });
const binScope = { kind: "bin", binCode: BIN };
/** A fresh form: whatever an earlier test left open is cancelled first, as the Incharge would. */
async function freshBefore(): Promise<QualityRequestView> {
  await prisma.qualityRequest.updateMany({ where: { warehouse: UNIT, status: { in: ["open", "answered"] } }, data: { status: "cancelled" } });
  return open("drying_before", binScope);
}

beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: UNIT, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "QRQU" } });
  await prisma.warehouse.create({ data: { name: UNIT_STORE, site: UNIT } });
  await prisma.bin.createMany({ data: [{ code: BIN, warehouseName: UNIT_STORE, source: "test" }, { code: NEW_BIN, warehouseName: UNIT_STORE, source: "test" }] });
  const r = await createReceipt(UNIT, "2026-11-01");
  await setBranch(r.id, "n-qfs", "pass");
  await setStageFields(r.id, "n-bin", { "Bin Number": BIN }, { bypassValidation: true });
  await setStageFields(r.id, "n-grn", { [GRN]: "20000", PRICE: "470" }, { bypassValidation: true });
  const users = [["wi", "warehouse_incharge"], ["qfs", "qfs_officer"], ["qfs2", "qfs_officer"]] as const;
  for (const [key, role] of users) {
    await prisma.user.create({ data: { username: `qreq-${key}`, displayName: `QREQ ${key}`, role, warehouse: UNIT_STORE, passwordHash: hashPassword(PW) } });
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `qreq-${key}`, password: PW } });
    cookies[key] = String(res.headers["set-cookie"]).split(";")[0]!;
  }
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

describe("who may do what", () => {
  it("lets the QFS Officer answer and listen, and keeps opening and cancelling the form the Incharge's", () => {
    expect(isAllowed("qfs_officer", "POST", "/api/quality-requests/1/answer")).toBe(true);
    expect(isAllowed("qfs_officer", "GET", "/api/events")).toBe(true);
    expect(isAllowed("branch_manager", "GET", "/api/events")).toBe(true);
    expect(isAllowed("qfs_officer", "POST", "/api/quality-requests")).toBe(false);
    expect(isAllowed("qfs_officer", "POST", "/api/quality-requests/1/cancel")).toBe(false);
    expect(isAllowed("branch_manager", "POST", "/api/quality-requests/1/answer")).toBe(false);
  });
});

describe("before drying: the form asks as it opens, and stays open", () => {
  let id = 0;

  it("puts the check on the QFS Officer's list the moment the form opens", async () => {
    const request = await freshBefore();
    expect(request).toMatchObject({ status: "open", warehouse: UNIT, openedBy: "QREQ wi", values: null });
    id = request.id;
    expect(await item(`request-${id}`)).toMatchObject({ state: "to_do", section: "drying", live: { by: "QREQ wi" }, link: { kind: "form", requestId: id } });
  });

  it("is still there when the Incharge comes back to the page: found, and the same request when the form opens again", async () => {
    expect((await call("wi", "POST", "/api/quality-requests/find", { kind: "drying_before", scope: binScope })).json()).toMatchObject({ request: { id, status: "open" } });
    expect((await open("drying_before", binScope)).id).toBe(id);
    expect((await call("wi", "POST", "/api/quality-requests/find", { kind: "drying_before", scope: { kind: "bin", binCode: NEW_BIN } })).json()).toEqual({ request: null });
  });

  it("sends the QFS Officer's reading to Approvals, once, without touching the form", async () => {
    const res = await answer(id, BEFORE);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ kind: "drying_before", targetId: requestTargetId(id), status: "submitted", values: BEFORE });
    expect((await answer(id, BEFORE, "qfs2")).statusCode).toBe(422);
    expect(await get(id)).toMatchObject({ status: "open", values: null });
    // In the Incharge's Approvals, and on the QFS Officer's list as waiting rather than to do.
    const waiting = (await call("wi", "GET", "/api/quality-submissions?status=submitted")).json() as { id: number; targetId: string }[];
    expect(waiting.some((w) => w.targetId === requestTargetId(id))).toBe(true);
    const view = await list();
    expect(view.items.find((i) => i.key === `request-${id}`)).toBeUndefined();
    expect(view.items.find((i) => i.key === `quality-${res.json().id}`)?.state).toBe("waiting_approval");
  });

  it("puts the check back on the QFS Officer's list when the Incharge rejects it, with the reason", async () => {
    const sub = await prisma.qualitySubmission.findFirstOrThrow({ where: { targetId: requestTargetId(id), status: "submitted" } });
    expect((await reject(sub.id, "Sample not mixed")).statusCode).toBe(200);
    const view = await list();
    expect(view.items.find((i) => i.key === `quality-${sub.id}`)).toMatchObject({ state: "rejected", note: "Sample not mixed" });
    expect(view.items.find((i) => i.key === `request-${id}`)?.state).toBe("to_do");
    expect(await get(id)).toMatchObject({ status: "open", values: null });
  });

  it("fills the form with the reading only once approved, which then saves with the round", async () => {
    const sent = (await answer(id, BEFORE)).json() as { id: number };
    expect((await approve(sent.id)).statusCode).toBe(200);
    expect(await get(id)).toMatchObject({ status: "answered", values: BEFORE, answeredBy: "QREQ qfs" });
    expect((await list()).items.some((i) => i.key === `request-${id}`)).toBe(false);
    // The form now carries the approved reading: it is saved as the round's quality going onto the yard.
    const res = await call("wi", "POST", `/api/bins/${BIN}/drying`, { ...START, ...BEFORE, qualityRequestId: id });
    expect(res.statusCode).toBe(201);
    expect(Number((await prisma.dryingBatch.findUniqueOrThrow({ where: { id: res.json().id } })).inputMoisturePct)).toBe(11.5);
    expect(await get(id)).toMatchObject({ status: "used", roundId: null });
  });
});

describe("before drying: Cancel", () => {
  it("takes an unanswered request off the list", async () => {
    const request = await freshBefore();
    expect((await call("wi", "POST", `/api/quality-requests/${request.id}/cancel`)).json()).toMatchObject({ status: "cancelled" });
    expect((await list()).items.some((i) => i.key === `request-${request.id}`)).toBe(false);
  });

  it("withdraws a check still waiting in Approvals, and tells only the QFS Officer who sent it", async () => {
    const request = await freshBefore();
    const sent = (await answer(request.id, BEFORE)).json() as { id: number };
    await call("wi", "POST", `/api/quality-requests/${request.id}/cancel`);
    expect(await prisma.qualitySubmission.findUniqueOrThrow({ where: { id: sent.id } })).toMatchObject({ status: "cancelled", rejectReason: CANCELLED_NOTE });
    expect(await item(`quality-${sent.id}`)).toMatchObject({ state: "cancelled", note: CANCELLED_NOTE });
    expect(await item(`quality-${sent.id}`, "qfs2")).toBeUndefined();
    expect(((await call("wi", "GET", "/api/quality-submissions?status=submitted")).json() as { id: number }[]).some((w) => w.id === sent.id)).toBe(false);
    expect((await answer(request.id, BEFORE)).statusCode).toBe(422);
  });
});

describe("before drying: the round started while the check waited, or before it came", () => {
  it("makes a check still waiting the round's, approved onto the round", async () => {
    const request = await freshBefore();
    const sent = (await answer(request.id, BEFORE)).json() as { id: number };
    // A reading typed over one waiting for approval is refused: one reading per round.
    expect((await call("wi", "POST", `/api/bins/${BIN}/drying`, { ...START, inputMoisture: "12", qualityRequestId: request.id })).statusCode).toBe(422);
    const res = await call("wi", "POST", `/api/bins/${BIN}/drying`, { ...START, qualityRequestId: request.id });
    const roundId = res.json().id as string;
    expect(await prisma.qualitySubmission.findUniqueOrThrow({ where: { id: sent.id } })).toMatchObject({ targetId: roundId, status: "submitted" });
    expect((await prisma.dryingBatch.findUniqueOrThrow({ where: { id: roundId } })).inputMoisturePct).toBeNull();
    expect((await approve(sent.id)).statusCode).toBe(200);
    expect(Number((await prisma.dryingBatch.findUniqueOrThrow({ where: { id: roundId } })).inputMoisturePct)).toBe(11.5);
  });

  it("keeps the same line on the QFS Officer's list for the round's check, which the reading then answers", async () => {
    const request = await freshBefore();
    const roundId = (await call("wi", "POST", `/api/bins/${BIN}/drying`, { ...START, qualityRequestId: request.id })).json().id as string;
    const view = await list();
    expect(view.items.find((i) => i.key === `drying_before-${roundId}`)).toBeUndefined();
    expect(view.items.find((i) => i.key === `request-${request.id}`)).toMatchObject({ state: "to_do", reference: expect.stringMatching(/^Drying round 1 of Bin/), link: { targetId: roundId, requestId: request.id } });
    const sent = await answer(request.id, BEFORE);
    expect(sent.json()).toMatchObject({ targetId: roundId, status: "submitted" });
    expect((await list()).items.some((i) => i.key === `request-${request.id}`)).toBe(false);
  });
});

describe("after drying", () => {
  let roundId = "";
  let requestId = 0;

  it("marks the round's check as waited for while the Incharge's check form is open", async () => {
    const started = await call("wi", "POST", `/api/bins/${BIN}/drying`, { ...START, ...BEFORE });
    roundId = started.json().id;
    expect((await call("wi", "POST", `/api/drying-batches/${roundId}/return`, { receivedNetKg: "950" })).statusCode).toBe(200);
    expect((await item(`drying_after-${roundId}`))?.live).toBeUndefined();
    requestId = (await open("drying_after", { kind: "round", roundId })).id;
    expect((await item(`drying_after-${roundId}`))?.live).toMatchObject({ by: "QREQ wi" });
  });

  it("sends the QFS Officer's check to Approvals, which the Incharge can't enter over, and Cancel leaves it there", async () => {
    const sent = await answer(requestId, { outputMoisture: "8", decision: "pass", destinationBin: NEW_BIN });
    expect(sent.json()).toMatchObject({ kind: "drying_after", targetId: roundId, status: "submitted" });
    const direct = await call("wi", "POST", `/api/drying-batches/${roundId}/check`, { decision: "pass", outputMoisture: "7", destinationBin: NEW_BIN });
    expect(direct.statusCode).toBe(422);
    expect(direct.json().error).toMatch(/waiting in Approvals/);
    await call("wi", "POST", `/api/quality-requests/${requestId}/cancel`);
    expect(await prisma.qualitySubmission.findUniqueOrThrow({ where: { id: sent.json().id } })).toMatchObject({ status: "submitted" });
  });

  it("records the check when approved, and the form that asked is done", async () => {
    requestId = (await open("drying_after", { kind: "round", roundId })).id;
    const sub = await prisma.qualitySubmission.findFirstOrThrow({ where: { kind: "drying_after", targetId: roundId, status: "submitted" } });
    expect((await approve(sub.id)).statusCode).toBe(200);
    expect(Number((await prisma.dryingBatch.findUniqueOrThrow({ where: { id: roundId } })).outputMoisturePct)).toBe(8);
    expect(await get(requestId)).toMatchObject({ status: "used" });
  });
});

describe("live updates", () => {
  it("announces each saved change, an approval included, at the warehouse it happened at; not a read", async () => {
    const heard: ChangeEvent[] = [];
    const stop = onChange((e) => heard.push(e));
    try {
      const request = await freshBefore();
      expect(heard).toContainEqual({ warehouse: UNIT });
      heard.length = 0;
      await call("wi", "POST", "/api/quality-requests/find", { kind: "drying_before", scope: binScope });
      await call("qfs", "GET", "/api/quality-checks");
      expect(heard).toEqual([]);
      const sent = (await answer(request.id, BEFORE)).json() as { id: number };
      expect(heard).toEqual([{ warehouse: UNIT }]);
      heard.length = 0;
      await approve(sent.id);
      expect(heard).toEqual([{ warehouse: UNIT }]);
    } finally { stop(); }
  });
});
