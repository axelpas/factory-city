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
  /** The Go modules of the project: the folder of each `go.mod`, with the module path it declares. */
  goModules: ReadonlyMap<string, string>;
}
