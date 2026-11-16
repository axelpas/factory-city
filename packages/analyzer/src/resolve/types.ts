export interface TsConfig {
  /** Folder that bases `paths`, relative to the analyzed folder. */
  base: string;
  paths: Record<string, string[]>;
  baseUrl?: string;
}

export interface Pkg {
  dir: string;
  main?: string;
}

export interface ResolveContext {
  files: ReadonlySet<string>;
  /** Nearest-config lookup by folder. */
  configs: Map<string, TsConfig>;
  packages: Map<string, Pkg>;
}
