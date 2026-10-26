-- When an Origin was added from Masters › Origins. Existing Origins stay NULL: they were observed in the workbooks and no date is invented for them.
ALTER TABLE "Origin" ADD COLUMN "createdAt" TIMESTAMP(3);
