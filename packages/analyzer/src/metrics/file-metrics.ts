import type { Node, Parser } from "web-tree-sitter";
import type { LanguageConfig, ShortcutRule } from "../languages/index.js";
import { computeCohesion } from "./cohesion.js";

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

interface FunctionFrame {
  branches: number;
}

/** The text of a string literal node, without its quotes. */
function stringValue(node: Node): string {
  const fragment = node.namedChildren.find((c) => c?.type === "string_fragment");
  return fragment ? fragment.text : node.text.slice(1, -1);
}

class Walker {
  functions = 0;
  branches = 0;
  maxFunctionComplexity: number | undefined;
  maxNesting = 0;
  readonly commentRanges = new Map<number, Array<[number, number]>>();
  readonly imports: string[] = [];
  readonly shortcuts = new Map<string, number>();
  private readonly rules: Array<{ rule: ShortcutRule; re: RegExp | undefined }>;
  private readonly stack: FunctionFrame[] = [];
  private readonly fn: Set<string>;
  private readonly br: Set<string>;
  private readonly cm: Set<string>;
  private readonly nest: Set<string>;
  private readonly logicalTypes: Set<string>;
  private readonly logicalOps: Set<string>;

  constructor(
    private readonly lang: LanguageConfig,
    private readonly lines: string[],
  ) {
    this.fn = new Set(lang.functions);
    this.br = new Set(lang.branches);
    this.cm = new Set(lang.comment);
    this.nest = new Set(lang.nesting);
    this.logicalTypes = new Set(lang.logical.nodeTypes);
    this.logicalOps = new Set(lang.logical.operators);
    this.rules = lang.shortcuts.map((rule) => ({
      rule,
      re: rule.pattern ? new RegExp(rule.pattern) : undefined,
    }));
  }

  private count(kind: string): void {
    this.shortcuts.set(kind, (this.shortcuts.get(kind) ?? 0) + 1);
  }

  private inspect(node: Node): void {
    const type = node.type;
    for (const { rule, re } of this.rules) {
      if (rule.type === "node" && rule.nodeType === type && (!re || re.test(node.text)))
        this.count(rule.kind);
      else if (rule.type === "call" && type === (rule.nodeType ?? "call_expression")) {
        const callee = node.childForFieldName("function")?.text;
        if (callee !== undefined && re?.test(callee)) this.count(rule.kind);
      } else if (rule.type === "emptyBlock" && rule.nodeType === type) {
        const body = node.childForFieldName(rule.bodyField ?? "body");
        if (body?.namedChildren.every((c) => !c || this.cm.has(c.type))) this.count(rule.kind);
      }
    }
    const imp = this.lang.imports;
    if (!imp) return;
    if (imp.statements.includes(type)) {
      const source = node.childForFieldName(imp.sourceField);
      if (source) this.imports.push(stringValue(source));
    } else if (type === imp.calls.nodeType) {
      const callee = node.childForFieldName(imp.calls.functionField)?.text;
      const first = node.childForFieldName(imp.calls.argumentsField)?.namedChildren[0];
      if (callee && imp.calls.callees.includes(callee) && first?.type === "string")
        this.imports.push(stringValue(first));
    }
  }

  visit(node: Node, depth: number, parentType: string): void {
    const type = node.type;
    if (this.cm.has(type)) {
      this.addComment(node);
      for (const { rule, re } of this.rules)
        if (rule.type === "comment" && re?.test(node.text)) this.count(rule.kind);
      return;
    }
    this.inspect(node);
    let nextDepth = depth;
    if (this.nest.has(type) && !this.lang.nestingExceptParent[type]?.includes(parentType)) {
      nextDepth = depth + 1;
      if (nextDepth > this.maxNesting) this.maxNesting = nextDepth;
    }
    const isFunction = this.fn.has(type);
    if (isFunction) {
      this.functions++;
      this.stack.push({ branches: 0 });
    }
    if (this.isBranch(node)) {
      this.branches++;
      const frame = this.stack[this.stack.length - 1];
      if (frame) frame.branches++;
    }
    for (const child of node.namedChildren) if (child) this.visit(child, nextDepth, type);
    if (isFunction) {
      const frame = this.stack.pop() as FunctionFrame;
      const complexity = 1 + frame.branches;
      if (this.maxFunctionComplexity === undefined || complexity > this.maxFunctionComplexity) {
        this.maxFunctionComplexity = complexity;
      }
    }
  }

  private isBranch(node: Node): boolean {
    if (this.br.has(node.type)) return true;
    if (this.logicalTypes.has(node.type)) {
      const op = node.childForFieldName("operator")?.type;
      return op !== undefined && this.logicalOps.has(op);
    }
    return false;
  }

  private addComment(node: Node): void {
    const start = node.startPosition;
    const end = node.endPosition;
    for (let row = start.row; row <= end.row; row++) {
      const lineLength = this.lines[row]?.length ?? 0;
      const from = row === start.row ? start.column : 0;
      const to = row === end.row ? end.column : lineLength;
      const list = this.commentRanges.get(row);
      if (list) list.push([from, to]);
      else this.commentRanges.set(row, [[from, to]]);
    }
  }
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
    const metrics: Record<string, number> = {
      loc: lines.length,
      rloc: code,
      comment_lines: commentOnly,
      functions: walker.functions,
      mcc: code === 0 ? 0 : Math.max(1, walker.functions + walker.branches),
      max_nesting_level: walker.maxNesting,
    };
    if (walker.maxFunctionComplexity !== undefined)
      metrics.max_function_complexity = walker.maxFunctionComplexity;
    if (lang.shortcuts.length > 0) {
      let total = 0;
      // several rules may feed one kind: each kind is counted once
      for (const kind of new Set(lang.shortcuts.map((rule) => rule.kind))) {
        const n = walker.shortcuts.get(kind) ?? 0;
        metrics[`escape_${kind}`] = n;
        total += n;
      }
      metrics.escape_hatches = total;
      if (code > 0) metrics.escape_hatch_density = (total / code) * 1000;
    }
    let groups: string[][] | undefined;
    if (lang.cohesion && !isTest) {
      const cohesion = computeCohesion(tree.rootNode, lang.cohesion);
      if (cohesion && !cohesion.barrel) {
        metrics.cohesion_groups = cohesion.groups;
        if (cohesion.groups > 1) groups = cohesion.names;
        metrics.lack_of_cohesion = cohesion.nodes > 1 ? (cohesion.groups - 1) / (cohesion.nodes - 1) : 0;
      }
    }
    return {
      metrics,
      syntaxErrors: tree.rootNode.hasError,
      imports: walker.imports,
      ...(groups ? { groups } : {}),
    };
  } finally {
    tree.delete();
  }
}
