-- Nov 2026 client request: sample (at arrival) and final (after unloading) moisture and nut count.
ALTER TABLE "StageQualityQfs" ADD COLUMN "sampleMoisture" TEXT,
ADD COLUMN "finalMoisture" TEXT,
ADD COLUMN "sampleNutCount" TEXT,
ADD COLUMN "finalNutCount" TEXT;
