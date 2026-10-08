/**
 * The receipt's own columns each have a twin on a stage: the list shows the receipt's, the stage is
 * the record of the step. They are one fact stored twice, so a write to either side has to reach the
 * other — one place says which pairs, and both the workbook upload and the stage write path read it.
 */
export const RECEIPT_STAGE_MIRRORS: Readonly<Record<string, readonly [stageId: string, label: string]>> = {
  arrivalDate: ["n-gate", "DATE OF ARRIVAL"],
  supplierName: ["n-verify", "SUPPLIERS NAME"],
  lbaCode: ["n-verify", "LBA CODE"],
  vehicleNo: ["n-gate", "VEHICLE NO."],
};

/**
 * Receipt columns a stage write may carry across. `arrivalDate` is deliberately not one of them:
 * the year in the Receipt ID and Lot is the arrival date's, so it only changes through the receipt
 * itself, never as a side effect of editing the gate form.
 */
export const STAGE_TO_RECEIPT_COLUMNS = ["supplierName", "lbaCode", "vehicleNo"] as const;
