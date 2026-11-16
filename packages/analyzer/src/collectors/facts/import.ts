import type { Fact, FactOutcome, Facts } from "@factory-city/schema";
import { type ColumnRef, FACT_FIELDS, type FactField, type FactsMapping } from "../../config.js";
import { readTable, type Table } from "./table.js";

const OUTCOMES: readonly FactOutcome[] = ["succeeded", "failed", "abandoned", "blocked"];
const NUMERIC = [
  "review_blockers",
  "review_majors",
  "rework_rounds",
  "minutes",
  "cost",
  "human_interventions",
] as const;

function columnIndex(ref: ColumnRef | undefined, names: readonly string[]): number {
  if (ref === undefined) return -1;
  if (typeof ref === "number") return ref - 1;
  return names.findIndex((n) => n.toLowerCase() === ref.toLowerCase());
}

function toNumber(raw: string): number | undefined {
  if (raw === "") return undefined;
  const n = Number(raw.replace(/[^\d.,-]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

/** Where each field is in the rows, and which columns are neither a field nor the filter: those become tags. */
interface Columns {
  col: Record<FactField, number>;
  filterAt: number;
  attemptAt: number;
  mapped: Set<number>;
}

/** The index of every mapped column; a column named in the mapping that the file lacks is an error. */
function resolveColumns(table: Table, mapping: FactsMapping): Columns {
  const index = (ref: ColumnRef | undefined) => columnIndex(ref, table.names);
  const col = Object.fromEntries(FACT_FIELDS.map((f) => [f, index(mapping.columns[f])])) as Record<
    FactField,
    number
  >;
  for (const [field, ref] of Object.entries(mapping.columns)) {
    if (typeof ref !== "string" || col[field as FactField] >= 0) continue;
    const found = table.names.length
      ? table.names.join(", ")
      : 'none: the file has no header line, so map columns by position or give "names"';
    throw new Error(
      `The facts file has no column named "${ref}" (mapped to "${field}"). Columns found: ${found}.`,
    );
  }
  return {
    col,
    filterAt: index(mapping.filter?.column),
    attemptAt: index(mapping.attempts?.column),
    mapped: new Set(Object.values(col).filter((i) => i >= 0)),
  };
}

/** Reads rows through the mapping: the cell of a field, with the values the mapping rewrites. */
function rowReader(c: Columns, mapping: FactsMapping) {
  return (row: string[], field: FactField): string => {
    const raw = c.col[field] >= 0 ? (row[c.col[field]] ?? "").trim() : "";
    return mapping.values?.[field]?.[raw] ?? raw;
  };
}

/** Whether a row is an attempt: every row is one, unless the mapping says which kinds are. */
function isAttemptRow(row: string[], c: Columns, mapping: FactsMapping): boolean {
  const rule = mapping.attempts;
  if (!rule) return true;
  const kind = c.attemptAt >= 0 ? (row[c.attemptAt] ?? "").trim() : "";
  return (rule.only ? rule.only.includes(kind) : true) && !(rule.not ?? []).includes(kind);
}

type Read = ReturnType<typeof rowReader>;

/** What a row adds to the fact of its issue: numbers are summed, the last text wins. */
function addRow(fact: Fact, row: string[], read: Read, attempt: boolean): void {
  for (const field of NUMERIC) {
    const n = toNumber(read(row, field));
    if (n !== undefined) fact[field] = (fact[field] ?? 0) + n;
  }
  const date = read(row, "date");
  if (date) fact.date = date;
  const currency = read(row, "currency");
  if (currency) fact.currency = currency;
  const estimate = read(row, "estimate");
  if (/^(XS|S|M|L|XL)$/i.test(estimate)) fact.estimate = estimate.toUpperCase();
  if (!attempt) return;
  fact.attempts++;
  const outcome = read(row, "outcome").toLowerCase();
  if (OUTCOMES.includes(outcome as FactOutcome)) {
    fact.outcome = outcome as FactOutcome;
    if (outcome === "succeeded") fact.succeeded_attempts++;
  }
  const agent = read(row, "agent");
  if (agent) fact.agent = agent;
  const model = read(row, "model");
  if (model) fact.model = model;
}

/** The columns that are neither a field nor the filter, kept as tags of the fact. */
function addTags(fact: Fact, row: string[], names: readonly string[], c: Columns): void {
  for (const [i, name] of names.entries()) {
    if (c.mapped.has(i) || i === c.filterAt || !name) continue;
    const value = (row[i] ?? "").trim();
    if (value) fact.tags[name] = value;
  }
}

function emptyFacts(now: Date): Facts {
  return {
    kind: "facts",
    schemaVersion: 1,
    createdAt: now.toISOString(),
    rows: { read: 0, kept: 0, skipped: 0 },
    fields: [],
    facts: [],
  };
}

/** The issue number and the commit a row is about; a row with neither is skipped. */
function subjectOf(row: string[], read: Read): { issue?: number; commit?: string } | undefined {
  const issueRaw = read(row, "issue").replace(/^#/, "");
  const issue = /^\d+$/.test(issueRaw) ? Number(issueRaw) : undefined;
  const commit = read(row, "commit") || undefined;
  if (issue === undefined && !commit) return undefined;
  return issue !== undefined ? { issue } : { commit };
}

/**
 * Imports a facts file with a mapping: which column is which field, which rows to keep, how raw values read,
 * and which rows are attempts. Several rows of one issue are merged: numbers are summed, the last attempt
 * gives the outcome, the agent and the model, and `attempts` counts the attempt rows.
 */
export function importFacts(text: string, mapping: FactsMapping, now = new Date()): Facts {
  const table = readTable(text, mapping);
  // an empty file holds no fact: nothing to check a mapping against
  if (table.rows.length === 0 && table.names.length === 0) return emptyFacts(now);
  const columns = resolveColumns(table, mapping);
  const read = rowReader(columns, mapping);
  const facts = new Map<string, Fact>();
  let kept = 0;
  let skipped = 0;
  for (const row of table.rows) {
    if (mapping.filter && !mapping.filter.values.includes((row[columns.filterAt] ?? "").trim())) continue;
    const subject = subjectOf(row, read);
    if (!subject) {
      skipped++;
      continue;
    }
    kept++;
    const key = subject.issue !== undefined ? `#${subject.issue}` : `@${subject.commit}`;
    const fact = facts.get(key) ?? { ...subject, attempts: 0, succeeded_attempts: 0, tags: {} };
    facts.set(key, fact);
    addRow(fact, row, read, isAttemptRow(row, columns, mapping));
    if (isAttemptRow(row, columns, mapping)) addTags(fact, row, table.names, columns);
  }
  const order = (f: Fact) => f.issue ?? Number.MAX_SAFE_INTEGER;
  return {
    kind: "facts",
    schemaVersion: 1,
    createdAt: now.toISOString(),
    rows: { read: table.rows.length, kept, skipped },
    fields: FACT_FIELDS.filter((f) => columns.col[f] >= 0),
    facts: [...facts.values()].sort(
      (a, b) => order(a) - order(b) || (a.commit ?? "").localeCompare(b.commit ?? ""),
    ),
  };
}
