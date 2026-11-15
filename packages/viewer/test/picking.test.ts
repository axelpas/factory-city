import { describe, expect, it } from "vitest";
import { D, H, PRESENCE, STRIDE, TWIST, W, X, Y, Z } from "../src/anim/transition";
import { pickBuilding, rayBox } from "../src/view/picking";

function box(
  values: {
    x: number;
    y?: number;
    z: number;
    w: number;
    h: number;
    d: number;
    twist?: number;
    presence?: number;
  }[],
): Float32Array {
  const state = new Float32Array(values.length * STRIDE);
  values.forEach((v, i) => {
    const o = i * STRIDE;
    state[o + X] = v.x;
    state[o + Y] = v.y ?? 0;
    state[o + Z] = v.z;
    state[o + W] = v.w;
    state[o + H] = v.h;
    state[o + D] = v.d;
    state[o + TWIST] = v.twist ?? 0;
    state[o + PRESENCE] = v.presence ?? 1;
  });
  return state;
}

const down = [0, -1, 0] as const;

describe("picking", () => {
  it("hits a building from above and reports the distance to its roof", () => {
    const state = box([{ x: 10, z: 10, w: 4, h: 6, d: 2 }]);
    expect(rayBox([10, 100, 10], down, state, 0)).toBeCloseTo(94, 6);
    expect(rayBox([11.9, 100, 10.9], down, state, 0)).toBeDefined();
    expect(rayBox([12.1, 100, 10], down, state, 0)).toBeUndefined();
    expect(rayBox([10, 100, 11.1], down, state, 0)).toBeUndefined();
  });

  it("uses the whole volume of a twisted building", () => {
    const quarter = Math.PI / 4;
    const state = box([{ x: 0, z: 0, w: 10, h: 5, d: 1, twist: quarter }]);
    // the long side now lies on a diagonal: its ends are hit, the old ends are not
    const reach = 4.5 * Math.SQRT1_2;
    expect(rayBox([reach, 50, -reach], down, state, 0)).toBeDefined();
    expect(rayBox([-reach, 50, reach], down, state, 0)).toBeDefined();
    expect(rayBox([4.5, 50, 0], down, state, 0)).toBeUndefined();
    expect(rayBox([reach, 50, reach], down, state, 0)).toBeUndefined();
  });

  it("hits the side of a building with a slanted ray, and respects the base height", () => {
    const state = box([{ x: 0, y: 2, z: 0, w: 2, h: 4, d: 2 }]);
    const dir = [Math.SQRT1_2, -Math.SQRT1_2, 0] as const;
    expect(rayBox([-10, 13, 0], dir, state, 0)).toBeDefined();
    // passes under the base
    expect(rayBox([-10, 10.5, 0], dir, state, 0)).toBeUndefined();
  });

  it("ignores empty lots and buildings with no height", () => {
    const state = box([
      { x: 0, z: 0, w: 4, h: 0, d: 4, presence: 0 },
      { x: 0, z: 0, w: 4, h: 0.0001, d: 4 },
    ]);
    expect(pickBuilding([0, 50, 0], down, state)).toBeUndefined();
  });

  it("returns the nearest of several buildings on the ray", () => {
    const state = box([
      { x: 0, z: 0, w: 2, h: 3, d: 2 },
      { x: 0, z: 0, w: 2, h: 9, d: 2 },
      { x: 50, z: 0, w: 2, h: 20, d: 2 },
    ]);
    expect(pickBuilding([0, 100, 0], down, state)).toMatchObject({ index: 1 });
  });

  it("stays fast with 20,000 buildings", () => {
    const many = box(
      Array.from({ length: 20000 }, (_, i) => ({
        x: (i % 200) * 5,
        z: Math.floor(i / 200) * 5,
        w: 3,
        h: 1 + (i % 7),
        d: 3,
        twist: (i % 5) * 0.1,
      })),
    );
    // best of several passes: a busy machine slows a pass down, it never speeds one up
    let best = Number.POSITIVE_INFINITY;
    for (let pass = 0; pass < 8; pass++) {
      const started = performance.now();
      for (let k = 0; k < 4; k++) pickBuilding([500, 300, 250], [0.01, -1, 0.02], many);
      best = Math.min(best, (performance.now() - started) / 4);
    }
    expect(best).toBeLessThan(16);
  });
});
