import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { TimelineManifest } from "@factory-city/schema";
import { validateCcJson } from "@factory-city/schema";
import { describe, expect, it } from "vitest";
import { type Bundle, listSources, loadBundle, writeBundle } from "../src/bundle.js";
import { redactBundle } from "../src/redact.js";
import { parseSize, probeImages, renderImage } from "../src/render.js";
import { defaultViewerDir } from "../src/server.js";
import {
  buildStandalone,
  DATA_ELEMENT,
  formatBytes,
  WARN_BYTES,
  writeStandalone,
} from "../src/standalone.js";
import { buildTimeline } from "../src/timeline.js";
import { commitAt, initRepo, makeTree } from "./helpers.js";

const TRAILER = "\n\nCo-Authored-By: Agent One <one@example.com>";
const code = (n: number) =>
  `${Array.from({ length: n }, (_, i) => `export function f${i}(x: number) { return x + ${i}; }`).join("\n")}\n`;

/** A per-issue timeline of three frames, with a facts file: everything `--redact` has something to remove from. */
async function sample() {
  const dir = initRepo({
    "src/a.ts": code(3),
    "factory-city.config.json":
      '{ "facts": { "columns": { "issue": "issue", "agent": "agent", "cost": "cost" } } }',
  });
  commitAt(dir, "2026-01-01T10:00:00Z", `feat: secret launch plan (#1)${TRAILER}`);
  writeFileSync(join(dir, "src/b.ts"), code(6));
  commitAt(dir, "2026-01-02T10:00:00Z", `feat: add the billing module (#2)${TRAILER}`);
  writeFileSync(join(dir, "src/a.ts"), code(9));
  commitAt(dir, "2026-01-03T10:00:00Z", "fix: repair the invoice total (#3)");
  const facts = join(
    makeTree({ "facts.csv": "issue,agent,cost\n1,agent-zed,4\n2,agent-zed,6\n3,agent-why,1" }),
    "facts.csv",
  );
  const out = makeTree({});
  await buildTimeline({ folder: dir, by: "issue", offline: true, facts }, out);
  return out;
}

describe("bundle of a data folder", () => {
  it("lists the sources and loads the most recently written one, or the one asked for", async () => {
    const out = await sample();
    expect((await listSources(out)).map((s) => s.source)).toEqual(["issue"]);
    const bundle = await loadBundle(out);
    expect(bundle.source).toBe("issue");
    expect(bundle.snapshots).toHaveLength(3);
    expect(bundle.report?.kind).toBe("report");
    expect(bundle.factory?.kind).toBe("factory");
    await expect(loadBundle(out, "day")).rejects.toThrow(/No "day" data .* Available: issue/);
    await expect(loadBundle(makeTree({}))).rejects.toThrow(/No analysis found/);
  });

  it("writes a bundle back as a data folder", async () => {
    const bundle = await loadBundle(await sample());
    const copy = await writeBundle(bundle, bundle.source);
    const again = await loadBundle(copy);
    expect(JSON.stringify(again.manifest)).toBe(JSON.stringify(bundle.manifest));
    expect(again.snapshots).toHaveLength(3);
  });
});

