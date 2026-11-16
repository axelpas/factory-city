import type { FactsMapping } from "../../config.js";

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

/** A JSON file: a list of rows, or an object with a `rows` or `facts` list. */
function readJsonTable(text: string): Table {
  const parsed = JSON.parse(text) as unknown;
  const holder = parsed as { facts?: unknown; rows?: unknown };
  const list = Array.isArray(parsed) ? parsed : (holder.rows ?? holder.facts);
  if (!Array.isArray(list))
    throw new Error("A JSON facts file must be a list of rows, or an object with a `rows` or `facts` list.");
  const names = [...new Set(list.flatMap((row) => Object.keys((row ?? {}) as object)))];
  return {
    names,
    rows: list.map((row) => names.map((n) => String((row as Record<string, unknown>)[n] ?? ""))),
  };
}

/** Delimited text, with a header line when the first line holds names only. */
function readDelimitedTable(text: string, mapping: FactsMapping): Table {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
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

/** Reads delimited text or JSON into rows of cells, with the names of the columns when known. */
export function readTable(text: string, mapping: FactsMapping): Table {
  const trimmed = text.replace(/^﻿/, "").trim();
  return trimmed.startsWith("[") || trimmed.startsWith("{")
    ? readJsonTable(trimmed)
    : readDelimitedTable(trimmed, mapping);
}
