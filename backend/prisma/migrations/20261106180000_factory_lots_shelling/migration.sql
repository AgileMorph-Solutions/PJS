-- CreateTable
CREATE TABLE "FactoryLot" (
    "code" TEXT NOT NULL,
    "batchCode" TEXT NOT NULL,
    "coolingSilo" TEXT,
    "coolingAt" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactoryLot_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "LotCookRun" (
    "id" SERIAL NOT NULL,
    "lotCode" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "kgApp" TEXT,
    "kgAp" TEXT,
    "kgA" TEXT,
    "kgAB" TEXT,
    "kgB" TEXT,
    "kgBC" TEXT,
    "kgC" TEXT,
    "kgD" TEXT,
    "kgE" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LotCookRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LotEntry" (
    "id" SERIAL NOT NULL,
    "lotCode" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "decision" TEXT,
    "status" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,

    CONSTRAINT "LotEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShellingDay" (
    "id" SERIAL NOT NULL,
    "lotCode" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "inputKg" TEXT NOT NULL,
    "wholesKg" TEXT,
    "piecesKg" TEXT,
    "rejectionKg" TEXT,
    "oilKg" TEXT,
    "blackRejectionKg" TEXT,
    "firstPassUncutKg" TEXT,
    "finalUncutKg" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShellingDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TruckMovement" (
    "id" SERIAL NOT NULL,
    "warehouse" TEXT NOT NULL,
    "stream" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "truckNo" TEXT NOT NULL,
    "driver" TEXT,
    "documentsChecked" BOOLEAN NOT NULL DEFAULT false,
    "tareKg" TEXT,
    "grossKg" TEXT,
    "slipNo" TEXT,
    "buyer" TEXT,
    "category" TEXT,
    "price" TEXT,
    "gatePassNo" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TruckMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoilerReading" (
    "id" SERIAL NOT NULL,
    "warehouse" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "shellKg" TEXT NOT NULL,
    "runningHours" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoilerReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FactoryLot_batchCode_idx" ON "FactoryLot"("batchCode");

-- CreateIndex
CREATE INDEX "LotCookRun_lotCode_idx" ON "LotCookRun"("lotCode");

-- CreateIndex
CREATE INDEX "LotEntry_lotCode_kind_idx" ON "LotEntry"("lotCode", "kind");

-- CreateIndex
CREATE INDEX "ShellingDay_lotCode_idx" ON "ShellingDay"("lotCode");

-- CreateIndex
CREATE INDEX "TruckMovement_warehouse_idx" ON "TruckMovement"("warehouse");

-- CreateIndex
CREATE UNIQUE INDEX "TruckMovement_warehouse_gatePassNo_key" ON "TruckMovement"("warehouse", "gatePassNo");

-- CreateIndex
CREATE INDEX "BoilerReading_warehouse_idx" ON "BoilerReading"("warehouse");

-- AddForeignKey
ALTER TABLE "FactoryLot" ADD CONSTRAINT "FactoryLot_batchCode_fkey" FOREIGN KEY ("batchCode") REFERENCES "ProductionBatch"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryLot" ADD CONSTRAINT "FactoryLot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotCookRun" ADD CONSTRAINT "LotCookRun_lotCode_fkey" FOREIGN KEY ("lotCode") REFERENCES "FactoryLot"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotCookRun" ADD CONSTRAINT "LotCookRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotEntry" ADD CONSTRAINT "LotEntry_lotCode_fkey" FOREIGN KEY ("lotCode") REFERENCES "FactoryLot"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotEntry" ADD CONSTRAINT "LotEntry_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotEntry" ADD CONSTRAINT "LotEntry_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShellingDay" ADD CONSTRAINT "ShellingDay_lotCode_fkey" FOREIGN KEY ("lotCode") REFERENCES "FactoryLot"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShellingDay" ADD CONSTRAINT "ShellingDay_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckMovement" ADD CONSTRAINT "TruckMovement_warehouse_fkey" FOREIGN KEY ("warehouse") REFERENCES "Warehouse"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckMovement" ADD CONSTRAINT "TruckMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoilerReading" ADD CONSTRAINT "BoilerReading_warehouse_fkey" FOREIGN KEY ("warehouse") REFERENCES "Warehouse"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoilerReading" ADD CONSTRAINT "BoilerReading_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

