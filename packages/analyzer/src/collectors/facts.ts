import type { Fact, FactOutcome, Facts } from "@factory-city/schema";
import { type ColumnRef, FACT_FIELDS, type FactField, type FactsMapping } from "../config.js";

const OUTCOMES: readonly FactOutcome[] = ["succeeded", "failed", "abandoned", "blocked"];
type NumericField =
  | "review_blockers"
  | "review_majors"
  | "rework_rounds"
  | "minutes"
  | "cost"
  | "human_interventions";
const NUMERIC: readonly NumericField[] = [
  "review_blockers",
  "review_majors",
  "rework_rounds",
  "minutes",
  "cost",
  "human_interventions",
];

/** Splits one line of delimited text; double quotes protect the delimiter and are doubled to escape. */
export function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delimiter) {
      out.push(cell.trim());
      cell = "";
    } else cell += c;
  }
  out.push(cell.trim());
  return out;
}

function guessDelimiter(line: string): string {
  const counts = [";", "\t", ","].map((d) => [d, line.split(d).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0]?.[0] ?? ",";
}

export interface Table {
  names: string[];
  rows: string[][];
}

/** Reads delimited text or JSON into rows of cells, with the names of the columns when known. */
export function readTable(text: string, mapping: FactsMapping): Table {
  const trimmed = text.replace(/^﻿/, "").trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as unknown;
    const holder = parsed as { facts?: unknown; rows?: unknown };
    const list = Array.isArray(parsed) ? parsed : (holder.rows ?? holder.facts);
    if (!Array.isArray(list)) {
      throw new Error(
        "A JSON facts file must be a list of rows, or an object with a `rows` or `facts` list.",
      );
    }
    const names: string[] = [];
    for (const row of list) {
      for (const key of Object.keys((row ?? {}) as object)) if (!names.includes(key)) names.push(key);
    }
    return {
      names,
      rows: list.map((row) => names.map((n) => String((row as Record<string, unknown>)[n] ?? ""))),
    };
  }
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { names: mapping.names ?? [], rows: [] };
  const delimiter =
    mapping.delimiter === "\\t" ? "\t" : (mapping.delimiter ?? guessDelimiter(lines[0] as string));
  const cells = lines.map((l) => splitLine(l, delimiter));
  const first = cells[0] as string[];
  // a header line holds names only: none of its cells starts like a number, a date or an issue reference
  const header =
    mapping.header ?? (mapping.names === undefined && first.every((c) => c !== "" && !/^[#\d]/.test(c)));
  return { names: header ? first : (mapping.names ?? []), rows: header ? cells.slice(1) : cells };
}

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

/** A mapping for a file whose header already uses the known field names: nothing to configure. */
export function autoMapping(text: string): FactsMapping | undefined {
  const { names } = readTable(text, { columns: {} });
  const columns: FactsMapping["columns"] = {};
  for (const field of FACT_FIELDS) {
    const name = names.find((n) => n.toLowerCase() === field);
    if (name) columns[field] = name;
  }
  return columns.issue !== undefined || columns.commit !== undefined ? { columns } : undefined;
}

/**
 * Imports a facts file with a mapping: which column is which field, which rows to keep, how raw values read,
 * and which rows are attempts. Several rows of one issue are merged: numbers are summed, the last attempt
 * gives the outcome, the agent and the model, and `attempts` counts the attempt rows.
 */
export function importFacts(text: string, mapping: FactsMapping, now = new Date()): Facts {
  const table = readTable(text, mapping);
  if (table.rows.length === 0 && table.names.length === 0) {
    // an empty file holds no fact: nothing to check a mapping against
    return {
      kind: "facts",
      schemaVersion: 1,
      createdAt: now.toISOString(),
      rows: { read: 0, kept: 0, skipped: 0 },
      fields: [],
      facts: [],
    };
  }
  const index = (ref: ColumnRef | undefined) => columnIndex(ref, table.names);
  const col = Object.fromEntries(FACT_FIELDS.map((f) => [f, index(mapping.columns[f])])) as Record<
    FactField,
    number
  >;
  for (const [field, ref] of Object.entries(mapping.columns)) {
    if (typeof ref === "string" && col[field as FactField] < 0) {
      const found = table.names.length
        ? table.names.join(", ")
        : 'none: the file has no header line, so map columns by position or give "names"';
      throw new Error(
        `The facts file has no column named "${ref}" (mapped to "${field}"). Columns found: ${found}.`,
      );
    }
  }
  const filterAt = index(mapping.filter?.column);
  const attemptAt = index(mapping.attempts?.column);
  const mapped = new Set(Object.values(col).filter((i) => i >= 0));
  const read = (row: string[], field: FactField): string => {
    const raw = col[field] >= 0 ? (row[col[field]] ?? "").trim() : "";
    return mapping.values?.[field]?.[raw] ?? raw;
  };

  const facts = new Map<string, Fact>();
  let kept = 0;
  let skipped = 0;
  for (const row of table.rows) {
    if (mapping.filter && !mapping.filter.values.includes((row[filterAt] ?? "").trim())) continue;
    const issueRaw = read(row, "issue").replace(/^#/, "");
    const issue = /^\d+$/.test(issueRaw) ? Number(issueRaw) : undefined;
    const commit = read(row, "commit") || undefined;
    if (issue === undefined && !commit) {
      skipped++;
      continue;
    }
    kept++;
    const key = issue !== undefined ? `#${issue}` : `@${commit}`;
    let fact = facts.get(key);
    if (!fact) {
      fact = {
        ...(issue !== undefined ? { issue } : { commit }),
        attempts: 0,
        succeeded_attempts: 0,
        tags: {},
      };
      facts.set(key, fact);
    }
    const kind = attemptAt >= 0 ? (row[attemptAt] ?? "").trim() : "";
    const rule = mapping.attempts;
    const isAttempt =
      !rule || ((rule.only ? rule.only.includes(kind) : true) && !(rule.not ?? []).includes(kind));
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
    if (!isAttempt) continue;
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
    for (const [i, name] of table.names.entries()) {
      if (mapped.has(i) || i === filterAt || !name) continue;
      const value = (row[i] ?? "").trim();
      if (value) fact.tags[name] = value;
    }
  }
  const order = (f: Fact) => f.issue ?? Number.MAX_SAFE_INTEGER;
  return {
    kind: "facts",
    schemaVersion: 1,
    createdAt: now.toISOString(),
    rows: { read: table.rows.length, kept, skipped },
    fields: FACT_FIELDS.filter((f) => col[f] >= 0),
    facts: [...facts.values()].sort(
      (a, b) => order(a) - order(b) || (a.commit ?? "").localeCompare(b.commit ?? ""),
    ),
  };
}
