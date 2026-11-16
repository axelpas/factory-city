import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CcJson } from "@factory-city/schema";
import { afterEach, expect, it } from "vitest";
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

it("analyzing one module of a repository > reads the diffs of that module only", async () => {
  const dir = twoModules();
  const log = spyOnGit();
  await buildTimeline({ folder: dir, by: "commit", path: "app" }, makeTree({}));
  const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
  // the passes that read file contents through diffs: the numstat log and the provenance replay
  const diffs = calls.filter((c) => /\blog\b/.test(c) && (/--numstat/.test(c) || /\s-p\s/.test(` ${c} `)));
  expect(diffs.length).toBeGreaterThan(0);
  for (const call of diffs) expect(call, call).toMatch(/ -- app\/?$/);
});

it("analyzing one module of a repository > makes frames of the commits that changed the module, and only those", async () => {
  const dir = twoModules();
  const scoped = await buildTimeline({ folder: dir, by: "commit", path: "app" }, makeTree({}));
  const full = await buildTimeline({ folder: dir, by: "commit" }, makeTree({}));
  // four commits in all, two of them (the ones that touch only lib) are not frames of app
  expect(full.manifest.frames).toHaveLength(4);
  expect(scoped.manifest.frames.map((f) => f.subject)).toEqual(["feat: start (#1)", "fix: change app (#3)"]);
  const byIssue = await buildTimeline({ folder: dir, by: "issue", offline: true, path: "app" }, makeTree({}));
  expect(byIssue.manifest.frames.map((f) => f.issue?.number)).toEqual([1, 3]);
  expect(byIssue.manifest.coverage?.commits).toBe(2);
});

it("analyzing one module of a repository > gives the module's files the same history as a whole-repository run, on the frames they share", async () => {
  const dir = twoModules();
  const whole = makeTree({});
  const full = await buildTimeline({ folder: dir, by: "commit" }, whole);
  const scoped = makeTree({});
  const part = await buildTimeline({ folder: dir, by: "commit", path: "app" }, scoped);
  expect(part.manifest.warnings.filter((w) => /first-parent/.test(w))).toEqual([]);
  const metricsOf = (out: string, frame: number, manifest: typeof full.manifest, name: string) => {
    const map = attrsOf(
      JSON.parse(readFileSync(join(out, manifest.frames[frame]?.snapshot as string), "utf8")) as CcJson,
    );
    return map.get(name) ?? map.get(`app/${name}`);
  };
  // every frame of the scoped run is a frame of the whole run: same commit, same history for the module
  expect(part.manifest.frames.length).toBeGreaterThan(0);
  for (const [j, frame] of part.manifest.frames.entries()) {
    const i = full.manifest.frames.findIndex((f) => f.commit === frame.commit);
    expect(i, `frame ${j}`).toBeGreaterThanOrEqual(0);
    const a = metricsOf(whole, i, full.manifest, "app/a.ts");
    const b = metricsOf(scoped, j, part.manifest, "a.ts");
    for (const key of ["commits", "rework_lines", "recent_commits", "fix_commits", "authors"])
      expect(b?.[key], `frame ${j} ${key}`).toEqual(a?.[key]);
  }
});
