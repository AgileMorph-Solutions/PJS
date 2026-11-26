import { canCorrectRecords } from "@anagroci/contract/data/roles";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { TransferLotLink, TransferPanel, type ActionError } from "../../components/transfers/TransferPanel";
import { useTracking, useTransfers } from "../../state/TrackingContext";
import { useSite, useSites } from "../../state/SiteContext";
import { useCanEditDirectly, useMe } from "../../state/AuthContext";
import { EditTransferForm } from "../../components/transfers/EditTransferForm";
import { Button } from "../../components/ui/Button";
import { api, ApiError } from "../../repository/api";
import type { TransferRequest } from "../../types/receipt";
import { formatDate } from "@anagroci/contract/domain/dateFormat";
import { isTruckOnTheRoad, transferDestinationLabel } from "@anagroci/contract/domain/transfers";
import { siteTypeOf } from "@anagroci/contract/domain/siteType";

/**
 * One BKT in full. The sending warehouse fills in the dispatch here; the receiving warehouse sees what is on its way and
 * records the arrival on its Reception page (From Unit warehouse, 24 Nov 2026). A row in the Transfers table
 * opens like every other table's rows do. The BKT is found in the site's own transfer list (it lists both
 * what leaves and what is on its way in), so there is no separate single-transfer endpoint to keep in step.
 */
export function TransferDetailPage() {
  const { id = "" } = useParams();
  const site = useSite();
  const sites = useSites();
  const canEdit = useCanEditDirectly();
  // A BKT is corrected once made by an Admin, or by the sending warehouse's Incharge: the form edits what left (26 Nov 2026,
  // contract canCorrectRecords; the server holds each to their own half).
  const role = useMe().role;
  const [editing, setEditing] = useState(false);
  const { receipts, refresh, masters } = useTracking();
  const { transfers, loading, refetch } = useTransfers(site.warehouseName);
  // `link`: another BKT the refusal is about, when this person may open it (the server sends it only then).
  const [error, setError] = useState<ActionError | null>(null);
  const [saving, setSaving] = useState(false);
  // Following the error's link to the other BKT reuses this page: its refusal isn't about that BKT.
  useEffect(() => { setError(null); setEditing(false); }, [id]);

  const t = transfers.find((x) => x.id === id);
  // The receipts this site can open; a Lot on an incoming BKT belongs to the OTHER site, so it is shown as text.
  const visible = useMemo(() => new Set(receipts.map((r) => r.id)), [receipts]);

  // What each line of a dispatch starts from: a transfer lot's weighing (the server shows it on the line), or on an older BKT
  // a Lot's own quality-check result. A Bin mixes Lots, so its quality is measured.
  const qualityOf = (l: TransferRequest["lines"][number]) => {
    const text = (x: number | null) => (x === null ? "" : String(x));
    if (l.transferLotId) return { moisture: text(l.moisture), kor: text(l.kor), nutCount: text(l.nutCount) };
    const q = l.receiptId ? receipts.find((r) => r.id === l.receiptId)?.stageData["n-qfs"] : undefined;
    return { moisture: q?.["Final moisture (%)"] ?? "", kor: q?.["FINAL KOR"] || q?.["KOR"] || "", nutCount: q?.["Final nut count"] ?? "" };
  };
  const lotLink = (l: TransferRequest["lines"][number]) => <TransferLotLink key={l.id} line={l} siteSlug={site.slug} canOpen={Boolean(l.receiptId && visible.has(l.receiptId))} />;

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setSaving(true);
    try { await action(); await Promise.all([refetch(), refresh()]); return true; } catch (err) { setError(describe(err)); return false; } finally { setSaving(false); }
  }

  /**
   * A BKT is opened from a section whose Transfers list holds it, so the link goes under one of ITS sites that this
   * person may open — this one first. No such section, no link: never a URL that would land on "not listed".
   */
  function describe(err: unknown): ActionError {
    const message = err instanceof Error ? err.message : String(err);
    // "The truck is still out on another BKT" is about the truck number: it shows under that box.
    const field = /^Truck .* can't be dispatched yet/.test(message) ? "truckNo" as const : undefined;
    if (!(err instanceof ApiError) || !isTruckOnTheRoad(err.detail)) return { message, field };
    const { transferId, sites: holders } = err.detail;
    const target = holders.includes(site.warehouseName) ? site : sites.find((s) => holders.includes(s.warehouseName));
    return target ? { message, field, link: { to: `/${target.slug}/transfers/${encodeURIComponent(transferId)}`, label: `Open ${transferId} →` } } : { message, field };
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
      <PageHeader
        kicker={`${site.label} · ${site.sublabel}`} title={t.id} lede={`${t.fromWarehouse} → ${transferDestinationLabel(t)} · ${formatDate(t.transferDate)}${t.remarks ? ` · ${t.remarks}` : ""}`}
        actions={canCorrectRecords(role) && (role === "admin" || t.fromWarehouse === site.warehouseName) && !editing ? <Button variant="secondary" icon="edit" onClick={() => { setError(null); setEditing(true); }}>Edit BKT</Button> : undefined}
      />
      {editing && (
        <EditTransferForm
          key={`${t.id}-edit`} t={t} saving={saving} error={error?.message}
          onCancel={() => { setEditing(false); setError(null); }}
          onSave={async (p) => { const ok = await run(() => api.editTransfer(t.id, p)); if (ok) setEditing(false); return ok; }}
        />
      )}
      <TransferPanel
        key={t.id} t={t} siteWarehouse={site.warehouseName} canEdit={canEdit} canSend={siteTypeOf(masters.warehouses, masters.aliases, site.warehouseName) === "UNIT"} saving={saving} lotLink={lotLink} qualityOf={qualityOf}
        onDispatch={(p) => run(() => api.dispatchTransfer(t.id, p))}
        receiveHref={`/${site.slug}/receipts/from-unit`}
        receptionHref={(rid) => `/${site.slug}/receipts/${encodeURIComponent(rid)}`}
        // A refusal shows by the box or button it is about, and goes once the form is changed.
        error={error} onEdit={() => setError(null)}
      />
    </div>
  );
}
