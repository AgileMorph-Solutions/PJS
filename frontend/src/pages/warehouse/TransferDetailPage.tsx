import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { TransferLotLink, TransferPanel } from "../../components/transfers/TransferPanel";
import { useTracking, useTransfers } from "../../state/TrackingContext";
import { useSite, useSites } from "../../state/SiteContext";
import { useCanEditDirectly } from "../../state/AuthContext";
import { api, ApiError } from "../../repository/api";
import type { TransferRequest } from "../../types/receipt";
import { formatDate } from "@anagroci/contract/domain/dateFormat";
import { isTruckOnTheRoad, transferDestinationLabel } from "@anagroci/contract/domain/transfers";
import { siteTypeOf } from "@anagroci/contract/domain/siteType";
import { binsAtSite } from "@anagroci/contract/domain/binNumber";

/**
 * One BKT in full. The sending warehouse fills in the dispatch here, the receiving warehouse records the
 * arrival, exactly as before - the form just lives on its own page now, so a row in the Transfers table
 * opens like every other table's rows do. The BKT is found in the site's own transfer list (it lists both
 * what leaves and what is on its way in), so there is no separate single-transfer endpoint to keep in step.
 */
export function TransferDetailPage() {
  const { id = "" } = useParams();
  const site = useSite();
  const sites = useSites();
  const canEdit = useCanEditDirectly();
  const { receipts, refresh, masters } = useTracking();
  const { transfers, loading, refetch } = useTransfers(site.warehouseName);
  // `link`: another BKT the refusal is about, when this person may open it (the server sends it only then).
  const [error, setError] = useState<{ message: string; link?: { to: string; label: string } } | null>(null);
  const [saving, setSaving] = useState(false);
  // Following the error's link to the other BKT reuses this page: its refusal isn't about that BKT.
  useEffect(() => setError(null), [id]);

  const t = transfers.find((x) => x.id === id);
  // The receipts this site can open; a Lot on an incoming BKT belongs to the OTHER site, so it is shown as text.
  const visible = useMemo(() => new Set(receipts.map((r) => r.id)), [receipts]);

  // A Lot's own quality-check result: what each line of a dispatch starts from.
  const qualityOf = (receiptId: string) => {
    const q = receipts.find((r) => r.id === receiptId)?.stageData["n-qfs"];
    return { moisture: q?.["Final moisture (%)"] ?? "", kor: q?.["FINAL KOR"] || q?.["KOR"] || "", nutCount: q?.["Final nut count"] ?? "" };
  };
  // This site's own bins only (the server refuses any other): Yakro never sees Bouaké's BKE-… bins, nor they its BIN-….
  const binOptions = useMemo(
    () => binsAtSite(masters.binInfo ?? [], masters.warehouses, masters.aliases, site.warehouseName),
    [masters.binInfo, masters.warehouses, masters.aliases, site.warehouseName],
  );
  const lotLink = (l: TransferRequest["lines"][number]) => <TransferLotLink key={l.receiptId} line={l} siteSlug={site.slug} canOpen={visible.has(l.receiptId)} />;

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setSaving(true);
    try { await action(); await Promise.all([refetch(), refresh()]); return true; } catch (err) { setError(describe(err)); return false; } finally { setSaving(false); }
  }

  /**
   * A BKT is opened from a section whose Transfers list holds it, so the link goes under one of ITS sites that this
   * person may open — this one first. No such section, no link: never a URL that would land on "not listed".
   */
  function describe(err: unknown): { message: string; link?: { to: string; label: string } } {
    const message = err instanceof Error ? err.message : String(err);
    if (!(err instanceof ApiError) || !isTruckOnTheRoad(err.detail)) return { message };
    const { transferId, sites: holders } = err.detail;
    const target = holders.includes(site.warehouseName) ? site : sites.find((s) => holders.includes(s.warehouseName));
    return target ? { message, link: { to: `/${target.slug}/transfers/${encodeURIComponent(transferId)}`, label: `Open ${transferId}` } } : { message };
  }

  const back = <Link to={`/${site.slug}/transfers`} className="text-[13px] font-semibold text-brand-700 hover:text-brand-800">← All transfers</Link>;

  if (!t) {
    return (
      <div className="space-y-3">
        {back}
        <p className="text-[13px] text-warmstone-600">{loading ? "Loading…" : `No transfer ${id} is listed for ${site.warehouseName}.`}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {back}
      <PageHeader kicker={`${site.label} · ${site.sublabel}`} title={t.id} lede={`${t.fromWarehouse} → ${transferDestinationLabel(t)} · ${formatDate(t.transferDate)}${t.remarks ? ` · ${t.remarks}` : ""}`} />
      {error && (
        <p role="alert" className="px-1 text-[13px] text-danger-700">
          {error.message}
          {error.link && (
            <>
              {" "}
              <Link to={error.link.to} className="font-semibold text-brand-700 hover:text-brand-800 underline">{error.link.label} →</Link>
            </>
          )}
        </p>
      )}
      <TransferPanel
        key={t.id} t={t} siteWarehouse={site.warehouseName} canEdit={canEdit} canSend={siteTypeOf(masters.warehouses, masters.aliases, site.warehouseName) === "UNIT"} saving={saving} lotLink={lotLink} qualityOf={qualityOf} binOptions={binOptions}
        onDispatch={(p) => run(() => api.dispatchTransfer(t.id, p))} onReceive={(p) => run(() => api.receiveTransfer(t.id, p))}
      />
    </div>
  );
}
