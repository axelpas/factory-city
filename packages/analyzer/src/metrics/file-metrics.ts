import type { Node, Parser } from "web-tree-sitter";
import type { LanguageConfig } from "../languages/index.js";

/** Metrics of one file. A metric that cannot be computed is absent, never 0. */
export interface FileMetrics {
  metrics: Record<string, number>;
  syntaxErrors: boolean;
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
  return { metrics: { loc: splitLines(text).length }, syntaxErrors: false };
}

interface FunctionFrame {
  branches: number;
}

class Walker {
  functions = 0;
  branches = 0;
  maxFunctionComplexity: number | undefined;
  maxNesting = 0;
  readonly commentRanges = new Map<number, Array<[number, number]>>();
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
  }

  visit(node: Node, depth: number, parentType: string): void {
    const type = node.type;
    if (this.cm.has(type)) {
      this.addComment(node);
      return;
    }
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

export function computeMetrics(parser: Parser, lang: LanguageConfig, text: string): FileMetrics {
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
    return { metrics, syntaxErrors: tree.rootNode.hasError };
  } finally {
    tree.delete();
  }
}
