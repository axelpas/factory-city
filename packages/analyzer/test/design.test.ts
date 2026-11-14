import { describe, expect, it } from "vitest";
import { LANGUAGES } from "../src/languages/index.js";
import { computeMetrics } from "../src/metrics/file-metrics.js";
import { getParser } from "../src/parse.js";

const lang = (id: string) => LANGUAGES.find((l) => l.id === id) as (typeof LANGUAGES)[number];

async function measure(code: string, id = "typescript", isTest = false) {
  const language = lang(id);
  return computeMetrics(await getParser(language.grammar), language, code, isTest);
}

describe("cohesion groups (LCOM4 generalized to a file)", () => {
  it("is one group when functions call each other", async () => {
    const { metrics } = await measure(
      "function a() { return b(); }\nfunction b() { return c(); }\nfunction c() { return 1; }\n",
    );
    expect(metrics.cohesion_groups).toBe(1);
    expect(metrics.lack_of_cohesion).toBe(0);
  });

  it("counts several groups for unrelated functions", async () => {
    const code =
      "function parseDate(s: string) { return s.trim(); }\nfunction renderTable(t: string[]) { return t.join(); }\nfunction sendMail(m: string) { return m; }\n";
    const { metrics } = await measure(code);
    expect(metrics.cohesion_groups).toBe(3);
    expect(metrics.lack_of_cohesion).toBe(1);
  });

  it("links functions that use the same variable declared in the file", async () => {
    const code =
      "const cache = new Map<string, number>();\nfunction get(k: string) { return cache.get(k); }\nfunction put(k: string, v: number) { cache.set(k, v); }\nfunction unrelated() { return 1; }\n";
    const { metrics } = await measure(code);
    expect(metrics.cohesion_groups).toBe(2);
    expect(metrics.lack_of_cohesion).toBeCloseTo(1 / 2, 10);
  });

  it("splits a class whose methods work on unrelated fields", async () => {
    const code =
      "class Mixed {\n  private a = 0;\n  private b = 0;\n  constructor() { this.a = 1; this.b = 2; }\n  incrementA() { this.a++; }\n  resetB() { this.b = 0; }\n  hello() { return 'x'; }\n}\n";
    const { metrics } = await measure(code);
    // the constructor links nothing: it is not a node
    expect(metrics.cohesion_groups).toBe(3);
  });

  it("keeps a class together through its method calls and shared fields", async () => {
    const code =
      "class Counter {\n  private n = 0;\n  inc() { this.n++; }\n  twice() { this.inc(); this.inc(); }\n  read() { return this.n; }\n}\n";
    const { metrics } = await measure(code);
    expect(metrics.cohesion_groups).toBe(1);
  });

  it("treats sibling components as one group by their shared leading word", async () => {
    const code =
      "export function Card() { return 1; }\nexport function CardHeader() { return 2; }\nexport function CardBody() { return 3; }\n";
    expect((await measure(code, "tsx")).metrics.cohesion_groups).toBe(1);
    const unrelated = "export function Card() { return 1; }\nexport function Table() { return 2; }\n";
    expect((await measure(unrelated, "tsx")).metrics.cohesion_groups).toBe(2);
  });

  it("treats themed helpers as one group", async () => {
    const code =
      "export const formatDate = (d: Date) => d.toISOString();\nexport const formatNumber = (n: number) => String(n);\n";
    const { metrics } = await measure(code);
    expect(metrics.cohesion_groups).toBe(1);
  });

  it("is 0 lack of cohesion for a single function", async () => {
    const { metrics } = await measure("export function only() { return 1; }\n");
    expect(metrics.cohesion_groups).toBe(1);
    expect(metrics.lack_of_cohesion).toBe(0);
  });

  it("is unavailable for a barrel file, a file without function and a test file", async () => {
    const barrel = await measure('export * from "./a";\nexport { b } from "./b";\n');
    expect(barrel.metrics).not.toHaveProperty("cohesion_groups");
    const constants = await measure("export const A = 1;\nexport const B = 2;\n");
    expect(constants.metrics).not.toHaveProperty("lack_of_cohesion");
    const test = await measure(
      "function a() { return 1; }\nfunction b() { return 2; }\n",
      "typescript",
      true,
    );
    expect(test.metrics).not.toHaveProperty("cohesion_groups");
  });
});

describe("imports found in a file", () => {
  it("lists import, export-from, require and dynamic import, with the module as written", async () => {
    const code = [
      'import a, { b } from "./x";',
      'import type { T } from "../t";',
      'export { c } from "./c";',
      'export * from "./star";',
      'const r = require("./req");',
      "async function f() { return import('./dyn'); }",
      'import ext from "lodash";',
    ].join("\n");
    const { imports } = await measure(code);
    expect(imports).toEqual(["./x", "../t", "./c", "./star", "./req", "./dyn", "lodash"]);
  });
});

describe("shortcuts: places where a check was silenced", () => {
  const code = [
    "let a: any = 1;",
    "const b = a as any;",
    "// @ts-ignore",
    "// @ts-expect-error",
    "// @ts-nocheck",
    "// eslint-disable-next-line no-console",
    "// biome-ignore lint/suspicious/noExplicitAny: reason",
    "it.skip('x', () => {});",
    "xit('y', () => {});",
    "describe.skip('z', () => {});",
    "it.only('w', () => {});",
    "fit('v', () => {});",
    "try { run(); } catch (e) {}",
    "try { run(); } catch (e) { /* ignored */ }",
    "try { run(); } catch (e) { handle(e); }",
  ].join("\n");

  it("counts each kind separately", async () => {
    const { metrics } = await measure(code);
    expect(metrics).toMatchObject({
      escape_any: 2,
      escape_ts_ignore: 1,
      escape_ts_expect_error: 1,
      escape_ts_nocheck: 1,
      escape_lint_disable: 2,
      escape_skipped_test: 3,
      escape_focused_test: 2,
      escape_empty_catch: 2,
    });
  });

  it("sums them and gives a density per 1,000 real lines", async () => {
    const { metrics } = await measure(code);
    expect(metrics.escape_hatches).toBe(14);
    expect(metrics.escape_hatch_density).toBeCloseTo((14 / (metrics.rloc as number)) * 1000, 6);
  });

  it("counts nothing in clean code and leaves the density out for an empty file", async () => {
    const clean = await measure("export const a: number = 1;\n");
    expect(clean.metrics.escape_hatches).toBe(0);
    expect(clean.metrics.escape_hatch_density).toBe(0);
    const empty = await measure("");
    expect(empty.metrics).not.toHaveProperty("escape_hatch_density");
  });

  it("does not mistake the word any in a string or a name", async () => {
    const { metrics } = await measure("const anyThing = 'any';\ntype Company = { name: string };\n");
    expect(metrics.escape_any).toBe(0);
  });
});
