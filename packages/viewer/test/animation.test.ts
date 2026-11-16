import { describe, expect, it } from "vitest";
import { Animator, type AnimatorSink, segmentAt } from "../src/anim/animator";
import { mixOklab, oklabToSrgb, srgbToOklab } from "../src/anim/oklab";
import {
  B,
  D,
  easeInOut,
  G,
  H,
  localProgress,
  MARK,
  MAX_DELAY,
  PRESENCE,
  R,
  STRIDE,
  W,
  X,
  Y,
  Z,
} from "../src/anim/transition";
import { FRAMES, MAPPING, setup } from "./timeline-helpers";

function recorder() {
  const log = { states: 0, cuts: 0, progress: [] as number[] };
  const sink: AnimatorSink = {
    states: () => {
      log.states++;
    },
    progress: (u) => {
      log.progress.push(u);
    },
    cut: () => {
      log.cuts++;
    },
  };
  return { log, sink };
}

function animator(options: { reduced?: boolean } = {}) {
  const s = setup();
  const { log, sink } = recorder();
  const a = new Animator(s.data.paths.length, s.delays, s.ramp, sink, {
    moveShare: 0.7,
    tweenMs: 700,
    secondsPerFrame: 1,
  });
  a.reducedMotion = options.reduced ?? false;
  a.reset(FRAMES.length, (f) => s.stateOf(f));
  return { a, log, ...s };
}

const GEOMETRY = [X, Y, Z, W, H, D, MARK, PRESENCE] as const;
const COLOR = [R, G, B] as const;

/** Largest change of each visible channel between two pictures. A building with no height shows nothing. */
function delta(before: Float32Array, after: Float32Array) {
  let geometry = 0;
  let color = 0;
  for (let o = 0; o < before.length; o += STRIDE) {
    const visible = (before[o + H] as number) > 1e-6 || (after[o + H] as number) > 1e-6;
    for (const c of [X, Y, Z, H, PRESENCE] as const)
      geometry = Math.max(geometry, Math.abs((after[o + c] as number) - (before[o + c] as number)));
    if (!visible) continue;
    for (const c of GEOMETRY)
      geometry = Math.max(geometry, Math.abs((after[o + c] as number) - (before[o + c] as number)));
    for (const c of COLOR)
      color = Math.max(color, Math.abs((after[o + c] as number) - (before[o + c] as number)));
  }
  return { geometry, color };
}

/** Largest value any geometric channel takes: the yardstick for "a jump". */
function span(states: Float32Array[]): number {
  let max = 0;
  for (const s of states)
    for (let o = 0; o < s.length; o += STRIDE)
      for (const c of [W, H, D] as const) max = Math.max(max, s[o + c] as number);
  return max;
}

