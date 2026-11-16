import { D, H, PRESENCE, STRIDE, W, X, Y, Z } from "../anim/transition";

/** Smooth start and end for a camera move: `t` from 0 to 1 gives 0 to 1. */
export function easeInOut(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c < 0.5 ? 2 * c * c : 1 - (-2 * c + 2) ** 2 / 2;
}

/** Progress of a timed move: the share done after `elapsed` of `duration` milliseconds, from 0 to 1. */
export function moveProgress(elapsed: number, duration: number): number {
  return duration <= 0 ? 1 : Math.min(Math.max(elapsed / duration, 0), 1);
}

/** Below this gap a fade is over: it snaps to its target. */
const FADE_EPSILON = 0.002;

/**
 * One step of a fade between 0 and 1 toward a target, at a speed of one full fade per `fadeMs`. `changed` is
 * true while the value moves (an image must be drawn), false once it rests on its target.
 */
export function fadeStep(
  value: number,
  target: number,
  dtMs: number,
  fadeMs: number,
): { value: number; changed: boolean } {
  const gap = target - value;
  if (Math.abs(gap) < FADE_EPSILON) return { value: target, changed: gap !== 0 };
  const step = Math.min(Math.abs(gap), Math.max(dtMs, 0) / fadeMs);
  return { value: value + Math.sign(gap) * step, changed: true };
}

/** A building's box as drawn: its center, and its width, height and depth. */
export interface Box3 {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}

/** A building thinner than this has nothing to outline. */
const MIN_HEIGHT = 1e-3;
/** An outline sits just outside the building, so that it is not buried in its faces. */
export const OUTLINE_GROWTH = 1.01;

/**
 * The outline of the selected building at this moment of the animation: where it stands and how big it is,
 * or undefined when there is nothing to outline (no selection, no state, or a building that is not there in
 * this frame).
 */
export function selectionBox(state: Float32Array | undefined, index: number | null): Box3 | undefined {
  if (index === null || !state) return undefined;
  const o = index * STRIDE;
  const h = state[o + H];
  if (h === undefined || (state[o + PRESENCE] as number) < 0.5 || h < MIN_HEIGHT) return undefined;
  return {
    x: state[o + X] as number,
    y: (state[o + Y] as number) + h / 2,
    z: state[o + Z] as number,
    w: (state[o + W] as number) * OUTLINE_GROWTH,
    h: h * OUTLINE_GROWTH,
    d: (state[o + D] as number) * OUTLINE_GROWTH,
  };
}

/** What a move to a district needs to know about the view. */
export interface DistrictViewInput {
  rect: { x: number; y: number; w: number; h: number };
  /** Side of the city, in world units. */
  size: number;
  perspective: boolean;
  fovDeg: number;
  /** Width over height of the part of the picture the panels leave free. */
  freeAspect: number;
  /** Distance of the camera from its target now, and its zoom now. */
  distance: number;
  zoom: number;
  /** Height of the orthographic frame at zoom 1, as a share of the city side. */
  orthoHeight: number;
}

/** The margin left around a district that fills the view. */
const DISTRICT_MARGIN = 1.3;

/**
 * Where the camera goes to frame a district: the point it looks at, how far it stands (perspective) and its
 * zoom (orthographic). The district fills the free area without ever going closer than a small fraction of the
 * city.
 */
export function districtView(input: DistrictViewInput): {
  target: { x: number; z: number };
  distance: number;
  zoom: number;
} {
  const { rect, size } = input;
  const target = { x: rect.x + rect.w / 2, z: rect.y + rect.h / 2 };
  const diag = Math.hypot(rect.w, rect.h) * DISTRICT_MARGIN;
  if (input.perspective) {
    const aspect = Math.min(input.freeAspect, 1);
    const fit = diag / 2 / Math.tan((input.fovDeg * Math.PI) / 360) / Math.max(aspect, 1e-6);
    return { target, distance: Math.max(fit, size * 0.06), zoom: input.zoom };
  }
  return { target, distance: input.distance, zoom: (size * input.orthoHeight) / Math.max(diag, size * 0.05) };
}
