import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Optional `factory-city.config.json` at the root of the analyzed folder. Zero configuration works without it. */
export interface Config {
  windows: { recentDays: number; reworkDays: number };
  /** Extra regular expressions that mark a commit subject as a fix. */
  fixPatterns: string[];
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

export const FACT_FIELDS: readonly FactField[] = [
  "issue",
  "commit",
  "date",
  "agent",
  "model",
  "outcome",
  "estimate",
  "review_blockers",
  "review_majors",
  "rework_rounds",
  "minutes",
  "cost",
  "currency",
  "human_interventions",
];

export const DEFAULT_CONFIG: Config = {
  windows: { recentDays: 30, reworkDays: 14 },
  fixPatterns: [],
  issuePatterns: [],
  authorLabels: [],
  thresholds: {},
  estimatePatterns: [],
};

export async function loadConfig(folder: string): Promise<Config> {
  const path = join(folder, "factory-city.config.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return DEFAULT_CONFIG;
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(
      `${path} is not valid JSON. Fix it or delete it: Factory City works without a configuration file.`,
    );
  }
  const windows = (json.windows ?? {}) as Record<string, unknown>;
  const days = (key: string, fallback: number): number => {
    const v = windows[key];
    if (v === undefined) return fallback;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0)
      throw new Error(`${path}: windows.${key} must be a positive number of days.`);
    return v;
  };
  const thresholds = (): Config["thresholds"] => {
    const map = (json.thresholds ?? {}) as Record<string, unknown>;
    const ok =
      typeof map === "object" &&
      map !== null &&
      Object.values(map).every(
        (b) =>
          Array.isArray(b) &&
          b.length === 3 &&
          b.every((n) => typeof n === "number") &&
          Number(b[0]) <= Number(b[1]) &&
          Number(b[1]) <= Number(b[2]),
      );
    if (!ok) {
      throw new Error(
        `${path}: thresholds must map a dimension to three rising numbers, for example { "size": [200, 400, 750] }.`,
      );
    }
    return map as Config["thresholds"];
  };
  const authorLabels = (): Config["authorLabels"] => {
    const list = json.authorLabels ?? [];
    const ok =
      Array.isArray(list) &&
      list.every(
        (r) => r && typeof r === "object" && typeof r.pattern === "string" && typeof r.label === "string",
      );
    if (!ok) throw new Error(`${path}: authorLabels must be a list of { "pattern": "...", "label": "..." }.`);
    for (const rule of list as Config["authorLabels"]) {
      try {
        new RegExp(rule.pattern);
      } catch {
        throw new Error(`${path}: "${rule.pattern}" in authorLabels is not a valid regular expression.`);
      }
    }
    return list as Config["authorLabels"];
  };
  const patterns = (key: "fixPatterns" | "issuePatterns" | "estimatePatterns"): string[] => {
    const list = json[key] ?? [];
    if (!Array.isArray(list) || list.some((p) => typeof p !== "string")) {
      throw new Error(`${path}: ${key} must be a list of regular expressions written as strings.`);
    }
    for (const p of list as string[]) {
      try {
        new RegExp(p);
      } catch {
        throw new Error(`${path}: "${p}" in ${key} is not a valid regular expression.`);
      }
    }
    return list as string[];
  };
  return {
    windows: {
      recentDays: days("recentDays", DEFAULT_CONFIG.windows.recentDays),
      reworkDays: days("reworkDays", DEFAULT_CONFIG.windows.reworkDays),
    },
    fixPatterns: patterns("fixPatterns"),
    issuePatterns: patterns("issuePatterns"),
    authorLabels: authorLabels(),
    thresholds: thresholds(),
    estimatePatterns: patterns("estimatePatterns"),
    ...(json.facts === undefined ? {} : { facts: factsMapping(json.facts, path) }),
  };
}

/** Checks a facts mapping and returns it. The message says what to fix. */
export function factsMapping(raw: unknown, where: string): FactsMapping {
  const m = raw as FactsMapping | null;
  if (!m || typeof m !== "object" || typeof m.columns !== "object" || m.columns === null) {
    throw new Error(
      `${where}: facts must be an object with "columns", for example { "columns": { "issue": "issue", "agent": "agent" } }.`,
    );
  }
  for (const [field, ref] of Object.entries(m.columns)) {
    if (!FACT_FIELDS.includes(field as FactField)) {
      throw new Error(
        `${where}: facts.columns has an unknown field "${field}". Known fields: ${FACT_FIELDS.join(", ")}.`,
      );
    }
    if (typeof ref !== "string" && !(typeof ref === "number" && Number.isInteger(ref) && ref >= 1)) {
      throw new Error(
        `${where}: facts.columns.${field} must be a header name or a column position starting at 1.`,
      );
    }
  }
  if (m.columns.issue === undefined && m.columns.commit === undefined) {
    throw new Error(
      `${where}: facts.columns must map "issue" or "commit": each row is keyed by one of them.`,
    );
  }
  return m;
}
