import { useState } from "react";
import { Link } from "react-router-dom";
import {
  APPROVER_LABEL, QUALITY_SECTIONS, type QualityCheckItem, type QualityCheckLink, type QualitySection,
} from "@anagroci/contract/domain/qualityChecks";
import { formatDate } from "@anagroci/contract/domain/dateFormat";
import { PageHeader } from "../../components/ui/PageHeader";
import { EmptyState } from "../../components/ui/EmptyState";
import { Pill } from "../../components/ui/Pill";
import { Button, buttonClass } from "../../components/ui/Button";
import { QualitySectionTag } from "../../components/quality/QualitySectionTag";
import { QualityCheckForm } from "../../components/quality/QualityCheckForm";
import { useLoaded } from "../../state/useLoaded";
import { useSite } from "../../state/SiteContext";
import { api } from "../../repository/api";

const STATE_PILL = {
  to_do: { tone: "decision", label: "To do" },
  waiting_approval: { tone: "system", label: "Waiting for approval" },
  rejected: { tone: "gap", label: "Rejected" },
} as const;

const GROUPS: { state: QualityCheckItem["state"]; title: string; empty: string }[] = [
  { state: "rejected", title: "Rejected", empty: "" },
  { state: "to_do", title: "To do", empty: "Nothing to check right now." },
  { state: "waiting_approval", title: "Waiting for approval", empty: "Nothing waiting for approval." },
];

/**
 * The QFS Officer's quality checks (26 Nov 2026, user): every check at their warehouse in one list, each named by the section it
 * comes from (Reception, Unloading, Drying, Transfer lot, Triage, Production…) and the record it is about, with what is still
 * to be measured. A check of a truck or a production run opens on that page; a drying, transfer lot or triage check is filled
 * here and sent for the Warehouse Incharge's approval. The list is read off the records (services/qualityChecks.ts), never kept.
 */
export function QualityChecksPage() {
  const site = useSite();
  const [saved, setSaved] = useState(0);
  const loaded = useLoaded(async () => [await api.qualityChecks(site.warehouseName)], [site.warehouseName], { reloadOn: saved });
  const view = loaded.rows[0];
  const [section, setSection] = useState<QualitySection | "all">("all");
  const [open, setOpen] = useState<string | null>(null);

  const items = view?.items ?? [];
  const shown = section === "all" ? items : items.filter((i) => i.section === section);
  const count = (s: QualitySection | "all") => (s === "all" ? items : items.filter((i) => i.section === s)).filter((i) => i.state !== "waiting_approval").length;

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={`Quality · ${site.warehouseName}`}
        title="Quality checks"
        lede="Every quality check at this warehouse, by the section it comes from. Each one you send waits for approval before it counts."
      />

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
        if (g.state === "rejected" && rows.length === 0) return null;
        return (
          <section key={g.state} className="space-y-3">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-warmstone-500 px-1">{g.title} · {rows.length}</h2>
            {rows.length === 0 && <EmptyState title={g.empty} />}
            {rows.map((item) => (
              <CheckRow
                key={item.key} item={item} siteSlug={site.slug}
                open={open === item.key} onOpen={() => setOpen(open === item.key ? null : item.key)}
                onSent={() => { setOpen(null); setSaved((n) => n + 1); }}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function hrefOf(link: QualityCheckLink, siteSlug: string): string | null {
  if (link.kind === "receipt") return `/${siteSlug}/receipts/${encodeURIComponent(link.receiptId)}`;
  if (link.kind === "run") return link.loadId
    ? `/production/runs/${encodeURIComponent(link.runCode)}/loads/${encodeURIComponent(link.loadId)}`
    : `/production/runs/${encodeURIComponent(link.runCode)}?stage=${encodeURIComponent(link.stage)}`;
  return null;
}

function CheckRow({ item, siteSlug, open, onOpen, onSent }: { item: QualityCheckItem; siteSlug: string; open: boolean; onOpen: () => void; onSent: () => void }) {
  const href = hrefOf(item.link, siteSlug);
  const info = QUALITY_SECTIONS[item.section];
  const formHere = item.link.kind === "form" && item.state === "to_do";
  return (
    <div className="bg-white border border-warmstone-200 rounded-2xl shadow-xs p-5 space-y-3">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-[16rem] space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <QualitySectionTag section={item.section} />
            <Pill tone={STATE_PILL[item.state].tone} label={STATE_PILL[item.state].label} />
          </div>
          <h3 className="text-[13px] font-bold text-warmstone-900">{item.title}</h3>
          <p className="text-[13px] text-warmstone-800">{item.reference}</p>
          {item.context && <p className="text-[12px] text-warmstone-500 tabular-nums">{item.context}</p>}
          {item.missing.length > 0 && <p className="text-[12px] text-warmstone-700">Still to measure: <span className="font-semibold">{item.missing.join(", ")}</span></p>}
          {item.note && <p className="text-[12px] text-danger-700">Reason: {item.note}</p>}
          <p className="text-[11px] text-warmstone-500">
            From {info.where} · approved by the {APPROVER_LABEL[info.approver]}{item.since ? ` · ${item.state === "to_do" ? "due since" : "sent"} ${formatDate(item.since)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {formHere && <Button variant={open ? "secondary" : "primary"} icon="science" onClick={onOpen}>{open ? "Close" : "Fill in the check"}</Button>}
          {href && (
            <Link to={href} className={buttonClass(item.state === "to_do" ? "primary" : "secondary")}>
              Open {item.link.kind === "receipt" ? "the truck" : item.link.kind === "run" && item.link.loadId ? "the load" : "the run"}
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </Link>
          )}
        </div>
      </div>
      {open && item.link.kind === "form" && (
        <QualityCheckForm kind={item.link.submissionKind} targetId={item.link.targetId} facts={item.facts} onSent={onSent} onCancel={onOpen} />
      )}
    </div>
  );
}
