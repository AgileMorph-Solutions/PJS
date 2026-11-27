/**
 * "Something changed at this warehouse" (27 Nov 2026, user: the QFS Officer had to reload the page to see a check the
 * Incharge had just asked for). Every saved change is announced here, and every open page that listens (routes/events.ts)
 * reads its own records again. The announcement carries no data: the page re-reads through the same routes as always, so
 * what it shows is never a second copy that could disagree with them.
 *
 * In-process on purpose: the API runs as one process (docker-compose.prod.yml). Run several and this would need a shared
 * channel (Postgres LISTEN/NOTIFY), with the same publish/subscribe shape.
 */
import { EventEmitter } from "node:events";

export interface ChangeEvent {
  /** The site it happened at; null when the person who made it has no warehouse of their own (an Admin): every page hears it. */
  warehouse: string | null;
}

const bus = new EventEmitter();
// One listener per open page; the default cap of 10 would warn about an ordinary busy day.
bus.setMaxListeners(0);

export function publishChange(event: ChangeEvent): void {
  bus.emit("change", event);
}

export function onChange(listener: (event: ChangeEvent) => void): () => void {
  bus.on("change", listener);
  return () => { bus.off("change", listener); };
}
