import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { DATA_ELEMENT, readEmbedded } from "../src/data/embedded";
import {
  BASE_SECONDS_PER_FRAME,
  durationText,
  pixelHash,
  planVideo,
  secondsPerFrameAt,
  VIDEO_SPEEDS,
  videoSeconds,
} from "../src/export/video";

describe("video plan: a virtual clock", () => {
  const plan = planVideo(5, { fps: 30, secondsPerFrame: 1, orbit: false });

  it("has many images per frame of the timeline, plus a hold at the end", () => {
    // 4 steps of 1 s and 1 s of hold, at 30 images per second
    expect(plan.images).toBe(150);
    expect(plan.step).toBeCloseTo(1 / 30, 10);
  });

  it("gives each image its playhead position, whatever the machine's speed", () => {
    expect(plan.positionAt(0)).toBe(0);
    expect(plan.positionAt(15)).toBe(0.5);
    expect(plan.positionAt(30)).toBe(1);
    expect(plan.positionAt(45)).toBe(1.5);
    // the film holds on the last frame
    expect(plan.positionAt(120)).toBe(4);
    expect(plan.positionAt(149)).toBe(4);
  });

  it("moves the playhead by a small step from one image to the next: no jump", () => {
    for (let i = 1; i < plan.images; i++) {
      expect(plan.positionAt(i) - plan.positionAt(i - 1)).toBeLessThanOrEqual(1 / 30 + 1e-9);
      expect(plan.positionAt(i)).toBeGreaterThanOrEqual(plan.positionAt(i - 1));
    }
  });

  it("is the same plan every time", () => {
    const again = planVideo(5, { fps: 30, secondsPerFrame: 1, orbit: false });
    expect(Array.from({ length: plan.images }, (_, i) => plan.positionAt(i))).toEqual(
      Array.from({ length: again.images }, (_, i) => again.positionAt(i)),
    );
  });

  it("follows the images per second and the seconds per frame", () => {
    expect(planVideo(5, { fps: 60, secondsPerFrame: 1, orbit: false }).images).toBe(300);
    expect(planVideo(5, { fps: 30, secondsPerFrame: 2, orbit: false }).images).toBe(270);
    expect(planVideo(5, { fps: 60, secondsPerFrame: 1, orbit: false }).positionAt(30)).toBe(0.5);
  });

  it("keeps the camera still, or turns it slowly when asked", () => {
    expect(plan.angleAt(100)).toBe(0);
    const orbit = planVideo(5, { fps: 30, secondsPerFrame: 1, orbit: true });
    expect(orbit.angleAt(0)).toBe(0);
    // a full turn takes a minute: 5 seconds is a twelfth of a turn
    expect(orbit.angleAt(150)).toBeCloseTo(Math.PI / 6, 10);
  });

  it("makes a short still film of a single snapshot", () => {
    const one = planVideo(1, { fps: 30, secondsPerFrame: 1, orbit: false });
    expect(one.images).toBe(30);
    expect(one.positionAt(29)).toBe(0);
  });
});

describe("picture fingerprint", () => {
  it("is the same for the same pixels and differs for one changed pixel", () => {
    const a = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);
    const b = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 7, 255]);
    expect(pixelHash(a)).toBe(pixelHash(new Uint8ClampedArray(a)));
    expect(pixelHash(a)).not.toBe(pixelHash(b));
    expect(pixelHash(a)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("data embedded in a standalone file", () => {
  const doc = (text: string | undefined) =>
    ({
      getElementById: (id: string) =>
        id === DATA_ELEMENT && text !== undefined ? { textContent: text } : null,
    }) as unknown as Document;

  it("is read back from its compressed payload, with nothing fetched", async () => {
    const bundle = {
      manifest: { kind: "snapshot", project: "demo" },
      snapshots: [{ meta: { projectName: "demo" } }],
    };
    const payload = gzipSync(Buffer.from(JSON.stringify(bundle))).toString("base64");
    expect(await readEmbedded(doc(payload))).toEqual(bundle);
  });

  it("is absent from a page served by the local server", async () => {
    expect(await readEmbedded(doc(undefined))).toBeUndefined();
    expect(await readEmbedded(doc("  "))).toBeUndefined();
  });
});

describe("video speed", () => {
  it("runs through the frames faster at a higher speed", () => {
    expect(secondsPerFrameAt(1)).toBe(BASE_SECONDS_PER_FRAME);
    expect(secondsPerFrameAt(2)).toBeCloseTo(BASE_SECONDS_PER_FRAME / 2, 10);
    expect(secondsPerFrameAt(0.5)).toBeCloseTo(BASE_SECONDS_PER_FRAME * 2, 10);
    expect(VIDEO_SPEEDS).toContain(1);
  });

  it("tells how long the film lasts, with a hold on the last frame, and plans as many images", () => {
    // 11 frames: 10 steps at 1.4 s and a hold of 1 s
    expect(videoSeconds(11, 1.4)).toBeCloseTo(15, 10);
    expect(videoSeconds(1, 1.4)).toBe(1);
    expect(planVideo(11, { fps: 30, secondsPerFrame: 1.4, orbit: false }).images).toBe(450);
    // twice as fast: half the steps, the same hold
    expect(planVideo(11, { fps: 30, secondsPerFrame: secondsPerFrameAt(2), orbit: false }).images).toBe(
      Math.round(videoSeconds(11, secondsPerFrameAt(2)) * 30),
    );
  });

  it("writes a duration as people read it", () => {
    expect(durationText(38.4)).toBe("38 s");
    expect(durationText(125)).toBe("2 min 05 s");
    expect(durationText(60)).toBe("1 min 00 s");
  });
});
