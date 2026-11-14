import { describe, expect, it } from "vitest";
import { statsOf } from "../src/data/model";
import { parseHex, rampColor, toCss } from "../src/view/color";
import { makeScale } from "../src/view/scales";

describe("scales", () => {
  const stats = statsOf([0, 1, 4, 9, 100]);

  it("maps min to 0 and max to 1 for every kind", () => {
    for (const kind of ["linear", "sqrt", "log"] as const) {
      const f = makeScale(stats, kind, false);
      expect(f(0)).toBe(0);
      expect(f(100)).toBeCloseTo(1, 10);
    }
  });

  it("lifts small values with sqrt and log", () => {
    const lin = makeScale(stats, "linear", false)(9);
    expect(makeScale(stats, "sqrt", false)(9)).toBeGreaterThan(lin);
    expect(makeScale(stats, "log", false)(9)).toBeGreaterThan(lin);
  });

  it("clamps outliers at the 99th percentile", () => {
    const f = makeScale(stats, "linear", true);
    expect(f(100)).toBe(1);
    expect(f(stats.p99)).toBe(1);
  });

  it("returns the middle when every value is equal", () => {
    expect(makeScale(statsOf([3, 3, 3]), "linear", false)(3)).toBe(0.5);
  });
});

describe("colors", () => {
  it("parses hex tokens and rejects bad ones", () => {
    expect(parseHex("#ffffff")).toEqual([1, 1, 1]);
    expect(parseHex("#000")).toEqual([0, 0, 0]);
    expect(() => parseHex("white")).toThrow(/Invalid color token/);
  });

  it("interpolates between ramp stops and clamps", () => {
    const stops = [parseHex("#000000"), parseHex("#ffffff")];
    expect(rampColor(stops, 0.5)).toEqual([0.5, 0.5, 0.5]);
    expect(rampColor(stops, -1)).toEqual([0, 0, 0]);
    expect(rampColor(stops, 2)).toEqual([1, 1, 1]);
    expect(toCss([1, 0, 0])).toBe("rgb(255 0 0)");
  });
});
