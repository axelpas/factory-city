import { describe, expect, it } from "vitest";
import { LANGUAGES } from "../src/languages/index.js";
import { computeMetrics, splitLines } from "../src/metrics/file-metrics.js";
import { getParser } from "../src/parse.js";

const lang = (id: string) => LANGUAGES.find((l) => l.id === id) as (typeof LANGUAGES)[number];

async function measure(id: string, code: string) {
  const language = lang(id);
  return computeMetrics(await getParser(language.grammar), language, code);
}

describe("size metrics", () => {
  it("counts lines without a phantom last line", () => {
    expect(splitLines("a\nb\n")).toHaveLength(2);
    expect(splitLines("a\nb")).toHaveLength(2);
    expect(splitLines("")).toHaveLength(0);
  });

  it("separates code, comment-only and blank lines", async () => {
    const code = [
      "// header",
      "",
      "const a = 1; // trailing",
      "/* block",
      "   still block */",
      "const b = 2;",
      "",
    ].join("\n");
    const { metrics } = await measure("typescript", code);
    expect(metrics.loc).toBe(6);
    expect(metrics.rloc).toBe(2);
    expect(metrics.comment_lines).toBe(3);
  });

  it("measures an empty file as zero lines and zero complexity", async () => {
    const { metrics } = await measure("typescript", "");
    expect(metrics).toMatchObject({ loc: 0, rloc: 0, functions: 0, mcc: 0 });
  });
});

describe("complexity metrics", () => {
  it("counts functions and branch points", async () => {
    const code = `
function a(x: number) {
  if (x > 1 && x < 5 || x === 9) { return 1; }
  for (const i of [1, 2]) { if (i) continue; }
  return x ? 1 : 2;
}
const b = (y: number) => y ?? 0;
`;
    const { metrics } = await measure("typescript", code);
    expect(metrics.functions).toBe(2);
    // branches: if, &&, ||, for-of, if, ternary, ?? = 7; plus 2 functions
    expect(metrics.mcc).toBe(9);
    // function a: 1 + (if, &&, ||, for, if, ternary) = 7 ; function b: 1 + (??) = 2
    expect(metrics.max_function_complexity).toBe(7);
  });

  it("counts an else-if chain without extra nesting", async () => {
    const code =
      "function f(x: number) { if (x === 1) { return 1; } else if (x === 2) { return 2; } else { return 3; } }";
    const { metrics } = await measure("typescript", code);
    expect(metrics.max_nesting_level).toBe(1);
    expect(metrics.max_function_complexity).toBe(3);
  });

  it("measures nesting depth, callbacks included", async () => {
    const code =
      "function f(xs: number[]) { for (const x of xs) { if (x) { xs.map((y) => { while (y) { y--; } }); } } }";
    const { metrics } = await measure("typescript", code);
    // for (1) > if (2) > arrow (3) > while (4)
    expect(metrics.max_nesting_level).toBe(4);
  });

  it("leaves max_function_complexity out when the file has no function", async () => {
    const { metrics } = await measure("typescript", "export const a = 1;\n");
    expect(metrics).not.toHaveProperty("max_function_complexity");
    expect(metrics.mcc).toBe(1);
  });
});

describe("languages", () => {
  it("parses TSX and JSX", async () => {
    const tsx = await measure("tsx", "export const A = () => <div>{x ? <b/> : null}</div>;\n");
    expect(tsx.metrics.functions).toBe(1);
    expect(tsx.syntaxErrors).toBe(false);
    const jsx = await measure("javascript", "export const A = () => <div>{x && <b/>}</div>;\n");
    expect(jsx.metrics.functions).toBe(1);
    expect(jsx.syntaxErrors).toBe(false);
  });

  it("still produces metrics for files with syntax errors", async () => {
    const { metrics, syntaxErrors } = await measure("typescript", "function broken( {\n  if (\n");
    expect(syntaxErrors).toBe(true);
    expect(metrics.loc).toBe(2);
  });
});
