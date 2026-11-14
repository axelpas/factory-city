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
