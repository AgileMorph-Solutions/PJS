import { QUALITY_SECTIONS, type QualitySection } from "@anagroci/contract/domain/qualityChecks";

/**
 * Which part of the app a quality check comes from (26 Nov 2026, user: the QFS Officer should know where each form is from),
 * named the same on the Quality checks page, on the form and in Approvals: the contract's QUALITY_SECTIONS.
 */
export function QualitySectionTag({ section }: { section: QualitySection }) {
  const s = QUALITY_SECTIONS[section];
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-brand-50 text-brand-800 border-brand-200 whitespace-nowrap" title={s.where}>
      <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{s.icon}</span>
      {s.label}
    </span>
  );
}
