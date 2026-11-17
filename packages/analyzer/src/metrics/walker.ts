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

/** The name a call goes through: the function, or for a Java method invocation the object and the method. */
function calleeOf(node: Node): string | undefined {
  const fn = node.childForFieldName("function");
  if (fn) return fn.text;
  // Kotlin: a call has no field, its callee is the first child
  if (node.type === "call_expression") return node.namedChildren[0]?.text;
  // Ruby: the receiver and the method
  const method = node.childForFieldName("method");
  const receiver = node.childForFieldName("receiver");
  if (method) return receiver ? `${receiver.text}.${method.text}` : method.text;
  const name = node.childForFieldName("name");
  const object = node.childForFieldName("object");
  return name ? (object ? `${object.text}.${name.text}` : name.text) : undefined;
}

const ARGS_REGEX = new Map<string, RegExp>();

/** The pattern of a rule's arguments, compiled once. */
function argsRegex(pattern: string): RegExp {
  let re = ARGS_REGEX.get(pattern);
  if (!re) {
    re = new RegExp(pattern);
    ARGS_REGEX.set(pattern, re);
  }
  return re;
}

/** A call whose callee matches the rule, such as `eval(...)` or `test.skip(...)`. */
function matchesCall(rule: ShortcutRule, re: RegExp | undefined, node: Node): boolean {
  if (node.type !== (rule.nodeType ?? "call_expression")) return false;
  const callee = calleeOf(node);
  if (callee === undefined || re?.test(callee) !== true) return false;
  if (!rule.argsPattern) return true;
  const args = (
    node.childForFieldName("arguments") ??
    node.namedChildren.find((c) => c?.type === "value_arguments") ??
    // Swift: the arguments are inside the call suffix
    node.namedChildren
      .find((c) => c?.type === "call_suffix")
      ?.namedChildren.find((c) => c?.type === "value_arguments")
  )?.text;
  return args !== undefined && argsRegex(rule.argsPattern).test(args);
}

export class Walker {
  functions = 0;
  branches = 0;
  maxFunctionComplexity: number | undefined;
  maxNesting = 0;
  readonly commentRanges = new Map<number, Array<[number, number]>>();
  readonly imports: string[] = [];
  readonly declares: string[] = [];
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
    if (rule.type === "emptyBlock")
      return rule.nodeType === node.type && (!re || re.test(node.text)) && this.isEmptyBlock(rule, node);
    return false;
  }

  private isEmptyBlock(rule: ShortcutRule, node: Node): boolean {
    const body = rule.bodyType
      ? node.namedChildren.find((c) => c?.type === rule.bodyType)
      : node.childForFieldName(rule.bodyField ?? "body");
    if (!body && rule.emptyWhenMissing) return true;
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
    this.collectCall(node);
    const declaration = this.lang.modules?.declarations?.find((d) => d.nodeType === node.type);
    const nameNode = declaration
      ? declaration.nameType
        ? node.namedChildren.find((c) => c?.type === declaration.nameType)
        : node.childForFieldName(declaration.nameField)
      : undefined;
    const declared = nameNode?.text;
    if (declared) this.declares.push(declared.replace(/\s+/g, ""));
    // several rules may read one statement: each reads the kind of module it names
    for (const statement of this.lang.modules?.statements.filter((s) => s.nodeType === node.type) ?? [])
      this.collectStatement(node, statement);
  }

  /** An import written as a call: `require "x"`, with what the callee puts in front of the path. */
  private collectCall(node: Node): void {
    const calls = this.lang.modules?.calls;
    if (!calls || node.type !== calls.nodeType) return;
    const callee = node.childForFieldName(calls.functionField)?.text;
    const prefix = callee === undefined ? undefined : calls.callees[callee];
    const first = node.childForFieldName(calls.argumentsField)?.namedChildren[0];
    if (prefix !== undefined && first?.type === "string") this.imports.push(`${prefix}${stringValue(first)}`);
  }

  private collectStatement(
    node: Node,
    statement: NonNullable<LanguageConfig["modules"]>["statements"][number],
  ) {
    if (statement.skipWhenField && node.childForFieldName(statement.skipWhenField)) return;
    if (statement.wholeText) {
      const text = node.text
        .replace(/\s+as\s+\w+/g, "")
        .replace(/\s+/g, " ")
        .trim();
      this.imports.push(`${statement.specPrefix ?? ""}${text}`);
      return;
    }
    const modules = (
      statement.moduleType
        ? node.namedChildren.filter(
            // the alias of `using A = B.C;` is the field `name`, not a module
            (c) => c?.type === statement.moduleType && c.id !== node.childForFieldName("name")?.id,
          )
        : node.childrenForFieldName(statement.moduleField)
    ).filter((n): n is Node => n !== null && n !== undefined);
    const wildcard =
      (statement.wildcardType !== undefined &&
        node.namedChildren.some((c) => c?.type === statement.wildcardType)) ||
      (statement.wildcardSuffix !== undefined &&
        node.text.replace(/\s+/g, "").endsWith(statement.wildcardSuffix));
    const names = statement.namesField
      ? node.childrenForFieldName(statement.namesField).filter((n): n is Node => n !== null)
      : [];
    for (const module of modules) {
      // `import a.b as c` names the module in its `name` field
      const base = (
        module.type === "aliased_import" ? (module.childForFieldName("name") ?? module) : module
      ).text
        .replace(/\s+as\s+\w+/g, "")
        .replace(/\s+/g, "")
        .replace(/^["'`<]|["'`>]$/g, "");
      this.imports.push(`${statement.specPrefix ?? ""}${wildcard ? `${base}.*` : base}`);
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
