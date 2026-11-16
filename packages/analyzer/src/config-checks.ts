import type { Config, FactField, FactsMapping } from "./config.js";

type Json = Record<string, unknown>;

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

/** A length of time in days: positive, or the default when not given. */
export function days(windows: Json, key: string, fallback: number, path: string): number {
  const v = windows[key];
  if (v === undefined) return fallback;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0)
    throw new Error(`${path}: windows.${key} must be a positive number of days.`);
  return v;
}

/** Three numbers that do not go down: the bounds of low, moderate and high. */
function isBounds(b: unknown): boolean {
  return (
    Array.isArray(b) &&
    b.length === 3 &&
    b.every((n) => typeof n === "number") &&
    Number(b[0]) <= Number(b[1]) &&
    Number(b[1]) <= Number(b[2])
  );
}

export function thresholdsOf(json: Json, path: string): Config["thresholds"] {
  const map = (json.thresholds ?? {}) as Record<string, unknown>;
  if (typeof map !== "object" || map === null || !Object.values(map).every(isBounds)) {
    throw new Error(
      `${path}: thresholds must map a dimension to three rising numbers, for example { "size": [200, 400, 750] }.`,
    );
  }
  return map as Config["thresholds"];
}

function isRegExp(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

export function authorLabelsOf(json: Json, path: string): Config["authorLabels"] {
  const list = json.authorLabels ?? [];
  const ok =
    Array.isArray(list) &&
    list.every(
      (r) => r && typeof r === "object" && typeof r.pattern === "string" && typeof r.label === "string",
    );
  if (!ok) throw new Error(`${path}: authorLabels must be a list of { "pattern": "...", "label": "..." }.`);
  const bad = (list as Config["authorLabels"]).find((rule) => !isRegExp(rule.pattern));
  if (bad) throw new Error(`${path}: "${bad.pattern}" in authorLabels is not a valid regular expression.`);
  return list as Config["authorLabels"];
}

export function patternsOf(json: Json, key: string, path: string): string[] {
  const list = json[key] ?? [];
  if (!Array.isArray(list) || list.some((p) => typeof p !== "string"))
    throw new Error(`${path}: ${key} must be a list of regular expressions written as strings.`);
  const bad = (list as string[]).find((p) => !isRegExp(p));
  if (bad !== undefined) throw new Error(`${path}: "${bad}" in ${key} is not a valid regular expression.`);
  return list as string[];
}

/** A column is a header name, or a position starting at 1. */
function isColumnRef(ref: unknown): boolean {
  return typeof ref === "string" || (typeof ref === "number" && Number.isInteger(ref) && ref >= 1);
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
    if (!FACT_FIELDS.includes(field as FactField))
      throw new Error(
        `${where}: facts.columns has an unknown field "${field}". Known fields: ${FACT_FIELDS.join(", ")}.`,
      );
    if (!isColumnRef(ref))
      throw new Error(
        `${where}: facts.columns.${field} must be a header name or a column position starting at 1.`,
      );
  }
  if (m.columns.issue === undefined && m.columns.commit === undefined)
    throw new Error(
      `${where}: facts.columns must map "issue" or "commit": each row is keyed by one of them.`,
    );
  return m;
}
