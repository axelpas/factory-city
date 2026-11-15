import { describe, expect, it } from "vitest";
import { edgeWidth, REST_BUDGET_MS, restRatio } from "../src/view/resolution";

describe("building edges", () => {
  it("are a hairline on a dense screen and one rendered pixel otherwise", () => {
    expect(edgeWidth(2)).toBeCloseTo(1.2, 10);
    expect(edgeWidth(1)).toBe(1);
    // a reduced render scale does not make the line thinner than one rendered pixel
    expect(edgeWidth(0.75)).toBe(1);
  });
});

describe("render scale at rest", () => {
  it("is the screen's own when motion already runs at full scale", () => {
    expect(restRatio(2, 8, 2)).toBe(2);
    expect(restRatio(1, 0, 2)).toBe(2);
  });

  it("comes back to full scale when a still picture fits the time budget", () => {
    // 80 ms per image at 0.8: a picture at scale 2 has 6.25 times the pixels, 500 ms
    expect(restRatio(0.8, 80, 2)).toBe(2);
  });

  it("stays under full scale on a very slow renderer, but never under the motion scale", () => {
    const rest = restRatio(0.75, 400, 2);
    expect(rest).toBeCloseTo(0.75 * Math.sqrt(REST_BUDGET_MS / 400), 10);
    expect(rest).toBeLessThan(2);
    expect(restRatio(0.75, 5000, 2)).toBe(0.75);
  });
});
