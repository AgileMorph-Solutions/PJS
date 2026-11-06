import { formatDate } from "@anagroci/contract/domain/dateFormat";
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
  const batches = links?.dryingBatches ?? [];
  const noDrying = r.branches["n-drying"] === "none";
  const dryingDone = noDrying || batches.some((b) => /complete|done|finish/i.test(b.status ?? "")) || Boolean(r.stageData["n-drying"]?.["Moisture % — after drying"]);
  const dryingStarted = batches.length > 0 || present(r, "n-drying");
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
    { id: "bin", label: "Bin", icon: "grid_view", state: r.binNo ? "done" : "todo", detail: r.binNo || undefined },
    { id: "grn", label: "GRN", icon: "receipt_long", state: present(r, "n-grn") ? "done" : "todo", detail: r.stageData["n-grn"]?.["AMOUNT"] ? `${Number(r.stageData["n-grn"]["AMOUNT"]).toLocaleString()} XOF` : undefined },
    { id: "drying", label: "Drying", icon: "light_mode", state: dryingDone ? "done" : dryingStarted ? "active" : "todo", detail: noDrying ? "Not needed" : dryingDone ? "Dried" : dryingStarted ? "In progress" : "Not started" },
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
    const dispatched = Boolean(links?.bkt?.dispatchedAt) || (links?.dispatches.length ?? 0) > 0 || (links?.transfers.length ?? 0) > 0;
    const received = Boolean(links?.bkt?.receivedAt) || (links?.warehouseReceiving ?? []).some((w) => !/bouak/i.test(w.warehouseSite));
    const dispatchDate = links?.bkt?.dispatchedAt ?? links?.dispatches[0]?.chargeDate;
    steps.push(
      { id: "transfer", label: "Dispatch", icon: "swap_horiz", state: dispatched ? "done" : "todo", detail: dispatchDate ? formatDate(dispatchDate) : undefined },
      { id: "received", label: "At factory", icon: "factory", state: received ? "done" : "todo", detail: links?.bkt?.receivedAt ? formatDate(links.bkt.receivedAt) : received ? "Received" : undefined },
      { id: "production", label: "Production", icon: "precision_manufacturing", state: links?.batchCode || issued ? "done" : "todo", detail: productionDetail },
    );
  }

  if (!rejected && !steps.some((s) => s.state === "active")) {
    const firstOpen = steps.findIndex((s) => s.state === "todo");
    if (firstOpen >= 0) steps[firstOpen] = { ...steps[firstOpen]!, state: "active" };
  }
  return steps;
}
