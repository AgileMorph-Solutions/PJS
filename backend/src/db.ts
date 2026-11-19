/**
 * The one database client every service uses. Every write a signed-in person makes goes through the change log
 * (audit/changeLog.ts): a hook on all models reads the old values, runs the write and records what changed. Inside `prisma.$transaction(async (tx) => …)` the
 * log reads and writes through that same transaction, so a save that is rolled back leaves no log row.
 *
 * Use the callback form of $transaction. The list form (`$transaction([q1, q2])`) can't carry the log's own reads and
 * writes, so it isn't offered here.
 */
import { PrismaClient } from "@prisma/client";
import { isLogged, loggedWrite } from "./audit/changeLog.js";
import { auditStore, currentAudit } from "./audit/context.js";

const base = new PrismaClient();

const logged = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        // Only a person's changes are logged: a write no signed-in person made (the seeder, scripts, tests) isn't.
        const audit = currentAudit();
        if (!isLogged(model, operation) || !audit.userId) return query(args);
        return loggedWrite((audit.tx ?? base) as Record<string, any>, model, operation, args, query);
      },
    },
  },
});

const runTransaction = logged.$transaction.bind(logged) as (...a: any[]) => Promise<any>;

/** The logged client, with $transaction putting the open transaction where the log can reach it. */
export const prisma = new Proxy(logged, {
  get(target, prop, receiver) {
    if (prop === "$transaction") {
      return (fn: unknown, opts?: unknown) => {
        if (typeof fn !== "function") throw new Error("Use prisma.$transaction(async (tx) => …): the change log needs the callback form.");
        return runTransaction((tx: unknown) => auditStore.run({ ...currentAudit(), tx }, () => (fn as (tx: unknown) => unknown)(tx)), opts);
      };
    }
    return Reflect.get(target, prop, receiver);
  },
}) as unknown as PrismaClient;
