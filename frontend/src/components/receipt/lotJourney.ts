import { formatDate } from "@anagroci/contract/domain/dateFormat";
import { formatMoney } from "@anagroci/contract/domain/currency";
import { dryingPhase } from "@anagroci/contract/domain/sunDrying";
import type { ReceiptRecord } from "../../types/receipt";
import type { ReceiptLinks } from "../../repository/api";

export type JourneyState = "done" | "active" | "todo" | "failed";

export interface JourneyStep {
  id: string;
  label: string;
  icon: string;
  state: JourneyState;
  /** One short line under the label — the fact that proves the step happened. */
  detail?: string;
}

const present = (r: ReceiptRecord, stageId: string) => Boolean(r.stageData[stageId]);

/**
 * "Unloaded straight onto the drying yard?" (26 Nov 2026, user: the journey didn't say). Asked while the truck is unloaded,
 * before it gets a Bin, so it sits between Unloading and Bin. Yes is the truck's own drying rounds from the yard (entered in
 * the app, no source Bin); No is the answer kept, or a truck that went into a Bin without one — its RCN is dried from that
 * Bin's page from then on, with the Bin's other Lots, so it doesn't show here. A workbook's drying row isn't taken for a yard
 * drying: the sheets don't say where the RCN was dried from.
 */
function yardStep(r: ReceiptRecord, links: ReceiptLinks | null): JourneyStep {
  const base = { id: "yard", label: "Drying yard", icon: "light_mode" };
  const rounds = (links?.dryingBatches ?? []).filter((b) => b.source === "entered" && !b.sourceBinNo).sort((a, b) => a.sn - b.sn);
  const latest = rounds.at(-1);
  if (latest) {
    const round = latest.round && latest.round > 1 ? ` · round ${latest.round}` : "";
    switch (dryingPhase(latest.status)) {
      case "in_drying": return { ...base, state: "active", detail: `Yes · on the yard${round}` };
      case "quality_check": return { ...base, state: "active", detail: `Yes · quality check${round}` };
      case "redry": return { ...base, state: "active", detail: `Yes · drying again${round}` };
      case "to_production": return { ...base, state: "done", detail: "Yes · dried, to production" };
      case "passed": return { ...base, state: "done", detail: latest.destinationBinNo ? `Yes · dried into ${latest.destinationBinNo}` : "Yes · dried" };
      default: return { ...base, state: "done", detail: "Yes" };
    }
  }
  if (r.branches["n-drying"] === "none") return { ...base, state: "done", detail: "No" };
  if (r.binNo) return { ...base, state: "done", detail: "No · went to a Bin" };
  return { ...base, state: "todo", detail: present(r, "n-unload") ? "Not answered" : undefined };
}

/**
 * The life of one Lot, start to finish, as the data shows it. Every state is read from the receipt
 * and its linked rows — nothing is stored — so a step can't claim "done" without the record to
 * prove it. The first step that isn't done is the active one (unless the truck was rejected, which
 * ends the journey where it stands).
 *
 * The ending depends on the site: a Lot at a Unit warehouse may go on to the factory, while one at a
 * Central warehouse is already there, so it goes to production or stays. The Lot comes straight after
 * Quality because that is when it is issued, before the truck unloads.
 */
export function buildJourney(r: ReceiptRecord, links: ReceiptLinks | null, siteType: string | null): JourneyStep[] {
  const rejected = r.branches["n-qfs"] === "fail";
  const issued = (links?.issuedToProduction.length ?? 0) > 0 || (links?.btmIntakes.length ?? 0) > 0;
  const productionDetail = links?.batchCode ?? (issued ? "Issued" : undefined);

  const steps: JourneyStep[] = [
    { id: "arrival", label: "Arrival", icon: "local_shipping", state: present(r, "n-gate") || present(r, "n-verify") ? "done" : "todo", detail: formatDate(r.arrivalDate) },
    {
      id: "quality", label: "Quality", icon: "science",
      state: rejected ? "failed" : r.branches["n-qfs"] === "pass" ? "done" : "todo",
      detail: rejected ? "Rejected" : r.branches["n-qfs"] === "pass" ? "Passed" : undefined,
    },
    { id: "lot", label: "Lot", icon: "tag", state: r.lotNo ? "done" : "todo", detail: r.lotNo || undefined },
    { id: "unloading", label: "Unloading", icon: "inventory_2", state: present(r, "n-unload") ? "done" : "todo", detail: r.stageData["n-netwt"]?.["NET WT KGS"] ? `${r.stageData["n-netwt"]["NET WT KGS"]} kg` : undefined },
    yardStep(r, links),
    { id: "bin", label: "Bin", icon: "grid_view", state: r.binNo ? "done" : "todo", detail: r.binNo || undefined },
    { id: "grn", label: "GRN", icon: "receipt_long", state: present(r, "n-grn") ? "done" : "todo", detail: formatMoney(r.stageData["n-grn"]?.["AMOUNT"]) || undefined },
  ];

  if (siteType === "CENTRAL") {
    const ready = r.branches["n-xferdec"] === "production";
    const kept = r.branches["n-xferdec"] === "stays";
    steps.push(
      { id: "ready", label: "Ready for production", icon: "task_alt", state: ready ? "done" : kept ? "active" : "todo", detail: kept ? "Keeping in warehouse" : undefined },
      { id: "production", label: "Production", icon: "precision_manufacturing", state: (ready && links?.batchCode) || issued ? "done" : "todo", detail: ready || issued ? productionDetail : undefined },
    );
  } else {
    // The BKT is the app's own record; the dispatch lines and sheet rows are the imported history of the same thing.
    // A Lot bigger than one truck is on several BKTs: dispatched from its first truck, at the factory once its last arrives.
    const bkts = links?.bkts ?? [];
    const firstOut = bkts.find((b) => b.dispatchedAt)?.dispatchedAt;
    const allIn = bkts.length > 0 && bkts.every((b) => b.receivedAt);
    const lastIn = allIn ? bkts.map((b) => b.receivedAt!).sort().at(-1) : undefined;
    const trucks = bkts.length > 1 ? ` · ${bkts.length} trucks` : "";
    const dispatched = Boolean(firstOut) || (links?.dispatches.length ?? 0) > 0 || (links?.transfers.length ?? 0) > 0;
    const received = allIn || (links?.warehouseReceiving ?? []).some((w) => !/bouak/i.test(w.warehouseSite));
    const dispatchDate = firstOut ?? links?.dispatches[0]?.chargeDate;
    steps.push(
      { id: "transfer", label: "Dispatch", icon: "swap_horiz", state: dispatched ? "done" : "todo", detail: dispatchDate ? `${formatDate(dispatchDate)}${trucks}` : undefined },
      { id: "received", label: "At factory", icon: "factory", state: received ? "done" : "todo", detail: lastIn ? formatDate(lastIn) : received ? "Received" : undefined },
      { id: "production", label: "Production", icon: "precision_manufacturing", state: links?.batchCode || issued ? "done" : "todo", detail: productionDetail },
    );
  }

  if (!rejected && !steps.some((s) => s.state === "active")) {
    const firstOpen = steps.findIndex((s) => s.state === "todo");
    if (firstOpen >= 0) steps[firstOpen] = { ...steps[firstOpen]!, state: "active" };
  }
  return steps;
}
