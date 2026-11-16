import { expect, it } from "vitest";
import { ResolutionGovernor } from "../src/scene/resolution-governor";

it("resolution governor > lowers the scale after three slow images in a row, never under 0.75", () => {
  const g = new ResolutionGovernor(2);
  expect(g.adapt(30, 2)).toBeUndefined();
  expect(g.adapt(30, 2)).toBeUndefined();
  expect(g.adapt(30, 2)).toBeCloseTo(1.6);
  for (let i = 0; i < 40; i++) g.adapt(40, 2);
  expect(g.ratio).toBeGreaterThanOrEqual(0.75);
});

it("resolution governor > a medium image resets the count of slow ones", () => {
  const g = new ResolutionGovernor(2);
  g.adapt(30, 2);
  g.adapt(30, 2);
  g.adapt(20, 2);
  expect(g.adapt(30, 2)).toBeUndefined();
});

it("resolution governor > raises the scale back after 90 fast images, never over the maximum", () => {
  const g = new ResolutionGovernor(1);
  let raised: number | undefined;
  for (let i = 0; i < 90; i++) raised = g.adapt(10, 2) ?? raised;
  expect(raised).toBeCloseTo(1.15);
  for (let i = 0; i < 2000; i++) g.adapt(10, 2);
  expect(g.ratio).toBeLessThanOrEqual(2);
});

it("resolution governor > keeps a smoothed time of one image", () => {
  const g = new ResolutionGovernor(1);
  g.adapt(20, 2);
  expect(g.ms).toBe(20);
  g.adapt(10, 2);
  expect(g.ms).toBeCloseTo(18);
});
