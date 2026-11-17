import type { Node } from "web-tree-sitter";
import type { LanguageConfig, ShortcutRule } from "../languages/index.js";

interface FunctionFrame {
  branches: number;
}

/** The text of a string literal node, without its quotes. */
function stringValue(node: Node): string {
  const fragment = node.namedChildren.find((c) => c?.type === "string_fragment");
  return fragment ? fragment.text : node.text.slice(1, -1);
}

/** A call whose callee matches the rule, such as `eval(...)` or `test.skip(...)`. */
function matchesCall(rule: ShortcutRule, re: RegExp | undefined, node: Node): boolean {
  if (node.type !== (rule.nodeType ?? "call_expression")) return false;
  const callee = node.childForFieldName("function")?.text;
  return callee !== undefined && re?.test(callee) === true;
}

export class Walker {
  functions = 0;
  branches = 0;
  maxFunctionComplexity: number | undefined;
  maxNesting = 0;
  readonly commentRanges = new Map<number, Array<[number, number]>>();
  readonly imports: string[] = [];
  readonly shortcuts = new Map<string, number>();
  /** Security signals by kind: how many places, never what they say. */
  readonly security = new Map<string, number>();
  private readonly rules: Array<{ rule: ShortcutRule; re: RegExp | undefined }>;
  private readonly securityRules: Array<{ rule: ShortcutRule; re: RegExp | undefined }>;
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
    const compile = (rule: ShortcutRule) => ({
      rule,
      re: rule.pattern ? new RegExp(rule.pattern) : undefined,
    });
    this.rules = lang.shortcuts.map(compile);
    this.securityRules = lang.security.map(compile);
  }

  private count(kind: string): void {
    this.shortcuts.set(kind, (this.shortcuts.get(kind) ?? 0) + 1);
  }

  private inspect(node: Node): void {
    this.countShortcuts(node);
    this.collectImport(node);
  }

  /** Whether a node is a place where a check was silenced, by one of the language's rules. */
  private matches(rule: ShortcutRule, re: RegExp | undefined, node: Node): boolean {
    if (rule.type === "node") return rule.nodeType === node.type && (!re || re.test(node.text));
    if (rule.type === "call") return matchesCall(rule, re, node);
    if (rule.type === "emptyBlock") return rule.nodeType === node.type && this.isEmptyBlock(rule, node);
    return false;
  }

  private isEmptyBlock(rule: ShortcutRule, node: Node): boolean {
    const body = rule.bodyType
      ? node.namedChildren.find((c) => c?.type === rule.bodyType)
      : node.childForFieldName(rule.bodyField ?? "body");
    const idle = new Set(rule.emptyTypes ?? []);
    return body?.namedChildren.every((c) => !c || this.cm.has(c.type) || idle.has(c.type)) === true;
  }

  /** Counts the places where a check was silenced, by the language's rules. */
  private countShortcuts(node: Node): void {
    for (const { rule, re } of this.rules) if (this.matches(rule, re, node)) this.count(rule.kind);
    for (const { rule, re } of this.securityRules) {
      if (this.matches(rule, re, node)) this.security.set(rule.kind, (this.security.get(rule.kind) ?? 0) + 1);
    }
  }

  /** Collects the module a node imports: an import statement, or a call such as `require`. */
  private collectImport(node: Node): void {
    const type = node.type;
    this.collectModules(node);
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

  /**
   * Collects the modules a statement imports in a language whose modules are names (`import a.b`, `from .c import d`).
   * Each name taken from a module is added as a module of its own (`c.d`): the resolver keeps the ones that exist.
   */
  private collectModules(node: Node): void {
    const statement = this.lang.modules?.statements.find((s) => s.nodeType === node.type);
    if (!statement) return;
    const modules = node.childrenForFieldName(statement.moduleField).filter((n): n is Node => n !== null);
    const names = statement.namesField
      ? node.childrenForFieldName(statement.namesField).filter((n): n is Node => n !== null)
      : [];
    for (const module of modules) {
      // `import a.b as c` names the module in its `name` field
      const base = (module.childForFieldName("name") ?? module).text.replace(/\s+/g, "");
      this.imports.push(base);
      for (const name of names) {
        const bare = (name.childForFieldName("name") ?? name).text;
        this.imports.push(base.endsWith(".") ? `${base}${bare}` : `${base}.${bare}`);
      }
    }
  }

  /** The depth inside a node: one more for a control structure or a function, unless its parent excuses it. */
  private nextDepth(type: string, depth: number, parentType: string): number {
    if (!this.nest.has(type) || this.lang.nestingExceptParent[type]?.includes(parentType)) return depth;
    this.maxNesting = Math.max(this.maxNesting, depth + 1);
    return depth + 1;
  }

  /** A comment: its place is remembered, and the rules about comments are applied. */
  private visitComment(node: Node): void {
    this.addComment(node);
    for (const { rule, re } of this.rules)
      if (rule.type === "comment" && re?.test(node.text)) this.count(rule.kind);
  }

  /** The end of a function: its complexity is one plus the branches inside it. */
  private leaveFunction(): void {
    const frame = this.stack.pop() as FunctionFrame;
    const complexity = 1 + frame.branches;
    this.maxFunctionComplexity = Math.max(this.maxFunctionComplexity ?? 0, complexity);
  }

  visit(node: Node, depth: number, parentType: string): void {
    const type = node.type;
    if (this.cm.has(type)) {
      this.visitComment(node);
      return;
    }
    this.inspect(node);
    const nextDepth = this.nextDepth(type, depth, parentType);
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
    if (isFunction) this.leaveFunction();
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
