/** Generic labeled pill, styled by a tone class. No domain knowledge — the caller decides what
 * tone/label mean; this just renders them. */
const TONE_CLASS: Record<string, string> = {
  entry: "kind-entry",
  decision: "kind-decision",
  system: "kind-system",
  gap: "kind-gap",
  term: "kind-term",
};

export function Pill({ tone, label }: { tone: string; label: string }) {
  return <span className={`kind-chip pill ${TONE_CLASS[tone] ?? ""}`}>{label}</span>;
}
