import { D, H, PRESENCE, STRIDE, TWIST, W, X, Y, Z } from "../anim/transition";

export type Vec3 = readonly [number, number, number];

export interface Hit {
  index: number;
  distance: number;
}

const MIN_SIZE = 1e-3;

/**
 * Distance along a ray to a building, or undefined when the ray misses it. The building is a box standing
 * on its base, turned around its vertical axis: the whole volume is the target, twisted or not.
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
  const twist = state[o + TWIST] as number;
  const cos = Math.cos(twist);
  const sin = Math.sin(twist);
  // bring the ray into the box's own axes (inverse of the rotation applied to the box)
  const px = origin[0] - (state[o + X] as number);
  const py = origin[1] - (state[o + Y] as number);
  const pz = origin[2] - (state[o + Z] as number);
  const h2 = h;
  let near = Number.NEGATIVE_INFINITY;
  let far = Number.POSITIVE_INFINITY;
  // x axis of the box
  let a = px * cos - pz * sin;
  let v = dir[0] * cos - dir[2] * sin;
  let lo = -w / 2;
  let hi = w / 2;
  for (let axis = 0; axis < 3; axis++) {
    if (axis === 1) {
      a = py;
      v = dir[1];
      lo = 0;
      hi = h2;
    } else if (axis === 2) {
      a = px * sin + pz * cos;
      v = dir[0] * sin + dir[2] * cos;
      lo = -d / 2;
      hi = d / 2;
    }
    if (Math.abs(v) < 1e-12) {
      if (a < lo || a > hi) return undefined;
      continue;
    }
    const t1 = (lo - a) / v;
    const t2 = (hi - a) / v;
    const tMin = Math.min(t1, t2);
    const tMax = Math.max(t1, t2);
    if (tMin > near) near = tMin;
    if (tMax < far) far = tMax;
    if (near > far) return undefined;
  }
  if (far < 0) return undefined;
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
