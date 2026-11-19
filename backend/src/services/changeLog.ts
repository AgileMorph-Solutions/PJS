/**
 * Reads the change log (written by audit/changeLog.ts) for the Logs page: newest first, between two dates, for the
 * warehouses a person may see. A row belongs to the warehouses of its record (a BKT: both ends); a row that belongs to
 * none (users, supplier access) is an admin's only, and an admin who picks no warehouse sees everything.
 */
import type { ChangeLogRecord } from "@anagroci/contract/types/changeLog";
import { prisma } from "../db.js";
import { entityLabel, fieldLabel } from "../audit/labels.js";
import { SITE_LOG_LIMIT } from "./fieldHistory.js";

export async function listChangeLog(site: string[] | undefined, from?: string, to?: string): Promise<ChangeLogRecord[]> {
  const at = {
    ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}),
    ...(to ? { lt: new Date(new Date(`${to}T00:00:00Z`).getTime() + 86400000) } : {}),
  };
  const rows = await prisma.changeLog.findMany({
    where: { ...(site ? { warehouses: { hasSome: site } } : {}), ...(from || to ? { at } : {}) },
    include: { user: { select: { displayName: true } } },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: SITE_LOG_LIMIT,
  });
  return rows.map((r) => {
    const { label, area } = entityLabel(r.entity);
    return {
      id: r.id, at: r.at.toISOString(), by: r.user?.displayName ?? "Deleted user", via: r.via as ChangeLogRecord["via"],
      action: r.action as ChangeLogRecord["action"], entity: r.entity, entityLabel: label, area,
      recordId: r.recordId, field: r.field, fieldLabel: fieldLabel(r.entity, r.field, r.recordId), oldValue: r.oldValue, newValue: r.newValue,
    };
  });
}
