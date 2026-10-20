import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { TransferLotLink, TransferPanel } from "../../components/transfers/TransferPanel";
import { useTracking, useTransfers } from "../../state/TrackingContext";
import { useSite } from "../../state/SiteContext";
import { useCanEditDirectly } from "../../state/AuthContext";
import { api } from "../../repository/api";
import type { TransferRequest } from "../../types/receipt";
import { formatDate } from "@anagroci/contract/domain/dateFormat";

/**
 * One BKT in full. The sending warehouse fills in the dispatch here, the receiving warehouse records the
 * arrival, exactly as before - the form just lives on its own page now, so a row in the Transfers table
 * opens like every other table's rows do. The BKT is found in the site's own transfer list (it lists both
 * what leaves and what is on its way in), so there is no separate single-transfer endpoint to keep in step.
 */
export function TransferDetailPage() {
  const { id = "" } = useParams();
  const site = useSite();
  const canEdit = useCanEditDirectly();
  const { receipts, refresh } = useTracking();
  const { transfers, loading, refetch } = useTransfers(site.warehouseName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const t = transfers.find((x) => x.id === id);
  // The receipts this site can open; a Lot on an incoming BKT belongs to the OTHER site, so it is shown as text.
  const visible = useMemo(() => new Set(receipts.map((r) => r.id)), [receipts]);

  // A Lot's own quality-check result: what each line of a dispatch starts from.
  const qualityOf = (receiptId: string) => {
    const q = receipts.find((r) => r.id === receiptId)?.stageData["n-qfs"];
    return { moisture: q?.["MOIS. (moisture)"] ?? "", kor: q?.["FINAL KOR"] || q?.["KOR"] || "", nutCount: q?.["NUT COUNT"] ?? "" };
  };
  const lotLink = (l: TransferRequest["lines"][number]) => <TransferLotLink key={l.receiptId} line={l} siteSlug={site.slug} canOpen={visible.has(l.receiptId)} />;

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setSaving(true);
    try { await action(); await Promise.all([refetch(), refresh()]); return true; } catch (err) { setError(err instanceof Error ? err.message : String(err)); return false; } finally { setSaving(false); }
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
      <PageHeader kicker={`${site.label} · ${site.sublabel}`} title={t.id} lede={`${t.fromWarehouse} → ${t.toWarehouse} · ${formatDate(t.transferDate)}${t.remarks ? ` · ${t.remarks}` : ""}`} />
      {error && <p role="alert" className="px-1 text-[13px] text-danger-700">{error}</p>}
      <TransferPanel
        key={t.id} t={t} siteWarehouse={site.warehouseName} canEdit={canEdit} saving={saving} lotLink={lotLink} qualityOf={qualityOf}
        onDispatch={(p) => run(() => api.dispatchTransfer(t.id, p))} onReceive={(p) => run(() => api.receiveTransfer(t.id, p))}
      />
    </div>
  );
}
