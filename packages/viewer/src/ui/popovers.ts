/** Marks a disclosure element (`details`) that behaves as a popover: a menu, a metric help. */
export const POPOVER_CLASS = "popover";

function openPopovers(root: ParentNode): HTMLDetailsElement[] {
  return [...root.querySelectorAll<HTMLDetailsElement>(`details.${POPOVER_CLASS}[open]`)];
}

/** Closes the open popovers, but the one given. Returns true when something was closed. */
export function closePopovers(root: ParentNode, except?: Element | null): boolean {
  let closed = false;
  for (const popover of openPopovers(root)) {
    if (popover === except) continue;
    popover.open = false;
    closed = true;
  }
  return closed;
}

/**
 * One rule for every popover of the page: only one is open at a time, and a press outside closes it.
 * Escape is handled by the caller, which closes popovers before panels.
 */
export function watchPopovers(doc: Document): void {
  // `toggle` does not bubble: listen in the capture phase
  doc.addEventListener(
    "toggle",
    (e) => {
      const target = e.target;
      if (!(target instanceof HTMLDetailsElement) || !target.classList.contains(POPOVER_CLASS)) return;
      const summary = target.querySelector<HTMLElement>(":scope > summary");
      if (target.open) {
        closePopovers(doc, target);
        // opening moves focus into the popover, unless something in it already took it
        if (!target.contains(doc.activeElement) || doc.activeElement === summary) {
          const first = target.querySelector<HTMLElement>(
            ":scope > :not(summary) :is(input, select, button, [href], [tabindex]:not([tabindex='-1']))",
          );
          first?.focus();
        }
      } else if (summary && (target.contains(doc.activeElement) || doc.activeElement === doc.body)) {
        // closing gives focus back to the button that opened it
        summary.focus();
      }
    },
    true,
  );
  doc.addEventListener("pointerdown", (e) => {
    const inside = e.target instanceof Element ? e.target.closest(`details.${POPOVER_CLASS}`) : null;
    closePopovers(doc, inside);
  });
}
