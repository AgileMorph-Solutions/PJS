-- The LBA register (client's Oct 2026 table): a permanent supplier ID, a three-way status with a reason, location,
-- contact, registration and bank details, and who created / last changed the supplier. Existing suppliers keep their
-- LBA code; they get SUP-0001… in the order they were created, and "switched off" becomes "inactive".

CREATE SEQUENCE "supplier_no_seq";

ALTER TABLE "Supplier"
ADD COLUMN "supplierNo" TEXT,
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN "statusReason" TEXT,
ADD COLUMN "tradeName" TEXT,
ADD COLUMN "zone" TEXT,
ADD COLUMN "region" TEXT,
ADD COLUMN "managerName" TEXT,
ADD COLUMN "managerPosition" TEXT,
ADD COLUMN "phonePrimary" TEXT,
ADD COLUMN "phoneSecondary" TEXT,
ADD COLUMN "email" TEXT,
ADD COLUMN "address" TEXT,
ADD COLUMN "registrationRef" TEXT,
ADD COLUMN "bankAccountHolder" TEXT,
ADD COLUMN "bankName" TEXT,
ADD COLUMN "bankAccountRef" TEXT,
ADD COLUMN "detailsSource" TEXT,
ADD COLUMN "createdById" TEXT,
ADD COLUMN "updatedById" TEXT;

-- Number the existing suppliers in creation order, then let the sequence carry on after them.
UPDATE "Supplier" s SET "supplierNo" = 'SUP-' || lpad(x.n::text, 4, '0')
FROM (SELECT code, row_number() OVER (ORDER BY "createdAt", code) AS n FROM "Supplier") x
WHERE s.code = x.code;
SELECT setval('supplier_no_seq', GREATEST((SELECT count(*) FROM "Supplier"), 1), (SELECT count(*) FROM "Supplier") > 0);

ALTER TABLE "Supplier" ALTER COLUMN "supplierNo" SET DEFAULT ('SUP-'::text || lpad((nextval('supplier_no_seq'::regclass))::text, 4, '0'::text));
ALTER TABLE "Supplier" ALTER COLUMN "supplierNo" SET NOT NULL;
ALTER SEQUENCE "supplier_no_seq" OWNED BY "Supplier"."supplierNo";
CREATE UNIQUE INDEX "Supplier_supplierNo_key" ON "Supplier"("supplierNo");

-- Switched off becomes inactive, with the reason it already had in practice.
UPDATE "Supplier" SET "status" = 'inactive', "statusReason" = 'Removed from the list while still used by other records'
WHERE "active" = false;
ALTER TABLE "Supplier" DROP COLUMN "active";

ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
