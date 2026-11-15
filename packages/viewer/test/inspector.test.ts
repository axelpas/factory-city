import { describe, expect, it } from "vitest";
import { clampInspectorWidth, INSPECTOR_MAX_WIDTH, INSPECTOR_MIN_WIDTH } from "../src/ui/inspector";

describe("inspector width", () => {
  it("keeps the width asked for inside sensible bounds", () => {
    expect(clampInspectorWidth(400, 1600)).toBe(400);
    expect(clampInspectorWidth(100, 1600)).toBe(INSPECTOR_MIN_WIDTH);
    expect(clampInspectorWidth(2000, 1600)).toBe(INSPECTOR_MAX_WIDTH);
  });

  it("never takes more than 60% of a small window, nor less than its minimum", () => {
    expect(clampInspectorWidth(600, 800)).toBe(480);
    expect(clampInspectorWidth(600, 300)).toBe(INSPECTOR_MIN_WIDTH);
  });
});
