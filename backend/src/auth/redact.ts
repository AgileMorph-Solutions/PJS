/**
 * Removes from a response what the caller's role may not see (contract HIDDEN_FIELDS: price and amount for the Warehouse
 * Incharge). It runs on every response, in one hook (registerAuth), so no route can forget it: any part of the payload that is a
 * set of stage values ({"n-grn": {PRICE: …}}: a receipt's stageData, a submission's values, a preview's stages) loses the
 * hidden fields, and a field-change entry ({stageId, label, …}) about a hidden field is dropped.
 */
import { HIDDEN_FIELDS, redactStageData, type Role } from "@anagroci/contract/data/roles";

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
const STAGE_ID = /^n-[a-z]+$/;
const isStageValues = (v: Plain) => {
  const keys = Object.keys(v);
  return keys.length > 0 && keys.every((k) => STAGE_ID.test(k) && isPlain(v[k]));
};

export function redactForRole(payload: unknown, role: Role): unknown {
  const hidden = HIDDEN_FIELDS[role];
  if (!hidden?.length) return payload;
  const isHiddenChange = (v: Plain) =>
    typeof v.stageId === "string" && typeof v.label === "string" && hidden.some(([s, l]) => s === v.stageId && l === v.label);
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.filter((x) => !(isPlain(x) && isHiddenChange(x))).map(walk);
    if (!isPlain(v)) return v;
    if (isStageValues(v)) return redactStageData(v as Record<string, Record<string, string>>, role);
    const out: Plain = {};
    for (const [k, x] of Object.entries(v)) out[k] = walk(x);
    return out;
  };
  return walk(payload);
}
