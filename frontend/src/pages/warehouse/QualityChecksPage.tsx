import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  APPROVER_LABEL, QUALITY_SECTIONS, type QualityCheckItem, type QualityCheckLink, type QualitySection,
} from "@anagroci/contract/domain/qualityChecks";
import { formatDate, formatDateTime } from "@anagroci/contract/domain/dateFormat";
import { PageHeader } from "../../components/ui/PageHeader";
import { EmptyState } from "../../components/ui/EmptyState";
import { IconButton } from "../../components/ui/IconButton";
import { Pill } from "../../components/ui/Pill";
import { Button, buttonClass } from "../../components/ui/Button";
import { QualitySectionTag } from "../../components/quality/QualitySectionTag";
import { QualityCheckForm } from "../../components/quality/QualityCheckForm";
import { useLoaded } from "../../state/useLoaded";
import { useSite } from "../../state/SiteContext";
import { api } from "../../repository/api";
import { useMe } from "../../state/AuthContext";
import { useLiveVersion } from "../../state/LiveUpdates";
import { QUALITY_CHECK_TAKERS } from "@anagroci/contract/data/roles";

const STATE_PILL = {
  to_do: { tone: "decision", label: "To do" },
  waiting_approval: { tone: "system", label: "Waiting for approval" },
  rejected: { tone: "gap", label: "Rejected" },
  cancelled: { tone: "system", label: "Cancelled" },
} as const;

const GROUPS: { state: QualityCheckItem["state"]; title: string; empty: string }[] = [
  { state: "rejected", title: "Rejected", empty: "" },
  { state: "cancelled", title: "Cancelled by the Warehouse Incharge", empty: "" },
  { state: "to_do", title: "To do", empty: "Nothing to check right now." },
  { state: "waiting_approval", title: "Waiting for approval", empty: "Nothing waiting for approval." },
];

/**
 * The QFS Officer's quality checks (26 Nov 2026, user): every check at their warehouse in one list, each named by the section it
 * comes from (Reception, Unloading, Drying, Transfer lot, Triage, Production…) and the record it is about, with what is still
 * to be measured. A check of a truck or a production run opens on that page; a drying or transfer lot check is filled
 * here and sent for the Warehouse Incharge's approval. The list is read off the records (services/qualityChecks.ts), never kept.
 *
 * It reads itself again on every live update (state/LiveUpdates.tsx): a drying form the Incharge opens shows here at once,
 * and goes away when they close it (27 Nov 2026, user).
 */
