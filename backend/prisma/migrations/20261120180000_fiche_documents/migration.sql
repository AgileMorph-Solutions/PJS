-- The photo or scan of a truck's CCA fiche, kept on its receipt (see schema.prisma's FicheDocument).
CREATE TABLE "FicheDocument" (
    "receiptId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT,
    "reading" JSONB,
    "readAt" TIMESTAMP(3),
    "readModel" TEXT,
    "readError" TEXT,
    CONSTRAINT "FicheDocument_pkey" PRIMARY KEY ("receiptId")
);

ALTER TABLE "FicheDocument" ADD CONSTRAINT "FicheDocument_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FicheDocument" ADD CONSTRAINT "FicheDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