describe("redaction", () => {
  it("removes commit subjects, issue titles, author and agent labels, facts and cost", async () => {
    const bundle = await loadBundle(await sample());
    const before = JSON.stringify(bundle);
    for (const secret of ["secret launch plan", "billing module", "agent-zed", "Agent One", "cost_share"])
      expect(before, secret).toContain(secret);
    const text = JSON.stringify(redactBundle(bundle));
    for (const secret of [
      "secret launch plan",
      "billing module",
      "invoice total",
      "agent-zed",
      "agent-why",
      "Agent One",
      "cost_share",
      "main_agent",
      '"cost"',
    ]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("keeps the city: paths, code metrics, dates, issue numbers and the score", async () => {
    const bundle = await loadBundle(await sample());
    const redacted = redactBundle(bundle);
    const manifest = redacted.manifest as TimelineManifest;
    expect(manifest.frames.map((f) => f.label)).toEqual(["#1", "#2", "#3"]);
    expect(manifest.frames.map((f) => f.issue?.number)).toEqual([1, 2, 3]);
    expect(manifest.frames[1]?.date).toBe((bundle.manifest as TimelineManifest).frames[1]?.date);
    expect(manifest.frames[1]?.health?.score).toBe(
      (bundle.manifest as TimelineManifest).frames[1]?.health?.score,
    );
    expect(manifest.frames[1]?.added).toEqual(["src/b.ts"]);
    expect(manifest.dataLevel).toBe(2);
    expect(redacted.factory).toBeUndefined();
    const values = Object.values(redacted.snapshots[2]?.lenses.metrics.attributes ?? {});
    expect(values.some((v) => v.rloc !== undefined && v.mcc !== undefined)).toBe(true);
  });

  it("leaves valid cc.json snapshots", async () => {
    const redacted = redactBundle(await loadBundle(await sample()));
    for (const snapshot of redacted.snapshots)
      expect(validateCcJson(snapshot)).toEqual({ valid: true, errors: [] });
  });

  it("drops the declaration names of the report", () => {
    const bundle = {
      manifest: { kind: "snapshot", categories: {}, metrics: [] },
      snapshots: [],
      report: {
        hotspots: [
          {
            path: "a.ts",
            actions: [
              {
                type: "split-file",
                text: "Split the file along its 2 groups: (parseSecretThing) (renderOther).",
              },
              { type: "flatten-nesting", text: "Flatten nesting (deepest level 7)." },
            ],
          },
        ],
      },
    } as unknown as Bundle;
    const text = JSON.stringify(redactBundle(bundle).report);
    expect(text).not.toContain("parseSecretThing");
    expect(text).toContain("Split the file along its cohesion groups.");
    expect(text).toContain("Flatten nesting (deepest level 7).");
  });
});

describe("standalone HTML", () => {
  const viewer = () =>
    makeTree({
      "index.html":
        '<!doctype html><html><head><title>Factory City</title><link rel="modulepreload" href="./assets/x.js"><script type="module" crossorigin src="./assets/app.js"></script><link rel="stylesheet" crossorigin href="./assets/app.css"></head><body><div id="app"></div></body></html>',
      "assets/app.js": 'const tag = "</script><script>alert(1)"; console.log(tag, "$&");',
      "assets/app.css": "body { color: red; }",
    });

  it("is one self-contained file: code and style inlined, data embedded, nothing to fetch", async () => {
    const bundle = await loadBundle(await sample());
    const html = await buildStandalone(viewer(), bundle, "demo");
    expect(html).not.toMatch(/\ssrc="/);
    expect(html).not.toMatch(/rel="stylesheet"/);
    expect(html).not.toMatch(/modulepreload/);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain("<style>body { color: red; }</style>");
    expect(html).toContain("<title>demo · Factory City</title>");
    // the inlined code cannot close its own script element, and `$&` is kept as written
    expect(html).toContain('const tag = "<\\/script><script>alert(1)"; console.log(tag, "$&");');
    expect(html.match(/<\/script>/g)).toHaveLength(2);
  });

  it("embeds the data compressed, and it reads back whole", async () => {
    const bundle = await loadBundle(await sample());
    const html = await buildStandalone(viewer(), bundle, "demo");
    const payload = new RegExp(
      `<script id="${DATA_ELEMENT}" type="application/octet-stream">([^<]+)</script>`,
    ).exec(html)?.[1] as string;
    const data = JSON.parse(gunzipSync(Buffer.from(payload, "base64")).toString("utf8")) as Bundle;
    expect(data.snapshots).toHaveLength(3);
    expect((data.manifest as TimelineManifest).frames[0]?.subject).toContain("secret launch plan");
    // the plain text is nowhere in the file: only the compressed payload holds it
    expect(html).not.toContain("secret launch plan");
  });

  it("reports the size and warns above 15 MB", async () => {
    const path = join(makeTree({}), "out.html");
    expect(await writeStandalone(path, "<html></html>")).toEqual({ bytes: 13, large: false });
    expect(statSync(path).size).toBe(13);
    expect((await writeStandalone(path, "x".repeat(WARN_BYTES + 1))).large).toBe(true);
    expect(formatBytes(2048)).toBe("2 kB");
    expect(formatBytes(16 * 1024 * 1024)).toBe("16.0 MB");
  });

  it("explains when the viewer is not built", async () => {
    const bundle = await loadBundle(await sample());
    await expect(buildStandalone(makeTree({ "index.html": "<html></html>" }), bundle, "x")).rejects.toThrow(
      /Run `pnpm build` first/,
    );
  });
});

describe("render command", () => {
  const BIN = join(import.meta.dirname, "..", "dist", "cli", "main.js");
  const run = (args: string[]) =>
    execFileSync("node", [BIN, ...args], {
      encoding: "utf8",
      env: { ...process.env, FACTORY_CITY_HOME: makeTree({}) },
    });
  const built = existsSync(join(defaultViewerDir(), "index.html"));

  it("asks what to write", async () => {
    const out = await sample();
    expect(() => run(["render", out])).toThrow(/--image out\.png, --video out\.mp4 or --html out\.html/);
  });

  it.skipIf(!built)("writes a standalone file, redacted on demand, and prints its size", async () => {
    const out = await sample();
    const dir = makeTree({});
    const text = run(["render", out, "--html", join(dir, "city.html")]);
    expect(text).toMatch(/Standalone file written to .*city\.html \(\d+ kB\)/);
    const read = (file: string) => {
      const payload = new RegExp(`<script id="${DATA_ELEMENT}"[^>]*>([^<]+)</script>`).exec(
        readFileSync(join(dir, file), "utf8"),
      )?.[1] as string;
      return gunzipSync(Buffer.from(payload, "base64")).toString("utf8");
    };
    expect(read("city.html")).toContain("secret launch plan");
    const json = JSON.parse(
      run(["render", out, "--html", join(dir, "redacted.html"), "--redact", "--json"]),
    ) as { redacted: boolean; written: Array<{ kind: string; bytes: number }> };
    expect(json.redacted).toBe(true);
    expect(json.written[0]?.kind).toBe("html");
    expect(read("redacted.html")).not.toContain("secret launch plan");
    expect(read("redacted.html")).not.toContain("agent-zed");
  });
});

/** Google Chrome, when installed: the tests below drive a real browser and are skipped without one. */
const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/opt/google/chrome/chrome",
].some((p) => existsSync(p));
const canRender = CHROME && existsSync(join(defaultViewerDir(), "index.html"));

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
