import type { Insets } from "../view/framing";

/** The parts of the page that sit on or around the stage. */
export interface AreaNodes {
  stage: HTMLElement;
  header: HTMLElement;
  /** The view panel on the left. */
  panel: HTMLElement;
  /** The timeline bar, when there is one. */
  timeline: HTMLElement;
  status: HTMLElement;
  legend: HTMLElement;
  /** Panels on the right that take room from the city. */
  right: HTMLElement[];
}

export interface FreeArea {
  /** What covers the stage on each side. */
  insets: Insets;
  /** The height of the tallest thing pinned at the bottom: a panel stops above it. */
  bottomStack: number;
}

/** The box of a node, or nothing when it is hidden or empty. */
function shown(node: HTMLElement): DOMRect | undefined {
  const r = node.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : undefined;
}

/**
 * Measures what covers the stage on each side. In a medium window the panels overlay the stage: the city
 * keeps the whole width.
 */
export function measureFreeArea(n: AreaNodes, overlay: boolean): FreeArea {
  const stage = n.stage.getBoundingClientRect();
  const header = shown(n.header);
  const left = shown(n.panel);
  const status = shown(n.status);
  const bottom = shown(n.timeline) ?? status;
  const right = n.right.map(shown).filter((r) => r !== undefined);
  const insets: Insets = {
    top: header ? header.bottom - stage.top : 0,
    left: left && !overlay ? left.right - stage.left : 0,
    right: right.length && !overlay ? stage.right - Math.min(...right.map((r) => r.left)) : 0,
    bottom: bottom ? stage.bottom - bottom.top : 0,
  };
  const legend = shown(n.legend);
  const bottomStack = Math.max(
    legend ? stage.bottom - legend.top : 0,
    bottom ? stage.bottom - bottom.top : 0,
    status ? stage.bottom - status.top : 0,
  );
  return { insets, bottomStack };
}
