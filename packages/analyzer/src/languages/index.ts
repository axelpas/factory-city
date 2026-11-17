import c from "./c.json" with { type: "json" };
import cHeader from "./c-header.json" with { type: "json" };
import cpp from "./cpp.json" with { type: "json" };
import csharp from "./csharp.json" with { type: "json" };
import go from "./go.json" with { type: "json" };
import java from "./java.json" with { type: "json" };
import javascript from "./javascript.json" with { type: "json" };
import kotlin from "./kotlin.json" with { type: "json" };
import php from "./php.json" with { type: "json" };
import python from "./python.json" with { type: "json" };
import ruby from "./ruby.json" with { type: "json" };
import rust from "./rust.json" with { type: "json" };
import swift from "./swift.json" with { type: "json" };
import tsx from "./tsx.json" with { type: "json" };
import typescript from "./typescript.json" with { type: "json" };

/** Declarative language configuration: which syntax nodes count as what. No language-specific engine code. */
export interface LanguageConfig {
  id: string;
  label: string;
  tier: 1 | 2;
  /** The configuration this one inherits from: only what differs is written in its file. */
  extends?: string;
  /**
   * Grammar file name without prefix, e.g. `typescript` for `tree-sitter-typescript.wasm`. Looked up in the
   * package's own `grammars/` folder first, then in the grammar package.
   */
  grammar: string;
  extensions: string[];
  comment: string[];
  functions: string[];
  branches: string[];
  logical: { nodeTypes: string[]; operators: string[] };
  nesting: string[];
  nestingExceptParent: Record<string, string[]>;
  /** Where module dependencies come from; absent for languages without coupling support. */
  imports?: ImportsConfig;
  /**
   * Where module dependencies come from in languages whose imports are names, not quoted paths (Python, Go, Java...).
   * Absent for languages without coupling support.
   */
  modules?: ModulesConfig;
  /** Which syntax nodes make up the file's units for cohesion; absent when cohesion is unavailable. */
  cohesion?: CohesionConfig;
  /** Declarative rules for places where a check was silenced. */
  shortcuts: ShortcutRule[];
  /** Declarative rules for security signals: places that widen the attack surface (never proof of a flaw). */
  security: ShortcutRule[];
}

export interface ImportsConfig {
  /** Statement nodes carrying the module in `sourceField` (import, export-from). */
  statements: string[];
  sourceField: string;
  calls: { nodeType: string; functionField: string; argumentsField: string; callees: string[] };
}

/** An import statement of a language whose modules are named: the field holding the module, and the names taken from it. */
export interface ModulesConfig {
  statements: Array<{
    nodeType: string;
    /** The field holding the module; empty when the module is a child of the type `moduleType` (Java). */
    moduleField: string;
    moduleType?: string;
    /** A child of this type means every module of the package is imported (Java `.*`): `.*` is added to the name. */
    wildcardType?: string;
    /** The statement ends with this text when it imports a whole package (Kotlin `.*`, an anonymous token). */
    wildcardSuffix?: string;
    /** Added in front of the module name, to tell this kind of statement from the others (Rust `mod:` for `mod x;`). */
    specPrefix?: string;
    /** The statement says nothing about another file when it has this field (Rust `mod x { ... }` has a body). */
    skipWhenField?: string;
    /** Field with the names imported from the module: each may be a module of its own (`from a import b`). */
    namesField?: string;
  }>;
  /** How the names are turned into files of the project (see `resolve/modules.ts`). */
  resolver: "python" | "go" | "java" | "csharp" | "kotlin" | "rust";
  /** `package` when an import names a group of files (a Go package, a C# namespace): it counts once in `imports_out`. */
  granularity?: "package";
  /** Nodes that declare a name other files can import (a C# namespace): the node type and the field with the name. */
  declarations?: Array<{ nodeType: string; nameField: string; nameType?: string }>;
}

