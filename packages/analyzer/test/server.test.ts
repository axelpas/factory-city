import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type RunningServer, startServer } from "../src/server.js";
import { makeTree } from "./helpers.js";

let running: RunningServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
  Reflect.deleteProperty(process.env, "FACTORY_CITY_HOME");
});

function fixture() {
  const home = makeTree({});
  process.env.FACTORY_CITY_HOME = home;
  const viewer = makeTree({
    "index.html": "<!doctype html><title>v</title>",
    "assets/app.js": "console.log(1)",
  });
  const dataDir = makeTree({
    "analysis.json": '{"kind":"snapshot"}',
    "snapshot.cc.json": "{}",
    "secret.txt": "nope",
    "frames.commit/0001-abc.cc.json": '{"frame":1}',
    "cache/files.json": "{}",
  });
  mkdirSync(join(home, "x"), { recursive: true });
  return { home, viewer, dataDir };
}

const entry = (dataDir: string) => ({
  slug: "demo-abc123",
  name: "demo",
  dataDir,
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("local server", () => {
  it("serves the viewer, the project list and the data", async () => {
    const { viewer, dataDir } = fixture();
    running = await startServer({
      viewerDir: viewer,
      current: "demo-abc123",
      extra: [entry(dataDir)],
      port: 0,
    });
    expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);

    const page = await fetch(running.url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<title>v</title>");
    expect(await (await fetch(`${running.url}assets/app.js`)).text()).toBe("console.log(1)");

    const projects = await (await fetch(`${running.url}projects.json`)).json();
    expect(projects).toEqual({ current: "demo-abc123", projects: [{ slug: "demo-abc123", name: "demo" }] });
    expect(await (await fetch(`${running.url}data/demo-abc123/analysis.json`)).json()).toEqual({
      kind: "snapshot",
    });
  });

  it("serves the frames of a timeline", async () => {
    const { viewer, dataDir } = fixture();
    running = await startServer({ viewerDir: viewer, extra: [entry(dataDir)], port: 0 });
    const res = await fetch(`${running.url}data/demo-abc123/frames.commit/0001-abc.cc.json`);
    expect(await res.json()).toEqual({ frame: 1 });
  });

  it("refuses path traversal and unknown projects", async () => {
    const { viewer, dataDir } = fixture();
    running = await startServer({ viewerDir: viewer, extra: [entry(dataDir)], port: 0 });
    for (const path of [
      "../etc/passwd",
      "%2e%2e/%2e%2e/etc/passwd",
      "data/other/analysis.json",
      "data/demo-abc123/..%2fsecret.txt",
      "data/demo-abc123/.hidden",
      "data/demo-abc123/frames.commit/..%2f..%2fsecret.txt",
      "data/demo-abc123/cache/files.json",
    ]) {
      const res = await fetch(`${running.url}${path}`);
      expect(res.status, path).toBeGreaterThanOrEqual(400);
    }
    expect((await fetch(running.url, { method: "POST" })).status).toBe(405);
  });

  it("explains when the viewer is not built", async () => {
    await expect(startServer({ viewerDir: makeTree({}), port: 0 })).rejects.toThrow(/viewer is not built/);
  });

  it("falls back to another port when the default one is taken", async () => {
    const { viewer } = fixture();
    const first = await startServer({ viewerDir: viewer });
    try {
      running = await startServer({ viewerDir: viewer });
      expect(running.port).not.toBe(first.port);
    } finally {
      await first.close();
    }
  });
});
