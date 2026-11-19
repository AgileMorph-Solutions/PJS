import { useEffect, useState, type SyntheticEvent } from "react";

/**
 * Which panels of an accordion are open, remembered rather than recomputed. Binding `<details open>` straight to "the
 * active step" closed the panel being typed in: the first value entered marks a stage reached, the active step moves on,
 * and React flipped `open` to false. Here the active step opens on its own (on load, and whenever it moves on), but
 * nothing is ever closed except by the person.
 */
export function useOpenPanels(activeId: string | undefined) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(activeId ? [activeId] : []));
  useEffect(() => {
    if (activeId) setOpen((prev) => (prev.has(activeId) ? prev : new Set(prev).add(activeId)));
  }, [activeId]);
  return {
    isOpen: (id: string) => open.has(id),
    /** For `<details onToggle>`: follows the person's own click on the summary. */
    onToggle: (id: string) => (e: SyntheticEvent<HTMLDetailsElement>) => {
      const nowOpen = e.currentTarget.open;
      setOpen((prev) => {
        if (prev.has(id) === nowOpen) return prev;
        const next = new Set(prev);
        if (nowOpen) next.add(id); else next.delete(id);
        return next;
      });
    },
  };
}
