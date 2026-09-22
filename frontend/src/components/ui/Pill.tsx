/** Generic labeled pill, styled by a tone class. No domain knowledge — the caller decides what
 * tone/label mean; this just renders them.
 *
 * Tone -> color mapping (the app's 5-way semantic vocabulary, ported onto the new brand palette):
 *   entry    -> success (a process step happened / a milestone reached)
 *   decision -> ambernut (a decision point / needs attention)
 *   system   -> warmstone (automatic / system-derived)
 *   term     -> brand, muted weight (a calm terminal state — deliberately NOT the vivid CTA
 *              weight used for primary buttons, so a "term" pill never reads as an action)
 *   gap      -> danger (rejected / a real problem) — the reference mockup had no rejection
 *              example, so this is a new addition to keep that signal unambiguous
 */
const TONE_CLASS: Record<string, string> = {
  entry: "bg-success-100 text-success-800 border-success-200",
  decision: "bg-ambernut-100 text-ambernut-800 border-ambernut-200",
  system: "bg-warmstone-100 text-warmstone-700 border-warmstone-200",
  term: "bg-brand-50 text-brand-800 border-brand-200",
  gap: "bg-danger-100 text-danger-700 border-danger-200",
};

export function Pill({ tone, label }: { tone: string; label: string }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border whitespace-nowrap ${
        TONE_CLASS[tone] ?? TONE_CLASS.system
      }`}
    >
      {label}
    </span>
  );
}
