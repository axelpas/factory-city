import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { authorLabelsOf, days, factsMapping, patternsOf, thresholdsOf } from "./config-checks.js";

/** Optional `factory-city.config.json` at the root of the analyzed folder. Zero configuration works without it. */
export interface Config {
  windows: { recentDays: number; reworkDays: number };
  /** Extra regular expressions that mark a commit subject as a fix. */
  fixPatterns: string[];
  /** Extra regular expressions on a commit subject that mark a security fix (added to the defaults). */
  securityFixPatterns: string[];
  /** Extra regular expressions on a file path that mark sensitive code (added to the defaults). */
  sensitivePatterns: string[];
  /** Extra regular expressions that find an issue number in a commit message; group 1 is the number. */
  issuePatterns: string[];
  /** Author labels: the first rule whose pattern matches "Name <email>" gives the label. */
  authorLabels: Array<{ pattern: string; label: string }>;
  /** Risk thresholds by dimension id: the upper bounds of low, moderate and high. */
  thresholds: Record<string, [number, number, number]>;
  /** Regular expressions read on issue labels; group 1 is the size (S, M, L, XL). */
  estimatePatterns: string[];
  /** How to read the facts file. */
  facts?: FactsMapping;
}

/** A column of the facts file: its header name, or its position starting at 1. */
export type ColumnRef = string | number;

/** Mapping of a facts file (delimited text or JSON) to the known fields. Configuration alone handles any shape. */
export interface FactsMapping {
  /** Path of the facts file, relative to the analyzed folder; `--facts` overrides it. */
  file?: string;
  /** `,`, `;` or `\\t`. Guessed from the first line when absent. */
  delimiter?: string;
  /** Whether the first line is a header. Guessed when absent. */
  header?: boolean;
  /** Names of the columns when the file has no header line, in order. */
  names?: string[];
  /** Known field to column. */
  columns: Partial<Record<FactField, ColumnRef>>;
  /** Keep only the rows where a column has one of these values. */
  filter?: { column: ColumnRef; values: string[] };
  /** Raw values to known ones, per field. */
  values?: Partial<Record<FactField, Record<string, string>>>;
  /** Tells attempt rows from other rows (reviews). */
  attempts?: { column: ColumnRef; only?: string[]; not?: string[] };
}

export type FactField =
  | "issue"
  | "commit"
  | "date"
  | "agent"
  | "model"
  | "outcome"
  | "estimate"
  | "review_blockers"
  | "review_majors"
  | "rework_rounds"
  | "minutes"
  | "cost"
  | "currency"
  | "human_interventions";

export const DEFAULT_CONFIG: Config = {
  windows: { recentDays: 30, reworkDays: 14 },
  fixPatterns: [],
  securityFixPatterns: [],
  sensitivePatterns: [],
  issuePatterns: [],
  authorLabels: [],
  thresholds: {},
  estimatePatterns: [],
};

/** Reads the configuration file as JSON; an absent file is no configuration, a broken one is an error. */
async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(
      `${path} is not valid JSON. Fix it or delete it: Factory City works without a configuration file.`,
    );
  }
}

export async function loadConfig(folder: string): Promise<Config> {
  const path = join(folder, "factory-city.config.json");
  const json = await readJson(path);
  if (!json) return DEFAULT_CONFIG;
  const windows = (json.windows ?? {}) as Record<string, unknown>;
  return {
    windows: {
      recentDays: days(windows, "recentDays", DEFAULT_CONFIG.windows.recentDays, path),
      reworkDays: days(windows, "reworkDays", DEFAULT_CONFIG.windows.reworkDays, path),
    },
    fixPatterns: patternsOf(json, "fixPatterns", path),
    securityFixPatterns: patternsOf(json, "securityFixPatterns", path),
    sensitivePatterns: patternsOf(json, "sensitivePatterns", path),
    issuePatterns: patternsOf(json, "issuePatterns", path),
    authorLabels: authorLabelsOf(json, path),
    thresholds: thresholdsOf(json, path),
    estimatePatterns: patternsOf(json, "estimatePatterns", path),
    ...(json.facts === undefined ? {} : { facts: factsMapping(json.facts, path) }),
  };
}

export { FACT_FIELDS, factsMapping } from "./config-checks.js";