describe("stable parcels", () => {
  it("never moves a parcel between any two frames", () => {
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

  it("gives a parcel to every file of any frame, and keeps buildings inside it", () => {
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

  it("leaves an empty lot for a file that does not exist yet or was deleted", () => {
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

  it("keeps scales fixed across frames", () => {
    const { data, stateOf } = setup();
    const a = data.pathIndex.get("src/a.ts") as number;
    // src/a.ts has the same values in frames 2 and 3: same height, though other files changed
    expect(stateOf(2)[a * STRIDE + H]).toBe(stateOf(3)[a * STRIDE + H]);
    // and the tallest building of the whole timeline is in the last frame
    expect(stateOf(4)[a * STRIDE + H]).toBeGreaterThan(stateOf(1)[a * STRIDE + H] as number);
  });
});

describe("continuous animation", () => {
  it("has no jump in any channel when the playhead is dragged across the whole timeline", () => {
    const { a, stateOf } = animator();
    const size = span(FRAMES.map((_, f) => stateOf(f)));
    const steps = 400;
    let previous = a.onScreen();
    let worst = { geometry: 0, color: 0 };
    for (let k = 1; k <= steps * (FRAMES.length - 1); k++) {
      a.setPosition(k / steps);
      const now = a.onScreen();
      const d = delta(previous, now);
      worst = { geometry: Math.max(worst.geometry, d.geometry), color: Math.max(worst.color, d.color) };
      previous = now;
    }
    // one step is 1/400 of a frame: nothing may change by more than a few percent of the largest size
    expect(worst.geometry).toBeLessThan(size * 0.03);
    expect(worst.color).toBeLessThan(0.03);
  });

  it("is continuous at frame boundaries, where the buffers are rewritten", () => {
    const { a, log } = animator();
    for (let f = 1; f < FRAMES.length - 1; f++) {
      a.setPosition(f - 1e-6);
      const before = a.onScreen();
      const writes = log.states;
      a.setPosition(f + 1e-6);
      expect(log.states).toBe(writes + 1);
      const d = delta(before, a.onScreen());
      expect(d.geometry).toBeLessThan(1e-3);
      expect(d.color).toBeLessThan(1e-3);
    }
  });

  it("shows exactly the frame during the hold, and the same picture at the start of the next move", () => {
    const { a, stateOf } = animator();
    a.setPosition(1.8); // past 70% of the move: hold
    const d = delta(a.onScreen(), stateOf(2));
    expect(d.geometry).toBeLessThan(1e-4);
    expect(d.color).toBeLessThan(1e-4);
    a.setPosition(2);
    expect(delta(a.onScreen(), stateOf(2)).geometry).toBeLessThan(1e-4);
  });

  it("raises a new file from its lot and sinks a deleted one, without a pop", () => {
    const { a, data } = animator();
    const fresh = (data.pathIndex.get("src/new.ts") as number) * STRIDE;
    const gone = (data.pathIndex.get("src/b.ts") as number) * STRIDE;
    const heights: number[] = [];
    for (let k = 0; k <= 200; k++) {
      a.setPosition(k / 200);
      heights.push(a.onScreen()[fresh + H] as number);
    }
    expect(heights[0]).toBe(0);
    expect(heights.at(-1)).toBeGreaterThan(1);
    for (let k = 1; k < heights.length; k++) {
      expect((heights[k] as number) - (heights[k - 1] as number)).toBeGreaterThanOrEqual(-1e-6);
      expect((heights[k] as number) - (heights[k - 1] as number)).toBeLessThan(
        (heights.at(-1) as number) * 0.06,
      );
    }
    // while it rises it already has its final footprint: it grows up, not sideways
    a.setPosition(0.35);
    expect(a.onScreen()[fresh + W]).toBeCloseTo(a.transition.target[fresh + W] as number, 5);
    // the deleted file keeps its footprint while it sinks
    a.setPosition(1.35);
    const mid = a.onScreen();
    expect(mid[gone + H]).toBeGreaterThan(0);
    expect(mid[gone + W]).toBeCloseTo(a.transition.start[gone + W] as number, 5);
    a.setPosition(2);
    expect(a.onScreen()[gone + H]).toBe(0);
  });

  it("continues from what is on screen when a move is interrupted by a jump", () => {
    const { a, stateOf } = animator();
    const size = span(FRAMES.map((_, f) => stateOf(f)));
    a.setPosition(0.3); // in the middle of the move from frame 0 to frame 1
    const before = a.onScreen();
    a.goTo(4);
    const after = a.onScreen();
    const d = delta(before, after);
    expect(d.geometry).toBeLessThan(1e-3);
    expect(d.color).toBeLessThan(1e-3);
    // then it glides to the new target
    let previous = after;
    let worst = 0;
    while (a.tick(16)) {
      const now = a.onScreen();
      worst = Math.max(worst, delta(previous, now).geometry);
      previous = now;
    }
    expect(worst).toBeLessThan(size * 0.12);
    expect(delta(a.onScreen(), stateOf(4)).geometry).toBeLessThan(1e-4);
    expect(a.frame).toBe(4);
  });

  it("moves the playhead with the picture during an animated jump", () => {
    const { a } = animator();
    expect(a.playhead).toBe(0);
    a.goTo(4);
    expect(a.playhead).toBe(0);
    const seen: number[] = [];
    while (a.tick(50)) seen.push(a.playhead);
    // it travels from 0 to 4 without going backwards or past the target, and lands on it
    expect(seen.some((p) => p > 0 && p < 4)).toBe(true);
    expect(seen.every((p, i) => p >= (seen[i - 1] ?? 0) && p <= 4)).toBe(true);
    expect(a.playhead).toBe(4);
  });

  it("starts an interrupting jump from where the playhead is drawn", () => {
    const { a } = animator();
    a.goTo(4);
    for (let k = 0; k < 8; k++) a.tick(50);
    const drawn = a.playhead;
    expect(drawn).toBeGreaterThan(0);
    a.goTo(1);
    expect(a.playhead).toBeCloseTo(drawn, 6);
  });

  it("continues from what is on screen when a jump is itself interrupted", () => {
    const { a } = animator();
    a.goTo(4);
    for (let k = 0; k < 10; k++) a.tick(16);
    const before = a.onScreen();
    a.goTo(1);
    expect(delta(before, a.onScreen()).geometry).toBeLessThan(1e-3);
    a.setPosition(3.2);
    expect(delta(before, a.onScreen()).geometry).toBeLessThan(1e-3);
  });

  it("animates a change of metric from the current view instead of snapping", () => {
    const { a, stateOf } = animator();
    a.setPosition(2);
    const before = a.onScreen();
    const other = { ...MAPPING, height: "rloc", color: "mcc" };
    a.retarget((f) => stateOf(f, other));
    expect(delta(before, a.onScreen()).geometry).toBeLessThan(1e-3);
    expect(delta(before, a.onScreen()).color).toBeLessThan(1e-3);
    while (a.tick(16)) {
      /* run to the end */
    }
    expect(delta(a.onScreen(), stateOf(2, other)).geometry).toBeLessThan(1e-4);
  });

  it("plays at a steady pace, holds on each frame and stops at the end", () => {
    const { a, stateOf } = animator();
    const size = span(FRAMES.map((_, f) => stateOf(f)));
    a.play();
    let previous = a.onScreen();
    let worst = 0;
    let ticks = 0;
    while (a.tick(1000 / 60) && ticks < 2000) {
      const now = a.onScreen();
      worst = Math.max(worst, delta(previous, now).geometry);
      previous = now;
      ticks++;
    }
    expect(a.playing).toBe(false);
    expect(a.position).toBe(FRAMES.length - 1);
    // 4 steps of 1 s at 60 images per second
    expect(ticks).toBeGreaterThan(230);
    expect(ticks).toBeLessThan(250);
    expect(worst).toBeLessThan(size * 0.12);
  });

  it("loops back with a move, not a cut", () => {
    const { a, stateOf } = animator();
    a.loop = true;
    a.setPosition(FRAMES.length - 1 - 0.01);
    a.play();
    a.tick(100);
    const before = a.onScreen();
    a.tick(1);
    expect(delta(before, a.onScreen()).geometry).toBeLessThan(span([stateOf(4)]) * 0.02);
    for (let k = 0; k < 60; k++) a.tick(16);
    expect(a.playing).toBe(true);
    expect(a.position).toBeLessThan(1);
  });

  it("writes the buffers once per step, not once per image", () => {
    const { a, log } = animator();
    const writes = log.states;
    for (let k = 0; k <= 50; k++) a.setPosition(0.5 + k / 200);
    expect(log.states).toBe(writes);
    expect(log.progress.length).toBeGreaterThan(50);
  });

  it("replaces movement by a cut when reduced motion is on", () => {
    const { a, log, stateOf } = animator({ reduced: true });
    a.setPosition(0.3);
    expect(delta(a.onScreen(), stateOf(0)).geometry).toBe(0);
    a.setPosition(0.7);
    expect(delta(a.onScreen(), stateOf(1)).geometry).toBe(0);
    expect(log.cuts).toBe(1);
    a.goTo(4);
    expect(delta(a.onScreen(), stateOf(4)).geometry).toBe(0);
    expect(log.cuts).toBe(2);
  });
});

describe("timing and color helpers", () => {
  it("splits a step into a move and a hold", () => {
    expect(segmentAt(0, 5, 0.7)).toEqual({ from: 0, to: 1, u: 0 });
    expect(segmentAt(1.35, 5, 0.7).u).toBeCloseTo(0.5, 10);
    expect(segmentAt(1.9, 5, 0.7)).toEqual({ from: 1, to: 2, u: 1 });
    expect(segmentAt(4, 5, 0.7)).toEqual({ from: 3, to: 4, u: 1 });
    expect(segmentAt(9, 5, 0.7)).toEqual({ from: 3, to: 4, u: 1 });
    expect(segmentAt(0, 1, 0.7)).toEqual({ from: 0, to: 0, u: 1 });
  });

  it("eases in and out, and staggers buildings without delaying the end", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(0.5)).toBe(0.5);
    expect(easeInOut(1)).toBe(1);
    expect(localProgress(0, MAX_DELAY)).toBe(0);
    expect(localProgress(MAX_DELAY, MAX_DELAY)).toBe(0);
    expect(localProgress(1, MAX_DELAY)).toBe(1);
    expect(localProgress(1, 0)).toBe(1);
    expect(localProgress(0.2, 0)).toBeGreaterThan(localProgress(0.2, 0.1));
  });

  it("cross-fades colors in a perceptual space", () => {
    const red: [number, number, number] = [1, 0, 0];
    const back = oklabToSrgb(srgbToOklab(red));
    for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(red[i] as number, 4);
    expect(mixOklab(red, [0, 0, 1], 0)).toEqual(red);
    expect(mixOklab(red, [0, 0, 1], 1)).toEqual([0, 0, 1]);
    const mid = mixOklab([0, 0, 0], [1, 1, 1], 0.5);
    // perceptual middle gray, lighter than half the linear light
    expect(mid[0]).toBeCloseTo(mid[1] as number, 4);
    expect(mid[0]).toBeGreaterThan(0.3);
    expect(mid[0]).toBeLessThan(0.5);
  });
});
