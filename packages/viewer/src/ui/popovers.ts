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
      if (target instanceof HTMLDetailsElement && target.open && target.classList.contains(POPOVER_CLASS))
        closePopovers(doc, target);
    },
    true,
  );
  doc.addEventListener("pointerdown", (e) => {
    const inside = e.target instanceof Element ? e.target.closest(`details.${POPOVER_CLASS}`) : null;
    closePopovers(doc, inside);
  });
}
