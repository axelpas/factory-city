import type { Node, Parser } from "web-tree-sitter";
import type { LanguageConfig } from "../languages/index.js";
import { computeCohesion } from "./cohesion.js";
import { Walker } from "./walker.js";

/** Metrics of one file. A metric that cannot be computed is absent, never 0. */
export interface FileMetrics {
  metrics: Record<string, number>;
  syntaxErrors: boolean;
  /** Module specifiers imported by the file, as written (`./a`, `@scope/pkg`). Empty for languages without coupling support. */
  imports: string[];
  /** Declaration names of each cohesion group, when the file has several: the report names groups by them. */
  groups?: string[][];
}

/** Line count: a final line break does not start a new line. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Metrics for files without a grammar (other text files): line count only. */
export function plainMetrics(text: string): FileMetrics {
  return { metrics: { loc: splitLines(text).length }, syntaxErrors: false, imports: [] };
}

function countCodeLines(lines: string[], comments: Map<number, Array<[number, number]>>) {
  let code = 0;
  let commentOnly = 0;
  lines.forEach((line, row) => {
    if (line.trim() === "") return;
    const ranges = comments.get(row);
    if (!ranges) {
      code++;
      return;
    }
    let masked = line;
    for (const [from, to] of ranges)
      masked = masked.slice(0, from) + " ".repeat(Math.max(0, to - from)) + masked.slice(to);
    if (masked.trim() === "") commentOnly++;
    else code++;
  });
  return { code, commentOnly };
}

/** Counts of the places where a check was silenced, by kind, with the total and its density. */
function shortcutMetrics(walker: Walker, lang: LanguageConfig, code: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (lang.shortcuts.length === 0) return out;
  let total = 0;
  // several rules may feed one kind: each kind is counted once
  for (const kind of new Set(lang.shortcuts.map((rule) => rule.kind))) {
    const n = walker.shortcuts.get(kind) ?? 0;
    out[`escape_${kind}`] = n;
    total += n;
  }
  out.escape_hatches = total;
  if (code > 0) out.escape_hatch_density = (total / code) * 1000;
  return out;
}

/** The cohesion of the file, and the names of its groups when there are several. */
function cohesionMetrics(
  root: Node,
  lang: LanguageConfig,
  isTest: boolean,
): { metrics: Record<string, number>; groups?: string[][] } {
  if (!lang.cohesion || isTest) return { metrics: {} };
  const cohesion = computeCohesion(root, lang.cohesion);
  if (!cohesion || cohesion.barrel) return { metrics: {} };
  return {
    metrics: {
      cohesion_groups: cohesion.groups,
      lack_of_cohesion: cohesion.nodes > 1 ? (cohesion.groups - 1) / (cohesion.nodes - 1) : 0,
    },
    groups: cohesion.groups > 1 ? cohesion.names : undefined,
  };
}

export function computeMetrics(
  parser: Parser,
  lang: LanguageConfig,
  text: string,
  isTest = false,
): FileMetrics {
  const lines = splitLines(text);
  const tree = parser.parse(text);
  if (!tree) return plainMetrics(text);
  try {
    const walker = new Walker(lang, lines);
    walker.visit(tree.rootNode, 0, "");
    const { code, commentOnly } = countCodeLines(lines, walker.commentRanges);
    const cohesion = cohesionMetrics(tree.rootNode, lang, isTest);
    const metrics: Record<string, number> = {
      loc: lines.length,
      rloc: code,
      comment_lines: commentOnly,
      functions: walker.functions,
      mcc: code === 0 ? 0 : Math.max(1, walker.functions + walker.branches),
      max_nesting_level: walker.maxNesting,
      ...(walker.maxFunctionComplexity === undefined
        ? {}
        : { max_function_complexity: walker.maxFunctionComplexity }),
      ...shortcutMetrics(walker, lang, code),
      ...cohesion.metrics,
    };
    return {
      metrics,
      syntaxErrors: tree.rootNode.hasError,
      imports: walker.imports,
      ...(cohesion.groups ? { groups: cohesion.groups } : {}),
    };
  } finally {
    tree.delete();
  }
}
