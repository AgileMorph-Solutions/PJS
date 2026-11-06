/** Read hook for RCN Receipts, plain fetch-and-hold like productionBatches.ts. */
import { api } from "../repository/api";
import type { RcnReceipt } from "@anagroci/contract/types/rcnReceipt";
import { useLoaded, type Loaded, type LoadOptions } from "./useLoaded";
import { useProductionFactory } from "./productionFactory";

/** Every receipt at the factory, or one batch's when `batchCode` is given. */
export const useRcnReceipts = (batchCode?: string, options?: LoadOptions): Loaded<RcnReceipt> =>
  useLoaded(() => api.listRcnReceipts(batchCode), [batchCode, useProductionFactory().factory], options);
