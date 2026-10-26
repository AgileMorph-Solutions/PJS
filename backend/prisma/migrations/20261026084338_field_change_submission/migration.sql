-- AlterTable
ALTER TABLE "StageFieldChange" ADD COLUMN     "submissionId" TEXT;

-- AddForeignKey
ALTER TABLE "StageFieldChange" ADD CONSTRAINT "StageFieldChange_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "FormSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
