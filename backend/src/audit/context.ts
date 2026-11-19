/**
 * Who is saving, and how, for the change log (audit/changeLog.ts). Set once per request by registerAuditContext, so no
 * service has to pass it down: every write the request makes is logged against the signed-in person. Outside a request
 * (the seeder, scripts, tests calling services directly) there is no person, and nothing is logged (db.ts).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { FastifyInstance } from "fastify";

export type Via = "direct" | "approval" | "import" | "system";

export interface AuditContext {
  userId: string | null;
  via: Via;
  /** The open interactive transaction, so the log reads the old values and writes its rows inside it (db.ts). */
  tx?: unknown;
}

export const auditStore = new AsyncLocalStorage<AuditContext>();

export const currentAudit = (): AuditContext => auditStore.getStore() ?? { userId: null, via: "system" };

/** Runs `fn` with this context; nested calls see the merged one. */
export function withAudit<T>(patch: Partial<AuditContext>, fn: () => T): T {
  return auditStore.run({ ...currentAudit(), ...patch }, fn);
}

/**
 * How a request writes, from its route: a workbook or import commit is an upload, an approve is an approved form, the
 * rest is a direct edit. One rule here rather than a flag on every service call, so a new route can't forget it.
 */
export function viaForPath(method: string, path: string): Via {
  if (method !== "GET" && /\/commit$/.test(path)) return "import";
  if (method !== "GET" && /\/approve(-all)?$/.test(path)) return "approval";
  return "direct";
}

/**
 * Opens the context for every request, before auth: the callback form of the hook keeps the rest of the request inside
 * it (an async hook's own context would end when it returns). Auth then fills in who it is (auth/plugin.ts).
 */
export function registerAuditContext(app: FastifyInstance) {
  app.addHook("onRequest", (req, _reply, done) => {
    auditStore.run({ userId: null, via: viaForPath(req.method, req.url.split("?")[0]!) }, done);
  });
}
