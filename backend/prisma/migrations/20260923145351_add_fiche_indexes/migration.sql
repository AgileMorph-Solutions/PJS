-- CreateIndex
CREATE INDEX "DryingJob_ficheNo_idx" ON "DryingJob"("ficheNo");

-- CreateIndex
CREATE INDEX "JuteWarehouseTransferReceipt_noFiche_idx" ON "JuteWarehouseTransferReceipt"("noFiche");

-- CreateIndex
CREATE INDEX "StageVerifyDocs_fiche_idx" ON "StageVerifyDocs"("fiche");