export function QualityChecksPage() {
  const site = useSite();
  const [saved, setSaved] = useState(0);
  const live = useLiveVersion();
  const loaded = useLoaded(async () => [await api.qualityChecks(site.warehouseName)], [site.warehouseName], { reloadOn: `${saved}:${live}` });
  const view = loaded.rows[0];
  const [section, setSection] = useState<QualitySection | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  // The QFS Officer (and Admin) take the checks here; the Warehouse Incharge reads the list and approves in Approvals.
  const role = useMe().role;
  const canTake = QUALITY_CHECK_TAKERS.includes(role);
  const canApprove = role === "warehouse_incharge" || role === "admin";

  const items = view?.items ?? [];
  // The check being filled in went away under the person (the Incharge closed the drying form that asked): say so
  // rather than closing the form without a word.
  const [gone, setGone] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !view) return;
    const still = view.items.find((i) => i.key === open);
    if (still && still.state === "to_do") return;
    setGone(still?.state === "waiting_approval" ? "That check was sent already, and is waiting for approval."
      : open.startsWith("request-") ? "The Warehouse Incharge cancelled that drying form, so the check is no longer needed."
      : "That check isn't needed any more: the Warehouse Incharge has entered it.");
    setOpen(null);
  }, [view, open]);
  const shown = section === "all" ? items : items.filter((i) => i.section === section);
  const count = (s: QualitySection | "all") => (s === "all" ? items : items.filter((i) => i.section === s)).filter((i) => i.state !== "waiting_approval").length;

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={`Quality · ${site.warehouseName}`}
        title="Quality checks"
        lede={canTake
          ? "Every quality check at this warehouse, by the section it comes from. Each one you send waits for approval before it counts."
          : "Every quality check at this warehouse, by the section it comes from: what the QFS Officer still has to measure, and what is waiting for your approval."}
      />

      {gone && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-warmstone-200 bg-warmstone-100 px-3 py-2">
          <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-warmstone-500">info</span>
          <span className="flex-1 text-[13px] text-warmstone-800">{gone}</span>
          <IconButton icon="close" label="Dismiss" onClick={() => setGone(null)} />
        </div>
      )}
      {loaded.error && <p role="alert" className="text-[13px] text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{loaded.error}</p>}

      {view && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by section">
          {(["all", ...view.sections] as const).map((s) => (
            <button
              key={s} type="button" onClick={() => setSection(s)} aria-pressed={section === s}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12px] font-semibold transition-colors ${
                section === s ? "bg-brand-700 border-brand-700 text-white" : "bg-white border-warmstone-200 text-warmstone-700 hover:bg-warmstone-50"
              }`}
            >
              {s !== "all" && <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{QUALITY_SECTIONS[s].icon}</span>}
              {s === "all" ? "All sections" : QUALITY_SECTIONS[s].label}
              <span className="tabular-nums">{count(s)}</span>
            </button>
          ))}
        </div>
      )}

      {loaded.loading && !view && <p className="text-[13px] text-warmstone-500">Loading…</p>}

      {view && GROUPS.map((g) => {
        const rows = shown.filter((i) => i.state === g.state);
        if ((g.state === "rejected" || g.state === "cancelled") && rows.length === 0) return null;
        return (
          <section key={g.state} className="space-y-3">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-warmstone-500 px-1">{g.title} · {rows.length}</h2>
            {rows.length === 0 && <EmptyState title={g.empty} />}
            {rows.map((item) => (
              <CheckRow
                key={item.key} item={item} siteSlug={site.slug} canTake={canTake} canApprove={canApprove}
                open={open === item.key} onOpen={() => setOpen(open === item.key ? null : item.key)}
                onSent={() => { setOpen(null); setGone(null); setSaved((n) => n + 1); }}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

/**
 * The page to open for a check, and what its button says. A check filled in here (drying, transfer lot) opens, for the
 * Warehouse Incharge or an Admin, the page its record lives on, where they can also enter it directly: those pages are
 * theirs, so the QFS Officer, who fills it in here, gets no link to them.
 */
function openOf(link: QualityCheckLink, siteSlug: string, editsDirectly: boolean): { href: string; label: string } | null {
  if (link.kind === "receipt") return { href: `/${siteSlug}/receipts/${encodeURIComponent(link.receiptId)}`, label: "Open the truck" };
  if (link.kind === "run") return link.loadId
    ? { href: `/production/runs/${encodeURIComponent(link.runCode)}/loads/${encodeURIComponent(link.loadId)}`, label: "Open the load" }
    : { href: `/production/runs/${encodeURIComponent(link.runCode)}?stage=${encodeURIComponent(link.stage)}`, label: "Open the run" };
  if (!editsDirectly || !link.place) return null;
  const place = link.place;
  if (place.kind === "receipt") return { href: `/${siteSlug}/receipts/${encodeURIComponent(place.receiptId)}`, label: "Open the truck" };
  if (place.kind === "bin") return { href: `/${siteSlug}/warehouse-activities/${encodeURIComponent(place.binCode)}`, label: `Open Bin ${place.binCode}` };
  return { href: `/${siteSlug}/transfers`, label: "Open Transfers" };
}

function CheckRow({ item, siteSlug, canTake, canApprove, open, onOpen, onSent }: {
  item: QualityCheckItem; siteSlug: string; canTake: boolean; canApprove: boolean; open: boolean; onOpen: () => void; onSent: () => void;
}) {
  const target = openOf(item.link, siteSlug, canApprove);
  const info = QUALITY_SECTIONS[item.section];
  const formHere = canTake && item.link.kind === "form" && item.state === "to_do";
  // Waiting for this person's decision: the Warehouse Incharge decides the warehouse's checks (production's are the
  // Production Incharge's), in Approvals.
  const approveHere = canApprove && item.state === "waiting_approval" && info.approver === "warehouse_incharge";
  return (
    <div className="bg-white border border-warmstone-200 rounded-2xl shadow-xs p-5 space-y-3">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-[16rem] space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <QualitySectionTag section={item.section} />
            {/* "To do" is the QFS Officer's: to anyone else it says whose it is. */}
            <Pill tone={STATE_PILL[item.state].tone} label={item.state === "to_do" && !canTake ? "Waiting for QFS" : STATE_PILL[item.state].label} />
            {item.live && <Pill tone="term" label="Drying form open now" />}
          </div>
          <h3 className="text-[13px] font-bold text-warmstone-900">{item.title}</h3>
          <p className="text-[13px] text-warmstone-800">{item.reference}</p>
          {item.context && <p className="text-[12px] text-warmstone-500 tabular-nums">{item.context}</p>}
          {item.missing.length > 0 && <p className="text-[12px] text-warmstone-700">Still to measure: <span className="font-semibold">{item.missing.join(", ")}</span></p>}
          {item.note && <p className={`text-[12px] ${item.state === "cancelled" ? "text-warmstone-700" : "text-danger-700"}`}>{item.state === "cancelled" ? item.note : `Reason: ${item.note}`}</p>}
          {item.live && item.state === "to_do" && (
            <p className="text-[12px] text-warmstone-700">{item.live.by ?? "The Warehouse Incharge"} opened the drying form at {formatDateTime(item.live.since)} and is waiting for this check.</p>
          )}
          <p className="text-[11px] text-warmstone-500">
            From {info.where} · approved by the {APPROVER_LABEL[info.approver]}{item.since ? ` · ${item.state === "to_do" ? "due since" : "sent"} ${formatDate(item.since)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {formHere && <Button variant={open ? "secondary" : "primary"} icon="science" onClick={onOpen}>{open ? "Close" : "Fill in the check"}</Button>}
          {approveHere && (
            <Link to="/approvals" className={buttonClass("primary")}>
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">approval</span>
              Approve in Approvals
            </Link>
          )}
          {target && (
            <Link to={target.href} className={buttonClass(item.state === "to_do" && canTake ? "primary" : "secondary")}>
              {target.label}
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </Link>
          )}
        </div>
      </div>
      {open && item.link.kind === "form" && (
        <QualityCheckForm kind={item.link.submissionKind} targetId={item.link.targetId} requestId={item.link.requestId} facts={item.facts} onSent={onSent} onCancel={onOpen} />
      )}
    </div>
  );
}
