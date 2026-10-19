-- When a Bin was created in the app. Existing Bins stay NULL: their creation date was never recorded and none is invented.
ALTER TABLE "Bin" ADD COLUMN "createdAt" TIMESTAMP(3);
