import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSize, probeImages, renderImage } from "../src/render.js";
import { canRender, sample } from "./export-helpers.js";
import { makeTree } from "./helpers.js";

describe.skipIf(!canRender)("headless rendering in a real browser", () => {
  const entry = (dataDir: string) => ({
    slug: "demo-render",
    name: "demo",
    dataDir,
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const size = { width: 320, height: 200 };

  it("gives the same images for two renders of the same data, and in-between images within a step", async () => {
    const out = await sample();
    // start of the first step, two points inside its move, its hold, and the next frame
    const positions = [0, 0.2, 0.45, 0.7, 1, 1.4];
    const first = await probeImages({ entry: entry(out), source: "issue", ...size }, positions);
    const second = await probeImages({ entry: entry(out), source: "issue", ...size }, positions);
    expect(first).toHaveLength(positions.length);
    expect(second).toEqual(first);
    // the film is not one image per frame: the move shows pictures that are neither frame
    expect(new Set([first[0], first[1], first[2], first[4]]).size).toBe(4);
    // and the hold shows exactly the frame it settles on
    expect(first[3]).toBe(first[4]);
  }, 180_000);

  it("writes a PNG of the requested size", async () => {
    const out = await sample();
    const file = join(makeTree({}), "city.png");
    await renderImage({ entry: entry(out), source: "issue", width: 400, height: 240, out: file });
    const png = readFileSync(file);
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(400);
    expect(png.readUInt32BE(20)).toBe(240);
  }, 120_000);
});

describe("picture size", () => {
  it("is parsed from WIDTHxHEIGHT", () => {
    expect(parseSize("640x360")).toEqual([640, 360]);
  });
});
