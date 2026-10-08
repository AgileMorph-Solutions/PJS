-- Cut-test grams for the sample and final panels (the client's Warehouse Receiving columns), so KOR can
-- be calculated from them. All nullable text like every stage column; KOR / FINAL KOR stay typed until
-- the grams are recorded, because the 2026 Truck Reception sheet only ever held the final numbers.

-- AlterTable
ALTER TABLE "StageQualityQfs" ADD COLUMN     "finalGoodKernelG" TEXT,
ADD COLUMN     "finalImmatureG" TEXT,
ADD COLUMN     "finalOilG" TEXT,
ADD COLUMN     "finalRejectionG" TEXT,
ADD COLUMN     "finalShellG" TEXT,
ADD COLUMN     "finalSpottedG" TEXT,
ADD COLUMN     "finalVoidG" TEXT,
ADD COLUMN     "sampleGoodKernelG" TEXT,
ADD COLUMN     "sampleImmatureG" TEXT,
ADD COLUMN     "sampleOilG" TEXT,
ADD COLUMN     "sampleRejectionG" TEXT,
ADD COLUMN     "sampleShellG" TEXT,
ADD COLUMN     "sampleSpottedG" TEXT,
ADD COLUMN     "sampleVoidG" TEXT;

