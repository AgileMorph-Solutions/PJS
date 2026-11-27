-- A live quality request (27 Nov 2026): the Incharge's open drying form asking the QFS Officer for its quality.
CREATE TABLE "QualityRequest" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "warehouse" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "openedById" TEXT NOT NULL,
    "values" JSONB,
    "answeredById" TEXT,
    "answeredAt" TIMESTAMP(3),
    "roundId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QualityRequest_warehouse_status_idx" ON "QualityRequest"("warehouse", "status");
CREATE INDEX "QualityRequest_kind_scope_status_idx" ON "QualityRequest"("kind", "scope", "status");

ALTER TABLE "QualityRequest" ADD CONSTRAINT "QualityRequest_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualityRequest" ADD CONSTRAINT "QualityRequest_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
