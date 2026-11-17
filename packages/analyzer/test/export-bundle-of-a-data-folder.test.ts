import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { TimelineManifest } from "@factory-city/schema";
import { validateCcJson } from "@factory-city/schema";
import { describe, expect, it } from "vitest";
import { type Bundle, listSources, loadBundle, writeBundle } from "../src/bundle.js";
import { redactBundle } from "../src/redact.js";
import { defaultViewerDir } from "../src/server.js";
import {
  buildStandalone,
  DATA_ELEMENT,
  formatBytes,
  WARN_BYTES,
  writeStandalone,
} from "../src/standalone.js";
import { sample } from "./export-helpers.js";
import { makeTree } from "./helpers.js";

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

  it("drops the dependency audit: package names are project data", async () => {
    const bundle = await loadBundle(await sample());
    const audit = {
      kind: "dependencies",
      schemaVersion: 1,
      analyzerVersion: "t",
      checkedAt: "2026-11-17T00:00:00.000Z",
      lockfile: "pnpm-lock.yaml",
      ecosystem: "npm",
      database: "osv.dev",
      packages: 1,
      counts: { critical: 0, high: 1, moderate: 0, low: 0, unknown: 0 },
      affected: [
        { name: "secret-internal-pkg", version: "1.0.0", advisories: [{ id: "GHSA-x", severity: "high" }] },
      ],
    } as const;
    const text = JSON.stringify(redactBundle({ ...bundle, dependencies: audit }));
    expect(text).not.toContain("secret-internal-pkg");
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
