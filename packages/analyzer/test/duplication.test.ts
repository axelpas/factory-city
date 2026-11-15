import { describe, expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { detectDuplication } from "../src/collectors/duplication.js";
import { makeRepo, makeTree } from "./helpers.js";

const block = (name: string) =>
  Array.from({ length: 12 }, (_, i) => `  const v${i} = compute(${i}, input.${name}) + offset * ${i};`).join(
    "\n",
  );
// a.ts and b.ts share the 12 lines of the block and the lines around it; b.ts starts one line lower
const A = `export function alpha(input: Input, offset: number) {\n${block("x")}\n  return v0;\n}\n`;
const B = `// other\nexport function beta(input: Input, offset: number) {\n${block("x")}\n  return v0;\n}\nexport const z = 1;\n`;
const C = "export const unrelated = [1, 2, 3].map((x) => x * 2);\n";

function valuesOf(result: Awaited<ReturnType<typeof analyze>>, path: string): Record<string, number> {
  const file = result.files.find((f) => f.path === path);
  if (!file) throw new Error(`${path} was not analyzed`);
  return file.values;
}

describe("duplication detection", () => {
  it("finds a block copied between two files and names the other file", async () => {
    const found = await detectDuplication([
      { path: "src/b.ts", text: B },
      { path: "src/a.ts", text: A },
      { path: "src/c.ts", text: C },
    ]);
    expect(found.get("src/a.ts")).toEqual({ lines: 15, partner: "src/b.ts" });
    expect(found.get("src/b.ts")).toEqual({ lines: 15, partner: "src/a.ts" });
    expect(found.get("src/c.ts")).toEqual({ lines: 0 });
  });

  it("gives the same result whatever the order of the files", async () => {
    const files = [
      { path: "src/a.ts", text: A },
      { path: "src/b.ts", text: B },
      { path: "src/c.ts", text: C },
    ];
    const one = await detectDuplication(files);
    const two = await detectDuplication([...files].reverse());
    expect([...one].sort()).toEqual([...two].sort());
  });

  it("leaves a file in an unknown format without a value", async () => {
    const found = await detectDuplication([{ path: "notes.unknownformat", text: `${A}${A}` }]);
    expect(found.has("notes.unknownformat")).toBe(false);
  });

  it("does not compare files of different languages", async () => {
    const found = await detectDuplication([
      { path: "a.ts", text: A },
      { path: "a.py", text: A },
    ]);
    expect(found.get("a.ts")?.lines).toBe(0);
    expect(found.get("a.py")?.lines).toBe(0);
  });
});

describe("analysis with duplication", () => {
  const files = { "src/a.ts": A, "src/b.ts": B, "src/c.ts": C };

  it("adds the duplication metrics only when asked", async () => {
    const dir = makeTree(files);
    const plain = await analyze({ folder: dir });
    expect(plain.manifest.metrics).not.toContain("duplicated_lines");
    expect(plain.manifest.metrics).not.toContain("duplication_ratio");
    expect(valuesOf(plain, "src/a.ts").duplication_ratio).toBeUndefined();
    // the dimension is unrated, not rated "low", and stays out of the score
    expect(plain.report.health.profile.duplication).toBeUndefined();
    expect(plain.report.health.scored).not.toContain("duplication");

    const result = await analyze({ folder: dir, duplication: true });
    expect(result.manifest.metrics).toContain("duplicated_lines");
    expect(result.manifest.metrics).toContain("duplication_ratio");
    const a = valuesOf(result, "src/a.ts");
    expect(a.duplicated_lines).toBe(15);
    expect(a.duplication_ratio).toBeCloseTo(15 / (a.loc as number), 10);
    expect(valuesOf(result, "src/c.ts").duplicated_lines).toBe(0);
    expect(valuesOf(result, "src/c.ts").duplication_ratio).toBe(0);
    expect(result.report.health.profile.duplication).toBeDefined();
    expect(result.report.health.scored).toContain("duplication");
  });

  it("works on a git revision without touching the repository", async () => {
    const dir = makeRepo(files);
    const result = await analyze({ folder: dir, rev: "HEAD", duplication: true });
    expect(valuesOf(result, "src/b.ts").duplicated_lines).toBe(15);
  });

  it("suggests the file to deduplicate with", async () => {
    const dir = makeTree(files);
    const result = await analyze({ folder: dir, duplication: true });
    const hotspot = result.report.hotspots.find((h) => h.path === "src/a.ts");
    const action = hotspot?.actions.find((x) => x.type === "deduplicate");
    expect(action?.text).toBe("Deduplicate with `src/b.ts`.");
  });

  it("stores no source text in the outputs", async () => {
    const dir = makeTree(files);
    const result = await analyze({ folder: dir, duplication: true });
    const out = JSON.stringify([result.snapshot, result.manifest, result.report]);
    expect(out).not.toContain("compute(");
  });
});

describe("Tier 3: other text files with --all", () => {
  const files = { "src/a.ts": A, "notes/todo.txt": "one\ntwo\nthree\n", Makefile: "all:\n\techo hi\n" };

  it("leaves them out by default and says so", async () => {
    const result = await analyze({ folder: makeTree(files) });
    expect(result.files.map((f) => f.path)).toEqual(["src/a.ts"]);
    expect(result.manifest.ignored.files.not_source_code).toBe(2);
  });

  it("gives them line metrics only: no complexity, never zero", async () => {
    const result = await analyze({ folder: makeTree(files), all: true });
    const txt = valuesOf(result, "notes/todo.txt");
    expect(txt.loc).toBe(3);
    expect(txt.mcc).toBeUndefined();
    expect(txt.rloc).toBeUndefined();
    expect(txt.language).toBeUndefined();
    expect(valuesOf(result, "Makefile").loc).toBe(2);
  });

  it("gives them git metrics when there is history", async () => {
    const result = await analyze({ folder: makeRepo(files), all: true });
    expect(valuesOf(result, "notes/todo.txt").number_of_commits).toBe(1);
  });
});
