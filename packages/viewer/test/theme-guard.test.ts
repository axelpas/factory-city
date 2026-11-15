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

describe("design tokens", () => {
  const css = readFileSync(join(SRC, "style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  // everything after the first rule: the token block itself is where raw values live
  const rules = css.slice(css.indexOf("}") + 1);
  // built from parts so that this file never matches its own scan
  const SIZED = ["font-size", "padding", "margin", "gap", "border-radius"];
  const RAW = new RegExp(`\\d(${"px"}|${"rem"}|${"em"})\\b`);

  it("starts with the token block", () => {
    expect(css.trimStart().startsWith(":root {")).toBe(true);
    for (const token of ["--s-8", "--text-md", "--radius-3", "--control-h"])
      expect(css.slice(0, css.indexOf("}"))).toContain(`${token}:`);
  });

  it("takes every spacing, font size and radius from a token", () => {
    const offenders: string[] = [];
    for (const declaration of rules.split(/[;{}]/)) {
      const [property, value] = declaration.split(":").map((part) => part.trim());
      if (!property || value === undefined) continue;
      const sized = SIZED.some((name) => property === name || property.startsWith(`${name}-`));
      if (sized && RAW.test(value)) offenders.push(`${property}: ${value}`);
    }
    expect(offenders).toEqual([]);
  });

  it("gives selects, inputs and buttons one height, and icon buttons a 24 px target at least", () => {
    const token = (name: string) => Number(new RegExp(`${name}:\\s*(\\d+)`).exec(css)?.[1]);
    expect(token("--control-h")).toBeGreaterThanOrEqual(28);
    expect(token("--icon-size")).toBeGreaterThanOrEqual(24);
    expect(rules).toMatch(
      /select,\s*input\[type="search"\],\s*button,\s*\.popover > summary \{\s*height: var\(--control-h\)/,
    );
  });
});

describe("browser build", () => {
  it("imports only types from the schema package root, which holds Node-only code", () => {
    const offenders: string[] = [];
    const root = new RegExp(`from "@factory-city/${"schema"}";`);
    for (const file of walk(SRC).filter((f) => f.endsWith(".ts"))) {
      for (const statement of readFileSync(file, "utf8").split(";\n")) {
        if (root.test(`${statement};`) && !/import type /.test(statement))
          offenders.push(relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
