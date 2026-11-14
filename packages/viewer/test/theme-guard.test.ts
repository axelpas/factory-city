import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..", "src");
const THEMES = join(SRC, "themes");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// Patterns are built from parts so that this file never matches its own scan.
const HEX = new RegExp(`#[0-9a-f]${"{3,8}"}\\b`, "i");
const HEX_NUM = new RegExp(`\\b0${"x"}[0-9a-f]${"{6}"}\\b`, "i");
const FUNC = /\b(rgb|rgba|hsl|hsla)\(\s*\d/;
const FONT = new RegExp(`font-${"family"}\\s*:(?!\\s*var\\()`);

describe("theme tokens", () => {
  const files = walk(SRC).filter((f) => !f.startsWith(THEMES) && /\.(ts|css|html)$/.test(f));

  it("scans the viewer sources", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("keeps literal colors and fonts out of everything but the theme files", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const hit = [HEX, HEX_NUM, FUNC, FONT].find((re) => re.test(text));
      if (hit) offenders.push(`${relative(SRC, file)} matches ${hit.source}`);
    }
    expect(offenders).toEqual([]);
  });
});
