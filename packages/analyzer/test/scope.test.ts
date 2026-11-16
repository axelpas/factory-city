import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CcJson } from "@factory-city/schema";
import { afterEach, describe, expect, it } from "vitest";
import { buildTimeline } from "../src/timeline.js";
import { commitAt, initRepo, makeTree } from "./helpers.js";

const lines = (...l: string[]) => `${l.join("\n")}\n`;

/** Two modules, `app` and `lib`; some commits touch only `lib`. */
function twoModules(): string {
  const dir = initRepo({
    "app/a.ts": lines("export const a1 = 1;", "export const a2 = 2;", "export const a3 = 3;"),
    "lib/b.ts": lines("export const b1 = 1;", "export const b2 = 2;"),
  });
  commitAt(dir, "2026-01-01T10:00:00Z", "feat: start (#1)");
  writeFileSync(join(dir, "lib/b.ts"), lines("export const b1 = 10;", "export const b2 = 2;"));
  commitAt(dir, "2026-01-02T10:00:00Z", "feat: touch lib only (#2)");
  writeFileSync(
    join(dir, "app/a.ts"),
    lines("export const a1 = 1;", "export const a2 = 20;", "export const a3 = 3;"),
  );
  commitAt(dir, "2026-01-03T10:00:00Z", "fix: change app (#3)");
  writeFileSync(join(dir, "lib/b.ts"), lines("export const b1 = 11;", "export const b2 = 2;"));
  commitAt(dir, "2026-01-04T10:00:00Z", "feat: touch lib again (#4)");
  return dir;
}

function attrsOf(cc: CcJson): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  const walk = (nodes: CcJson["files"], prefix: string) => {
    for (const n of nodes) {
      const p = prefix ? `${prefix}/${n.name}` : n.name;
      if (n.type === "File") out.set(p.replace(/^root\//, ""), cc.lenses.metrics.attributes[n.id] ?? {});
      else walk(n.children ?? [], p);
    }
  };
  walk(cc.files, "");
  return out;
}

const original = process.env.PATH;
afterEach(() => {
  process.env.PATH = original;
});

/** Puts a `git` in front of the real one that writes each call to a log. */
function spyOnGit(): string {
  const real = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const bin = mkdtempSync(join(tmpdir(), "fc-git-"));
  const log = join(bin, "calls.log");
  writeFileSync(log, "");
  writeFileSync(join(bin, "git"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nexec "${real}" "$@"\n`);
  chmodSync(join(bin, "git"), 0o755);
  process.env.PATH = `${bin}:${original}`;
  return log;
}

describe("analyzing one module of a repository", () => {
  it("reads the diffs of that module only", async () => {
    const dir = twoModules();
    const log = spyOnGit();
    await buildTimeline({ folder: dir, by: "commit", path: "app" }, makeTree({}));
    const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
    // the passes that read file contents through diffs: the numstat log and the provenance replay
    const diffs = calls.filter((c) => /\blog\b/.test(c) && (/--numstat/.test(c) || /\s-p\s/.test(` ${c} `)));
    expect(diffs.length).toBeGreaterThan(0);
    for (const call of diffs) expect(call, call).toMatch(/ -- app\/?$/);
  });

  it("keeps every frame and gives the module's files the same history as a whole-repository run", async () => {
    const dir = twoModules();
    const whole = makeTree({});
    const full = await buildTimeline({ folder: dir, by: "commit" }, whole);
    const scoped = makeTree({});
    const part = await buildTimeline({ folder: dir, by: "commit", path: "app" }, scoped);
    expect(part.manifest.frames.map((f) => f.commit)).toEqual(full.manifest.frames.map((f) => f.commit));
    expect(part.manifest.warnings.filter((w) => /first-parent/.test(w))).toEqual([]);
    const metricsOf = (out: string, frame: number, manifest: typeof full.manifest, name: string) => {
      const map = attrsOf(
        JSON.parse(readFileSync(join(out, manifest.frames[frame]?.snapshot as string), "utf8")) as CcJson,
      );
      return map.get(name) ?? map.get(`app/${name}`);
    };
    for (let i = 0; i < full.manifest.frames.length; i++) {
      const a = metricsOf(whole, i, full.manifest, "app/a.ts");
      const b = metricsOf(scoped, i, part.manifest, "a.ts");
      for (const key of ["commits", "rework_lines", "recent_commits", "fix_commits", "authors"])
        expect(b?.[key], `frame ${i} ${key}`).toEqual(a?.[key]);
    }
  });
});
