import { SITE_LIST, type SiteSlug } from "../config/sites";

interface Props {
  value: SiteSlug | "";
  onChange: (value: SiteSlug | "") => void;
  /**
   * Filter-mode pages (the jute ledger pages — a ledger-4 row can legitimately belong to both
   * sites at once) show an "All" option alongside the two sites. Navigate-mode pages (Receipts,
   * Stock, Drying, Dispatch, Issue-to-Production) never do — a URL under `/:site/*` is always
   * exactly one site, so there's nothing "All" would even navigate to.
   */
  allowAll?: boolean;
}

/**
 * The one site-switching control, used two ways (see this component's callers): on a page under
 * `/:site/*`, `onChange` navigates to the other site's URL; on a jute ledger page, it just sets a
 * local filter. This component only renders the two/three options and reports which was picked —
 * it has no opinion on what picking one *does*, which is what keeps both call sites simple.
 */
export function SiteSwitcher({ value, onChange, allowAll }: Props) {
  const pill = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition-colors ${
      active ? "bg-warmstone-800 text-white shadow-sm" : "text-warmstone-500 hover:text-warmstone-800"
    }`;

  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-warmstone-100 border border-warmstone-200">
      {allowAll && (
        <button type="button" onClick={() => onChange("")} className={pill(value === "")}>
          All
        </button>
      )}
      {SITE_LIST.map((s) => (
        <button key={s.slug} type="button" onClick={() => onChange(s.slug)} className={pill(value === s.slug)}>
          {s.sublabel}
        </button>
      ))}
    </div>
  );
}
