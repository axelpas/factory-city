import javascript from "./javascript.json" with { type: "json" };
import tsx from "./tsx.json" with { type: "json" };
import typescript from "./typescript.json" with { type: "json" };

/** Declarative language configuration: which syntax nodes count as what. No language-specific engine code. */
export interface LanguageConfig {
  id: string;
  label: string;
  tier: 1 | 2;
  /** Grammar file name without prefix, e.g. `typescript` for `tree-sitter-typescript.wasm`. */
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
  /** Which syntax nodes make up the file's units for cohesion; absent when cohesion is unavailable. */
  cohesion?: CohesionConfig;
  /** Declarative rules for places where a check was silenced. */
  shortcuts: ShortcutRule[];
}

export interface ImportsConfig {
  /** Statement nodes carrying the module in `sourceField` (import, export-from). */
  statements: string[];
  sourceField: string;
  calls: { nodeType: string; functionField: string; argumentsField: string; callees: string[] };
}

export interface CohesionConfig {
  wrappers: string[];
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
  selfObject: string;
  barrelStatements: string[];
  /** Two functions whose names start with the same word of at least this length are linked. */
  minStemLength: number;
}

/** One shortcut kind. `comment` matches comment text, `node` matches a node type and its text, `call` matches the callee, `emptyBlock` matches a node whose body has no statement. */
export interface ShortcutRule {
  kind: string;
  type: "comment" | "node" | "call" | "emptyBlock";
  pattern?: string;
  nodeType?: string;
  bodyField?: string;
}

type RawConfig = Partial<LanguageConfig> &
  Pick<LanguageConfig, "id" | "label" | "tier" | "grammar" | "extensions"> & {
    extends?: string;
  };

const RAW: RawConfig[] = [typescript as RawConfig, tsx as RawConfig, javascript as RawConfig];

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
