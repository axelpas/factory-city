import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Facts } from "@factory-city/schema";
import { ANALYZER_VERSION, type CachedFile } from "../analyze.js";
import { autoMapping, importFacts } from "../collectors/facts.js";
import type { Config } from "../config.js";

/** Reads and imports the facts file given on the command line, or named in the configuration. */
export async function loadFacts(
  folder: string,
  given: string | undefined,
  config: Config,
): Promise<Facts | undefined> {
  const path = given ? resolve(given) : config.facts?.file ? resolve(folder, config.facts.file) : undefined;
  if (!path) return undefined;
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new Error(
      `The facts file ${path} could not be read. Check the path given to --facts or in factory-city.config.json.`,
    );
  }
  const mapping = config.facts ?? autoMapping(text);
  if (!mapping) {
    throw new Error(
      'The facts file needs a mapping: add "facts": { "columns": { "issue": "<column>", ... } } to factory-city.config.json, or name its columns after the known fields (issue, agent, model, outcome, minutes, cost...).',
    );
  }
  return importFacts(text, mapping);
}

export async function writeAtomic(path: string, content: string): Promise<void> {
  await writeFile(`${path}.tmp`, content);
  await rename(`${path}.tmp`, path);
}

export async function loadFileCache(path: string): Promise<Map<string, CachedFile>> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      version: string;
      entries: Array<[string, CachedFile]>;
    };
    if (parsed.version === ANALYZER_VERSION) return new Map(parsed.entries);
  } catch {
    // no cache yet, or unreadable: start empty
  }
  return new Map();
}
