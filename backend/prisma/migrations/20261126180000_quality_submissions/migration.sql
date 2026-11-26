-- A QFS Officer's quality check on a warehouse record that had no approval step (26 Nov 2026): drying before/after, a transfer
-- lot's quality, the moisture after triage. Readings only, applied on the Warehouse Incharge's approval.
CREATE TABLE "QualitySubmission" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "warehouse" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "submittedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualitySubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QualitySubmission_kind_targetId_idx" ON "QualitySubmission"("kind", "targetId");
CREATE INDEX "QualitySubmission_warehouse_status_idx" ON "QualitySubmission"("warehouse", "status");

ALTER TABLE "QualitySubmission" ADD CONSTRAINT "QualitySubmission_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualitySubmission" ADD CONSTRAINT "QualitySubmission_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
