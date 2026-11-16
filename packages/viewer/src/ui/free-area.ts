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

/** What covers the stage at each edge. */
function insetsOf(n: AreaNodes, stage: DOMRect, overlay: boolean): Insets {
  const header = shown(n.header);
  const left = shown(n.panel);
  const bottom = shown(n.timeline) ?? shown(n.status);
  const right = n.right.map(shown).filter((r) => r !== undefined);
  return {
    top: header ? header.bottom - stage.top : 0,
    left: left && !overlay ? left.right - stage.left : 0,
    right: right.length && !overlay ? stage.right - Math.min(...right.map((r) => r.left)) : 0,
    bottom: bottom ? stage.bottom - bottom.top : 0,
  };
}

/** The tallest of the things pinned at the bottom: a panel stops above it. */
function stackOf(n: AreaNodes, stage: DOMRect): number {
  const heights = [n.legend, n.timeline, n.status].map((node) => {
    const r = shown(node);
    return r ? stage.bottom - r.top : 0;
  });
  return Math.max(...heights);
}

/**
 * Measures what covers the stage on each side. In a medium window the panels overlay the stage: the city
 * keeps the whole width.
 */
export function measureFreeArea(n: AreaNodes, overlay: boolean): FreeArea {
  const stage = n.stage.getBoundingClientRect();
  return { insets: insetsOf(n, stage, overlay), bottomStack: stackOf(n, stage) };
}