export interface CohesionConfig {
  wrappers: string[];
  /** The field of a wrapper node that holds what it wraps; `declaration` when absent. */
  wrapperField?: string;
  functionDeclarations: string[];
  variableDeclarations: string[];
  functionValues: string[];
  classDeclarations: string[];
  methods: string[];
  constructorName: string;
  fields: string[];
  otherDeclarations: string[];
  identifiers: string[];
  memberExpression: string;
  /** Fields of a member expression, `object` and `property` when absent (Python: `object` and `attribute`). */
  memberObjectField?: string;
  memberPropertyField?: string;
  selfObject: string;
  /** Top-level `name = value` statements that declare a name: the statement, the assignment inside it, the name field. */
  assignments?: { statement: string; node: string; nameField: string };
  /** True when the fields of a class are the members its constructor sets through the self object (Python). */
  fieldsFromConstructor?: boolean;
  /**
   * Languages whose methods are declared outside their type (Go): the method node, the field holding its receiver,
   * and the nodes that declare a type with its fields. The name the receiver gives itself is the self object.
   */
  receivers?: {
    methodNode: string;
    receiverField: string;
    typeDeclaration: string;
    typeSpec: string;
    structNode: string;
    fieldNode: string;
  };
  /**
   * True when a method may use the fields and the methods of its class by their bare name, without the self object
   * (Java, Kotlin): a name the method uses that is a member of its class counts as a use.
   */
  bareMembers?: boolean;
  /**
   * Fields whose names sit in declarators (Java `int a, b;`): the type of the declarator, the field holding the
   * name, and the child that holds the declarators when they are not direct children of the member (C#).
   */
  fieldDeclarators?: { declaratorType: string; nameField: string; through?: string };
  /** The node that holds the body of a class when it is not in the field `body` (Kotlin `class_body`). */
  classBodyType?: string;
  /** The parameters of a primary constructor are fields of the class (Kotlin): the constructor node, and the parameter node. */
  constructorParams?: { constructor: string; parameter: string };
  /** Nodes that hold declarations of the top level without being one (a C# namespace): their members are read as top level. */
  containers?: string[];
  /** Type declarations whose name is in `name` and whose fields are in the `body`'s `fieldNode` (Rust `struct_item`). */
  structNodes?: string[];
  /** The field that names a class when it is not `name` (Rust `impl_item` has `type`). */
  classNameField?: string;
  /** Declarations holding specs that each declare names (Go: `const_declaration` holds `const_spec`s). */
  specDeclarations?: Record<string, string>;
  barrelStatements: string[];
  /** Two functions whose names start with the same word of at least this length are linked. */
  minStemLength: number;
}

/**
 * One shortcut rule; several rules may feed the same kind. `comment` matches comment text, `node` matches a node
 * type and its text, `call` matches the callee, `emptyBlock` matches a node whose body has no statement.
 */
export interface ShortcutRule {
  kind: string;
  type: "comment" | "node" | "call" | "emptyBlock";
  pattern?: string;
  nodeType?: string;
  bodyField?: string;
  /** For `emptyBlock`: when the body has no field, the type of the child that is the body (Python: `block`). */
  bodyType?: string;
  /** For `call`: a pattern the text of the arguments must match too (`exec.Command` with a shell as first argument). */
  argsPattern?: string;
  /** For `emptyBlock`: statement types that do nothing, beside comments (Python: `pass_statement`). */
  emptyTypes?: string[];
}

type RawConfig = Partial<LanguageConfig> &
  Pick<LanguageConfig, "id" | "label" | "tier" | "grammar" | "extensions">;

/**
 * The order is the category code stored in snapshots: append new languages, never reorder.
 */
const RAW: RawConfig[] = [
  typescript,
  tsx,
  javascript,
  python,
  go,
  java,
  csharp,
  c,
  cpp,
  cHeader,
  rust,
  php,
  ruby,
  kotlin,
  swift,
] as RawConfig[];

function resolve(raw: RawConfig, all: Map<string, RawConfig>): LanguageConfig {
  const base = raw.extends ? resolve(must(all.get(raw.extends), raw.extends), all) : undefined;
  return {
    comment: [],
    functions: [],
    branches: [],
    logical: { nodeTypes: [], operators: [] },
    nesting: [],
    nestingExceptParent: {},
    shortcuts: [],
    security: [],
    ...base,
    ...raw,
  } as LanguageConfig;
}

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Language configuration "${what}" is missing`);
  return value;
}

const RAW_BY_ID = new Map(RAW.map((r) => [r.id, r]));

export const LANGUAGES: readonly LanguageConfig[] = RAW.map((r) => resolve(r, RAW_BY_ID));

const BY_EXTENSION = new Map<string, LanguageConfig>();
for (const language of LANGUAGES) for (const ext of language.extensions) BY_EXTENSION.set(ext, language);

export function languageForPath(path: string): LanguageConfig | undefined {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return undefined;
  return BY_EXTENSION.get(path.slice(dot).toLowerCase());
}

/** The indicators a language is measured on. Size, complexity and nesting come with every grammar. */
export interface Coverage {
  size: true;
  complexity: true;
  nesting: true;
  coupling: boolean;
  cohesion: boolean;
  shortcuts: boolean;
  security: boolean;
}

export function coverageOf(language: LanguageConfig): Coverage {
  return {
    size: true,
    complexity: true,
    nesting: true,
    coupling: language.imports !== undefined || language.modules !== undefined,
    cohesion: language.cohesion !== undefined,
    shortcuts: language.shortcuts.length > 0,
    security: language.security.length > 0,
  };
}

/** Tier 1 is every indicator; a language that lacks one is Tier 2. */
export function isFullyCovered(language: LanguageConfig): boolean {
  const c = coverageOf(language);
  return c.coupling && c.cohesion && c.shortcuts && c.security;
}
