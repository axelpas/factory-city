import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateCcJson } from "@factory-city/schema";
import { expect, it } from "vitest";
import { makeRepo, makeTree } from "./helpers.js";

const BIN = join(import.meta.dirname, "..", "dist", "cli", "main.js");

function run(args: string[], env: Record<string, string> = {}): string {
  return execFileSync("node", [BIN, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
}

it("factory-city CLI > lists metrics and languages", () => {
  expect(run(["metrics"])).toContain("rloc");
  expect(JSON.parse(run(["metrics", "--json"])).length).toBeGreaterThan(5);
  expect(run(["languages"])).toContain("TypeScript");
});

it("factory-city CLI > prints one summary line and writes a valid snapshot", () => {
  const dir = makeRepo({ "src/a.ts": "export const a = 1;\n", "README.md": "hi\n" });
  const out = makeTree({});
  const text = run(["analyze", dir, "-o", out]);
  expect(text).toContain("Analyzed 1 file.");
  expect(text).toContain("Left out: 1 not source code");
  const snapshot = JSON.parse(readFileSync(join(out, "snapshot.cc.json"), "utf8"));
  expect(validateCcJson(snapshot).valid).toBe(true);
  expect(existsSync(join(out, "analysis.json"))).toBe(true);
});

it("factory-city CLI > writes to ~/.factory-city/<slug> and updates the index by default", () => {
  const dir = makeRepo({ "a.ts": "export const a = 1;\n" });
  const home = makeTree({});
  const result = JSON.parse(run(["analyze", dir, "--json"], { FACTORY_CITY_HOME: home }));
  expect(result.dataDir.startsWith(home)).toBe(true);
  const index = JSON.parse(readFileSync(join(home, "index.json"), "utf8"));
  expect(index.projects).toHaveLength(1);
  expect(index.projects[0].dataDir).toBe(result.dataDir);
});

it("factory-city CLI > fails with an actionable message when --rev is used outside git", () => {
  const dir = makeTree({ "a.ts": "export const a = 1;\n" });
  let message = "";
  try {
    run(["analyze", dir, "--rev", "main", "-o", makeTree({})]);
  } catch (err) {
    message = String((err as { stderr?: string }).stderr);
  }
  expect(message).toContain("needs a git repository");
});

it("factory-city CLI > lists the three tiers of languages", () => {
  const text = run(["languages"]);
  expect(text).toMatch(/TypeScript\s+tier 1/);
  expect(text).toMatch(/Python\s+tier 2/);
  expect(text).toMatch(/Swift\s+tier 2/);
  expect(text).toContain("tier 3  any other text file, with --all");
  const listed = JSON.parse(run(["languages", "--json"])) as Array<{ id: string; tier: number }>;
  expect(listed.filter((l) => l.tier === 2).length).toBeGreaterThanOrEqual(11);
});

it("factory-city CLI > analyzes a small Python project", () => {
  const dir = makeTree({ "app/main.py": "def main():\n    if True:\n        return 1\n" });
  const out = makeTree({});
  expect(run(["analyze", dir, "-o", out])).toContain("Analyzed 1 file.");
  const manifest = JSON.parse(readFileSync(join(out, "analysis.json"), "utf8"));
  expect(manifest.metrics).toContain("mcc");
});

it("factory-city CLI > adds duplication with --with duplication, and refuses an unknown collector", () => {
  const dir = makeTree({ "a.ts": "export const a = 1;\n" });
  const out = makeTree({});
  run(["analyze", dir, "--with", "duplication", "-o", out]);
  const manifest = JSON.parse(readFileSync(join(out, "analysis.json"), "utf8"));
  expect(manifest.metrics).toContain("duplication_ratio");
  let message = "";
  try {
    run(["analyze", dir, "--with", "magic", "-o", makeTree({})]);
  } catch (err) {
    message = String((err as { stderr?: string }).stderr);
  }
  expect(message).toContain('Unknown --with value "magic". Available: duplication.');
});
