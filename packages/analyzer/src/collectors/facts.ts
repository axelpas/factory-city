import type { FactsMapping } from "../config.js";
import { FACT_FIELDS } from "../config.js";
import { readTable } from "./facts/table.js";

export { importFacts } from "./facts/import.js";
export { readTable, splitLine, type Table } from "./facts/table.js";

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
