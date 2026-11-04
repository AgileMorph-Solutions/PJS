/**
 * The production workbook's tabs: Production Phase 1 (Batch & Intake), one tab per thing a person records,
 * in the order they happen. A later phase (calibration, cooking, …) is a new tab here when it is built.
 *
 * Column words follow the client's own sheets — "2. Input RCN Quality report" for a moisture check, the
 * "RCN Receipts Tally Sheet" for pallets — so the file reads like what the floor already fills in.
 * `derived` columns are what the app works out (a status, KOR, a net weight): the file shows them, an
 * upload never reads them, exactly as Reception's workbook treats a truck's status.
 *
 * Tabs that hang off a load (checks, pallets, final weight) name it by its RCN Receipt ID or by its BTM No.
 * The BTM No is the number the client writes on every sheet, and it is what lets a load and its checks
 * arrive in the same file, before the app has issued the load an ID.
 */
export interface TabField {
  key: string;
  label: string;
  derived?: boolean;
  /** A cell comment on the header: how to fill the column in. */
  note?: string;
}

export interface Tab {
  id: "batches" | "receipts" | "checks" | "pallets" | "final";
  title: string;
  /** The column that names an existing row; blank in it means "add a new one". */
  key: string;
  fields: TabField[];
  /** The date the export's range filter applies to. */
  dateKey: string;
  dateLabel: string;
}

const LOAD_LINK: TabField[] = [
  { key: "receiptId", label: "RCN Receipt ID", note: "The load this row is for. Or leave it blank and give the BTM No instead." },
  { key: "btmNo", label: "BTM No", note: "Enough on its own when only one load has this BTM No; otherwise give the RCN Receipt ID." },
];

export const TABS: Tab[] = [
  {
    id: "batches",
    title: "Batches",
    key: "code",
    dateKey: "startDate",
    dateLabel: "Start date",
    fields: [
      { key: "code", label: "Batch Name", note: "The batch's own name, e.g. ANA-03B. A new name creates the batch." },
      { key: "startDate", label: "Start Date" },
      { key: "bins", label: "Bins", note: "The warehouse bins in the batch, separated by /  (BIN-03B / BIN-03C)." },
      { key: "proposedBy", label: "Proposed By" },
      { key: "plannedKg", label: "Planned (kg)", derived: true },
      { key: "status", label: "Status", derived: true },
    ],
  },
  {
    id: "receipts",
    title: "RCN Receipts",
    key: "id",
    dateKey: "date",
    dateLabel: "Date",
    fields: [
      { key: "id", label: "RCN Receipt ID" },
      { key: "batchCode", label: "Batch Name" },
      { key: "date", label: "Date" },
      { key: "btmNo", label: "BTM No" },
      { key: "binCode", label: "Source Bin", note: "The warehouse bin of the batch the load came from." },
      { key: "status", label: "Status", derived: true },
    ],
  },
  {
    id: "checks",
    title: "Moisture Checks",
    key: "id",
    dateKey: "loadDate",
    dateLabel: "Load date",
    fields: [
      { key: "id", label: "Check ID" },
      ...LOAD_LINK,
      { key: "moisture", label: "Moisture (%)" },
      { key: "nutCount", label: "Nut Count" },
      { key: "sampleG", label: "Sample Weight (g)" },
      { key: "gkG", label: "GK (g)" },
      { key: "spotG", label: "Spot (g)" },
      { key: "immatureG", label: "Immature (g)" },
      { key: "oilG", label: "Oil (g)" },
      { key: "rejectionG", label: "Rejection (g)" },
      { key: "voidsG", label: "Voids (g)" },
      { key: "shellG", label: "Shell (g)" },
      { key: "fruitWasteG", label: "Fruit Waste (g)" },
      { key: "decision", label: "Result", note: "OK, or Hold to dry and check again. A re-check is a new row." },
      { key: "kor", label: "KOR (lbs)", derived: true },
      { key: "status", label: "Approval", derived: true },
    ],
  },
  {
    id: "pallets",
    title: "Pallets",
    key: "id",
    dateKey: "loadDate",
    dateLabel: "Load date",
    fields: [
      { key: "id", label: "Pallet ID" },
      ...LOAD_LINK,
      { key: "no", label: "Pallet No", derived: true },
      { key: "grossKg", label: "Gross Weight (kg)" },
      { key: "bags", label: "No of Bags" },
      { key: "factoryBin", label: "Factory Bin", note: "The production bin the pallet goes into, e.g. ANA-03B." },
    ],
  },
  {
    id: "final",
    title: "Final Weight",
    key: "receiptId",
    dateKey: "loadDate",
    dateLabel: "Load date",
    fields: [
      ...LOAD_LINK,
      { key: "emptyPalletsKg", label: "Empty Pallets Weight (kg)", note: "Weighed in stacks? Separate them with /  (374.3 / 211.2)." },
      { key: "emptyPalletsCount", label: "No of Pallets", note: "Optional, one per stack in the same order, separated by /." },
      { key: "dustKg", label: "Dust (kg)" },
      { key: "voidsKg", label: "Voids (kg)" },
      { key: "netKg", label: "Net Weight (kg)", derived: true },
      { key: "toSilosKg", label: "To Silos (kg)", derived: true },
    ],
  },
];

/** "BIN-03B / BIN-03C", "374.3/211.2": the file's way of putting several values in one cell. */
export const splitList = (v: string | null): string[] => (v ?? "").split("/").map((s) => s.trim()).filter(Boolean);
export const joinList = (xs: (string | number)[]): string => xs.join(" / ");
