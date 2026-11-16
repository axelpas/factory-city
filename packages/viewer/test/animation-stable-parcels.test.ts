import { expect, it } from "vitest";
import { D, H, PRESENCE, STRIDE, W, X, Y, Z } from "../src/anim/transition";
import { FRAMES, setup } from "./timeline-helpers";

it("stable parcels > never moves a parcel between any two frames", () => {
  const { data, stateOf } = setup();
  const states = FRAMES.map((_, f) => stateOf(f));
  for (let f = 1; f < states.length; f++) {
    for (let i = 0; i < data.paths.length; i++) {
      for (const c of [X, Y, Z] as const) {
        expect((states[f] as Float32Array)[i * STRIDE + c], `${data.paths[i]} frame ${f}`).toBe(
          (states[0] as Float32Array)[i * STRIDE + c],
        );
      }
    }
  }
});

it("stable parcels > gives a parcel to every file of any frame, and keeps buildings inside it", () => {
  const { data, layout, stateOf } = setup();
  expect(data.paths).toEqual(["lib/deep/y.ts", "lib/x.ts", "src/a.ts", "src/b.ts", "src/new.ts"]);
  for (let f = 0; f < FRAMES.length; f++) {
    const state = stateOf(f);
    data.paths.forEach((path, i) => {
      const rect = layout.files.get(path);
      expect(rect, path).toBeDefined();
      if (!rect) return;
      const o = i * STRIDE;
      expect((state[o + X] as number) - (state[o + W] as number) / 2).toBeGreaterThanOrEqual(rect.x - 1e-4);
      expect((state[o + X] as number) + (state[o + W] as number) / 2).toBeLessThanOrEqual(
        rect.x + rect.w + 1e-4,
      );
      expect((state[o + Z] as number) + (state[o + D] as number) / 2).toBeLessThanOrEqual(
        rect.y + rect.h + 1e-4,
      );
    });
  }
});

it("stable parcels > leaves an empty lot for a file that does not exist yet or was deleted", () => {
  const { data, stateOf } = setup();
  const at = (f: number, path: string, c: number) =>
    stateOf(f)[(data.pathIndex.get(path) as number) * STRIDE + c];
  expect(at(0, "src/new.ts", PRESENCE)).toBe(0);
  expect(at(0, "src/new.ts", H)).toBe(0);
  expect(at(1, "src/new.ts", PRESENCE)).toBe(1);
  expect(at(2, "src/b.ts", PRESENCE)).toBe(0);
  expect(at(3, "src/b.ts", PRESENCE)).toBe(1);
  expect(data.firstFrame[data.pathIndex.get("src/new.ts") as number]).toBe(1);
  expect(data.lastFrame[data.pathIndex.get("lib/x.ts") as number]).toBe(3);
});

it("stable parcels > keeps scales fixed across frames", () => {
  const { data, stateOf } = setup();
  const a = data.pathIndex.get("src/a.ts") as number;
  // src/a.ts has the same values in frames 2 and 3: same height, though other files changed
  expect(stateOf(2)[a * STRIDE + H]).toBe(stateOf(3)[a * STRIDE + H]);
  // and the tallest building of the whole timeline is in the last frame
  expect(stateOf(4)[a * STRIDE + H]).toBeGreaterThan(stateOf(1)[a * STRIDE + H] as number);
});
