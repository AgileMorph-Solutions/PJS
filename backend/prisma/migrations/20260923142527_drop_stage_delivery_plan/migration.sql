/*
  Warnings:

  - You are about to drop the `StageDeliveryPlan` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "StageDeliveryPlan" DROP CONSTRAINT "StageDeliveryPlan_receiptId_fkey";

-- DropTable
DROP TABLE "StageDeliveryPlan";
