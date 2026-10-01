/**
 * A previewed upload, held in memory until it's committed or expires. Single-instance, like the
 * existing import preview cache (services/imports.ts) — restart the process and pending previews
 * are gone, which just means "preview again". Used exactly once: a token can't be committed twice.
 */
import { randomUUID } from "node:crypto";
import type { ParsedWorkbook } from "./types.js";

export interface PreviewEntry {
  userId: string;
  warehouse: string;
  filename: string;
  parsed: ParsedWorkbook;
}

const TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, PreviewEntry & { expires: number }>();

export function cachePut(entry: PreviewEntry): string {
  const now = Date.now();
  for (const [k, v] of cache) if (v.expires < now) cache.delete(k);
  const token = randomUUID();
  cache.set(token, { ...entry, expires: now + TTL_MS });
  return token;
}

export function cacheTake(token: string): PreviewEntry | undefined {
  const hit = cache.get(token);
  cache.delete(token);
  return hit && hit.expires >= Date.now() ? hit : undefined;
}
