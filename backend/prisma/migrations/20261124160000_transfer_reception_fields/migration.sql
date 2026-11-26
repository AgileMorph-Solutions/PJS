-- Two columns of the client's "Bouake RCN Receiving at Factory Report" for a truck from the Unit warehouse (24 Nov 2026):
-- its entry pass at the gate and the new jute bags used at unloading. Text, like every stage column (round-trip fidelity).
-- AlterTable
ALTER TABLE "StageGateEntry" ADD COLUMN     "laissePasserEntree" TEXT;

-- AlterTable
ALTER TABLE "StageUnload" ADD COLUMN     "newJuteBagsUsed" TEXT;

