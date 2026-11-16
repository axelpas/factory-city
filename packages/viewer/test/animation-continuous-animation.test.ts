import { describe, expect, it } from "vitest";
import { H, STRIDE, W } from "../src/anim/transition";
import { animator, delta, span } from "./animation-helpers";
import { FRAMES, MAPPING } from "./timeline-helpers";

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
