import { describe, expect, it } from "vitest";
import { segmentAt } from "../src/anim/animator";
import { mixOklab, oklabToSrgb, srgbToOklab } from "../src/anim/oklab";
import { easeInOut, localProgress, MAX_DELAY } from "../src/anim/transition";

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
