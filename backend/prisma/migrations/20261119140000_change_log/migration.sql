-- Every saved change to any record outside a truck's steps (see schema.prisma's ChangeLog).
CREATE TABLE "ChangeLog" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "via" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "recordId" TEXT,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "warehouses" TEXT[],
    CONSTRAINT "ChangeLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChangeLog_at_idx" ON "ChangeLog"("at");
CREATE INDEX "ChangeLog_entity_recordId_idx" ON "ChangeLog"("entity", "recordId");
CREATE INDEX "ChangeLog_warehouses_idx" ON "ChangeLog" USING GIN ("warehouses");

ALTER TABLE "ChangeLog" ADD CONSTRAINT "ChangeLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
