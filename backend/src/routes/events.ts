/**
 * Live updates (27 Nov 2026): one Server-Sent Events stream per open tab, saying only "something changed at your
 * warehouse" (events/bus.ts). Every saved change is announced by the hook below, so no service has to remember to; a
 * page decides for itself whether to read again. A plain GET that stays open: the session cookie and auth/policy.ts gate
 * it like any other route.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { currentSite } from "../auth/plugin.js";
import { onChange, publishChange } from "../events/bus.js";

/** Requests that change nothing anyone else reads: signing in or out, a drying form looking for its open request. */
const QUIET = [/^\/api\/auth\//, /^\/api\/quality-requests\/find$/];
/** Keeps the connection through nginx's 60 s read timeout and proxies that drop an idle line. */
const KEEPALIVE_MS = 25_000;

const siteOfCaller = (req: FastifyRequest): string | null => (req.user ? currentSite(req) : null);

/** Announces every successful write at the caller's warehouse. Registered after auth, so the caller is known. */
export function registerChangeEvents(app: FastifyInstance) {
  app.addHook("onResponse", async (req, reply) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS" || reply.statusCode >= 400) return;
    const path = req.url.split("?")[0]!;
    if (!path.startsWith("/api/") || QUIET.some((p) => p.test(path))) return;
    publishChange({ warehouse: siteOfCaller(req) });
  });
}

export async function eventRoutes(app: FastifyInstance) {
  app.get("/api/events", (req, reply) => {
    const mine = siteOfCaller(req);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx would otherwise hold the stream back until its buffer fills (nginx.conf proxies /api/ with buffering on).
      "X-Accel-Buffering": "no",
    });
    reply.raw.write("retry: 5000\n\n");
    // An Admin (no warehouse of their own) hears every warehouse; anyone else theirs, and the changes an Admin makes.
    const stop = onChange((e) => {
      if (mine && e.warehouse && e.warehouse !== mine) return;
      reply.raw.write(`event: change\ndata: ${JSON.stringify(e)}\n\n`);
    });
    const keepalive = setInterval(() => reply.raw.write(": keepalive\n\n"), KEEPALIVE_MS);
    req.raw.on("close", () => { clearInterval(keepalive); stop(); });
  });
}
