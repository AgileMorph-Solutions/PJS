-- WarehouseDischarge.lotNo collides 100% between sites (Bouaké lots 1-454, Yamoussoukro lots
-- 1-256, all 256 already exist as Bouaké lot numbers) — see schema.prisma's model comment and
-- the plan doc's "blocker 1". Replace lotNo as PK with a surrogate id, and key uniqueness on
-- (warehouseSite, lotNo) instead, mirroring StageLotAssignment's per-warehouse unique index.
--
-- Hand-written (not `prisma migrate dev`) because adding a required column to a populated table
-- needs interactive resolution that this environment can't provide — applied via `migrate deploy`
-- instead, per backend/CLAUDE.md's "Prisma conventions" and the repo's non-interactive deploy flow.

-- AlterTable: add id as nullable first, backfill, then tighten.
ALTER TABLE "WarehouseDischarge" ADD COLUMN "id" TEXT;

UPDATE "WarehouseDischarge" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;

ALTER TABLE "WarehouseDischarge" ALTER COLUMN "id" SET NOT NULL;

-- warehouseSite: confirmed 0/454 rows null (see the two-blocker verification in the plan doc).
ALTER TABLE "WarehouseDischarge" ALTER COLUMN "warehouseSite" SET NOT NULL;

-- Swap the primary key from lotNo to the new surrogate id.
ALTER TABLE "WarehouseDischarge" DROP CONSTRAINT "WarehouseDischarge_pkey";
ALTER TABLE "WarehouseDischarge" ADD CONSTRAINT "WarehouseDischarge_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseDischarge_warehouseSite_lotNo_key" ON "WarehouseDischarge"("warehouseSite", "lotNo");

-- CreateIndex
CREATE INDEX "WarehouseDischarge_warehouseSite_idx" ON "WarehouseDischarge"("warehouseSite");
