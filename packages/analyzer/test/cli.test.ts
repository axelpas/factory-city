import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateCcJson } from "@factory-city/schema";
import { describe, expect, it } from "vitest";
import { makeRepo, makeTree } from "./helpers.js";

const BIN = join(import.meta.dirname, "..", "dist", "cli", "main.js");

function run(args: string[], env: Record<string, string> = {}): string {
  return execFileSync("node", [BIN, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
}

describe("factory-city CLI", () => {
  it("lists metrics and languages", () => {
    expect(run(["metrics"])).toContain("rloc");
    expect(JSON.parse(run(["metrics", "--json"])).length).toBeGreaterThan(5);
    expect(run(["languages"])).toContain("TypeScript");
  });

  it("prints one summary line and writes a valid snapshot", () => {
    const dir = makeRepo({ "src/a.ts": "export const a = 1;\n", "README.md": "hi\n" });
    const out = makeTree({});
    const text = run(["analyze", dir, "-o", out]);
    expect(text).toContain("Analyzed 1 file.");
    expect(text).toContain("Left out: 1 not source code");
    const snapshot = JSON.parse(readFileSync(join(out, "snapshot.cc.json"), "utf8"));
    expect(validateCcJson(snapshot).valid).toBe(true);
    expect(existsSync(join(out, "analysis.json"))).toBe(true);
  });

  it("writes to ~/.factory-city/<slug> and updates the index by default", () => {
    const dir = makeRepo({ "a.ts": "export const a = 1;\n" });
    const home = makeTree({});
    const result = JSON.parse(run(["analyze", dir, "--json"], { FACTORY_CITY_HOME: home }));
    expect(result.dataDir.startsWith(home)).toBe(true);
    const index = JSON.parse(readFileSync(join(home, "index.json"), "utf8"));
    expect(index.projects).toHaveLength(1);
    expect(index.projects[0].dataDir).toBe(result.dataDir);
  });

  it("fails with an actionable message when --rev is used outside git", () => {
    const dir = makeTree({ "a.ts": "export const a = 1;\n" });
    let message = "";
    try {
      run(["analyze", dir, "--rev", "main", "-o", makeTree({})]);
    } catch (err) {
      message = String((err as { stderr?: string }).stderr);
    }
    expect(message).toContain("needs a git repository");
  });
});
