import type { Frame } from "@factory-city/schema";
import { describe, expect, it } from "vitest";
import { frameAtShare, frameTitle } from "../src/view/transport";

const frame = (label: string, issue?: { number: number; title?: string }) =>
  ({ label, issue }) as unknown as Frame;

describe("frame title", () => {
  it("reads the issue number and title when known, else the label", () => {
    expect(frameTitle(frame("abc1234", { number: 12, title: "Export CSV" }))).toBe("#12 Export CSV");
    expect(frameTitle(frame("abc1234", { number: 12 }))).toBe("#12");
    expect(frameTitle(frame("abc1234"))).toBe("abc1234");
  });
});

describe("frame under the pointer", () => {
  it("maps a share of the track to the nearest frame, inside its bounds", () => {
    expect(frameAtShare(0, 5)).toBe(0);
    expect(frameAtShare(0.5, 5)).toBe(2);
    expect(frameAtShare(0.87, 5)).toBe(3);
    expect(frameAtShare(1.4, 5)).toBe(4);
    expect(frameAtShare(-1, 5)).toBe(0);
    expect(frameAtShare(0.5, 1)).toBe(0);
  });
});
