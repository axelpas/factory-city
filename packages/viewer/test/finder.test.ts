import { describe, expect, it } from "vitest";
import { createFormat } from "../src/lib/format";
import { describeCity } from "../src/view/describe";
import { findFiles } from "../src/view/finder";

const entries = [
  "src/app.ts",
  "src/ui/app-bar.ts",
  "test/app.test.ts",
  "docs/readme.md",
  "src/lib/format.ts",
].map((path, union) => ({ path, union }));

describe("file finder", () => {
  it("lists every file in path order when nothing is typed", () => {
    const r = findFiles(entries, "");
    expect(r.total).toBe(5);
    expect(r.matches).toHaveLength(5);
  });

  it("keeps the files whose path holds every word, best match first", () => {
    const r = findFiles(entries, "app");
    expect(r.matches.map((m) => m.path)).toEqual(["src/app.ts", "test/app.test.ts", "src/ui/app-bar.ts"]);
    expect(findFiles(entries, "src app").matches.map((m) => m.path)).toEqual([
      "src/app.ts",
      "src/ui/app-bar.ts",
    ]);
    expect(findFiles(entries, "FORMAT").matches.map((m) => m.path)).toEqual(["src/lib/format.ts"]);
  });

  it("puts a name that starts with the word before a name that only contains it, and caps the list", () => {
    const more = [
      { path: "a/xapp.ts", union: 9 },
      { path: "a/app.ts", union: 8 },
    ];
    expect(findFiles(more, "app").matches.map((m) => m.path)).toEqual(["a/app.ts", "a/xapp.ts"]);
    const r = findFiles(entries, "", 2);
    expect(r.matches).toHaveLength(2);
    expect(r.total).toBe(5);
  });

  it("finds nothing for a word that is nowhere", () => {
    expect(findFiles(entries, "zzz")).toEqual({ matches: [], total: 0 });
  });
});

describe("city description", () => {
  const fmt = createFormat(["en-US"]);
  it("tells the question, the counts and the frame, and points to the keyboard path", () => {
    const text = describeCity(
      {
        project: "demo",
        preset: "Hotspots",
        question: "Where is complex code changing often?",
        files: 151,
        districts: 4,
        frame: { index: 27, count: 28, label: "feat: group file details" },
      },
      fmt.integer,
    );
    expect(text).toBe(
      "Hotspots: Where is complex code changing often? 151 files in 4 districts. Frame 28 of 28: feat: group file details. Use the file finder to explore it with the keyboard.",
    );
  });
});
