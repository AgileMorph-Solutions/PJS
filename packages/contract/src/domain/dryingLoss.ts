/**
 * What drying cost: the weight lost, as a share of what was issued, and the points of moisture removed. Calculated from the
 * issued and returned figures, never typed (the same stance as net weight and KOR), by the server when drying is completed
 * and by the form to show the result before it is saved.
 */
export interface DryingLoss {
  /** Issued net kg minus returned net kg. */
  lossKg: number;
  /** Loss as a percentage of the issued kg. */
  lossPct: number | null;
  /** Moisture before minus moisture after, in percentage points. */
  moistureLossPct: number | null;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function dryingLoss(issuedKg: number, returnedKg: number, moistureBefore: number | null, moistureAfter: number | null): DryingLoss {
  return {
    lossKg: round(issuedKg - returnedKg),
    lossPct: issuedKg > 0 ? round(((issuedKg - returnedKg) / issuedKg) * 100) : null,
    moistureLossPct: moistureBefore === null || moistureAfter === null ? null : round(moistureBefore - moistureAfter),
  };
}

/** Why a drying return can't be right, or null: the dried quantity can't be more than what went in. */
export function dryingReturnProblem(issuedKg: number, returnedKg: number): string | null {
  if (!(returnedKg >= 0)) return "The dried quantity returned must be a number of kg, zero or more.";
  if (returnedKg > issuedKg) return `The dried quantity (${returnedKg} kg) can't be more than the ${issuedKg} kg issued for drying.`;
  return null;
}

/** The drying types seen on the client's own drying sheets, offered as suggestions; anything else typed is kept as typed. */
export const DEFAULT_DRY_TYPE = "SUN DRYING";
