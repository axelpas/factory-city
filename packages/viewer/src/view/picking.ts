import { D, H, PRESENCE, STRIDE, W, X, Y, Z } from "../anim/transition";

export type Vec3 = readonly [number, number, number];

export interface Hit {
  index: number;
  distance: number;
}

const MIN_SIZE = 1e-3;

/**
 * The span of a ray inside one slab of the box (between `lo` and `hi` on one axis): where it enters and leaves.
 * `undefined` when the ray runs parallel to the slab and outside it.
 */
function slab(a: number, v: number, lo: number, hi: number): [number, number] | undefined {
  if (Math.abs(v) < 1e-12)
    return a < lo || a > hi ? undefined : [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
  const t1 = (lo - a) / v;
  const t2 = (hi - a) / v;
  return [Math.min(t1, t2), Math.max(t1, t2)];
}

/**
 * Distance along a ray to a building, or undefined when the ray misses it. The building is a box standing
 * on its base: the whole volume is the target.
 */
export function rayBox(origin: Vec3, dir: Vec3, state: Float32Array, index: number): number | undefined {
  const o = index * STRIDE;
  const w = state[o + W] as number;
  const h = state[o + H] as number;
  const d = state[o + D] as number;
  if ((state[o + PRESENCE] as number) <= 0.01 || w < MIN_SIZE || h < MIN_SIZE || d < MIN_SIZE)
    return undefined;
  // cheap rejection first: most buildings are far from the ray (dir is a unit vector)
  const cx = (state[o + X] as number) - origin[0];
  const cy = (state[o + Y] as number) + h / 2 - origin[1];
  const cz = (state[o + Z] as number) - origin[2];
  const along = cx * dir[0] + cy * dir[1] + cz * dir[2];
  if (cx * cx + cy * cy + cz * cz - along * along > (w * w + h * h + d * d) / 4) return undefined;
  const spans = [
    slab(origin[0] - (state[o + X] as number), dir[0], -w / 2, w / 2),
    slab(origin[1] - (state[o + Y] as number), dir[1], 0, h),
    slab(origin[2] - (state[o + Z] as number), dir[2], -d / 2, d / 2),
  ];
  if (spans.includes(undefined)) return undefined;
  const near = Math.max(...(spans as Array<[number, number]>).map(([t]) => t));
  const far = Math.min(...(spans as Array<[number, number]>).map(([, t]) => t));
  if (near > far || far < 0) return undefined;
  return near >= 0 ? near : far;
}

/** The nearest building hit by a ray, among the buildings as they are drawn right now. */
export function pickBuilding(origin: Vec3, dir: Vec3, state: Float32Array): Hit | undefined {
  let best: Hit | undefined;
  const count = state.length / STRIDE;
  for (let i = 0; i < count; i++) {
    const distance = rayBox(origin, dir, state, i);
    if (distance !== undefined && (!best || distance < best.distance)) best = { index: i, distance };
  }
  return best;
}
