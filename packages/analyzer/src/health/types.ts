/** What the health computation needs to know about one file. */
export interface HealthFile {
  path: string;
  values: Record<string, number>;
  isTest: boolean;
}

/** Things the report can name: the declarations of each cohesion group, the links between files. */
export interface HealthExtras {
  /** File path to its cohesion groups, each a list of declaration names. */
  groups?: ReadonlyMap<string, string[][]>;
  /** Internal import links, as [from, to]. */
  imports?: ReadonlyArray<readonly [string, string]>;
  /** Pairs of files that usually change together. */
  coChange?: ReadonlyArray<readonly [string, string]>;
  /** File path to the file it shares the most copied lines with. */
  duplicates?: ReadonlyMap<string, string>;
}
