/**
 * What the workbook needs to know about a table — column order, types, required-ness, foreign keys
 * and unique sets — read from Prisma's own data model rather than a hand-kept list, so the workbook
 * can't drift from the schema (and an empty table still has its header).
 */
import { Prisma } from "@prisma/client";

export interface ColInfo {
  name: string;
  /** Prisma scalar type: String, Int, Float, Decimal, DateTime, Boolean, … */
  type: string;
  required: boolean;
  hasDefault: boolean;
  isId: boolean;
}

function modelOf(name: string) {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === name);
  if (!m) throw new Error(`Unknown model "${name}"`);
  return m;
}

/** A table's own columns, in schema order. */
export function columnInfo(model: string): Map<string, ColInfo> {
  return new Map(
    modelOf(model).fields
      .filter((f) => f.kind === "scalar" || f.kind === "enum")
      .map((f) => [f.name, { name: f.name, type: f.type, required: f.isRequired, hasDefault: f.hasDefaultValue, isId: f.isId }])
  );
}

export const tableColumns = (model: string): string[] => [...columnInfo(model).keys()];

/** The Prisma client delegate for a model (`JuteWarehouseMovement` -> `juteWarehouseMovement`). */
export const delegateOf = (model: string): string => model.charAt(0).toLowerCase() + model.slice(1);

export interface ForeignKey { column: string; targetModel: string; targetColumn: string }

/** Real (declared) foreign keys only — soft references (e.g. Bin.warehouseName) aren't enforced by
 * the database, so they aren't enforced here either. */
export function foreignKeys(model: string): ForeignKey[] {
  return modelOf(model).fields
    .filter((f) => f.kind === "object" && (f.relationFromFields?.length ?? 0) === 1)
    .map((f) => ({ column: f.relationFromFields![0], targetModel: f.type, targetColumn: f.relationToFields![0] }));
}

/** Unique sets other than the primary key: composite `@@unique` and single-column `@unique`. */
export function uniqueSets(model: string): string[][] {
  const m = modelOf(model);
  return [
    ...m.uniqueFields.map((s) => [...s]),
    ...m.fields.filter((f) => f.isUnique && !f.isId).map((f) => [f.name]),
  ];
}
