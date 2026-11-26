import { useMemo } from "react";
import type { ReceiptRecord } from "../../types/receipt";
import { useTracking, useReceiptLinks, useDeliveryPlans, useDryingBatches, useFieldChanges } from "../../state/TrackingContext";
import { useSite } from "../../state/SiteContext";
import { useCanEditDirectly, useMe } from "../../state/AuthContext";
import { useFiche } from "../../state/useFiche";
import { computeDerivedFields } from "../../domain/receiptMath";
import { binsAtSite } from "@anagroci/contract/domain/binNumber";
import { siteTypeOf } from "@anagroci/contract/domain/siteType";
import { useFieldRules } from "./useFieldRules";
import { useSubmissionDraft } from "./useSubmissionDraft";
import { onDryingYard, wentStraightToProduction } from "@anagroci/contract/domain/sunDrying";

/**
 * Everything a truck's stage cards read, worked out once per page: the field rules, what the system calculates, the
 * Bins this site may use, the Lot's linked records, who changed what. Shared by the reception record and the Lot's
 * Warehouse activities page, so a card behaves the same on both. Takes the receipt as possibly missing, because hooks
 * run before a page can bail out on an unknown id.
 */
export function useStageCards(receipt: ReceiptRecord | undefined, { withFiche }: { withFiche: boolean }) {
  const site = useSite();
  const tracking = useTracking();
  const { masters, setStageField, refresh } = tracking;
  const me = useMe();
  // Warehouse Incharge/admin edit stages directly; a Branch Manager / QFS Officer sees them read-only.
  const canEdit = useCanEditDirectly();
  // Read once for the History tab and every stage card's "who / when". The change log is Warehouse Incharge / admin only
  // (backend auth/policy.ts keeps it from the narrow roles), so the others don't ask for it.
  const fieldLog = useFieldChanges(receipt?.id, canEdit);
  const changesByStage = useMemo(() => {
    const by = new Map<string, typeof fieldLog.changes>();
    for (const c of fieldLog.changes) by.set(c.stageId, [...(by.get(c.stageId) ?? []), c]);
    return by;
  }, [fieldLog.changes]);
  const { plans } = useDeliveryPlans(site.warehouseName);
  // What the system calculates from the readings as they stand — shown at once, so a net weight
  // follows the tare weight as it is typed rather than appearing after the server has saved it.
  const derived = useMemo(() => (receipt ? computeDerivedFields(receipt.stageData) : {}), [receipt]);
  const { links, loading: linksLoading, refetch: refetchLinks } = useReceiptLinks(receipt?.id);
  // The drying types already in use at this site, offered as suggestions on the drying form.
  const { batches: siteDryingBatches } = useDryingBatches(site.warehouseName);
  const dryTypes = useMemo(() => [...new Set(["SUN DRYING", ...siteDryingBatches.map((d) => (d.dryType ?? "").trim()).filter(Boolean)])], [siteDryingBatches]);
  // A Bin is a place INSIDE a store (BKE-002-BIN-012), never the store itself, and only one of this truck's own site:
  // the server refuses any other. The bins of the truck's own store come first.
  const store = receipt?.stageData["n-gate"]?.["WH NO."]?.trim();
  const storeNames = useMemo(() => masters.warehouses.filter((w) => w.site).map((w) => w.name), [masters.warehouses]);
  const binOptions = useMemo(() => {
    const stores = new Set(storeNames);
    const bins = binsAtSite(masters.binInfo ?? [], masters.warehouses, masters.aliases, receipt?.warehouse || site.warehouseName).filter((b) => !stores.has(b));
    if (!store) return bins;
    const storeOf = new Map((masters.binInfo ?? []).map((b) => [b.code, b.store]));
    const mine = (b: string) => storeOf.get(b) === store;
    return [...bins.filter(mine), ...bins.filter((b) => !mine(b))];
  }, [masters.binInfo, masters.warehouses, masters.aliases, storeNames, store, receipt?.warehouse, site.warehouseName]);
  const plan = plans.find((p) => p.id === receipt?.deliveryPlanId);
  // The field rules and the phase order: impossible values held back in red, later phases locked until earlier ones are complete.
  // Dried on the yard and sent straight to production: the truck never gets a Bin, so its GRN doesn't wait for one.
  const straightToProduction = wentStraightToProduction(links?.dryingBatches ?? []);
  // Out on the drying yard: the truck is in no Bin until the RCN comes back, so its Bin step waits (contract phaseGate).
  const yard = onDryingYard(links?.dryingBatches ?? []);
  const rules = useFieldRules(receipt, (stageId, label, value) => { if (receipt) setStageField(receipt.id, stageId, label, value); }, { straightToProduction, onDryingYard: yard });
  // The truck's CCA fiche (Verify supplier documents): Warehouse Incharge / admin only, like the routes behind it.
  const fiche = useFiche(receipt?.id, canEdit && withFiche, refresh);
  // A Branch Manager / QFS Officer fills their form in these same cards, as a draft submitted for approval.
  const submission = useSubmissionDraft(receipt, me.role, !canEdit);
  // The receipt's own site decides its last question, whichever section it is viewed from.
  const siteType = siteTypeOf(masters.warehouses, masters.aliases, receipt?.warehouse ?? "");

  return {
    tracking, me, canEdit, fieldLog, changesByStage, plans, plan, derived, links, linksLoading, refetchLinks,
    dryTypes, storeNames, binOptions, rules, fiche, siteType, straightToProduction, submission,
  };
}

export type StageCardsContext = ReturnType<typeof useStageCards>;
