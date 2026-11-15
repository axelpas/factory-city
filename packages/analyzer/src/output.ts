import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AnalysisResult } from "./analyze.js";

/** Root of all analysis output: `~/.factory-city`, or `$FACTORY_CITY_HOME`. */
export function outputRoot(): string {
  return process.env.FACTORY_CITY_HOME ?? join(homedir(), ".factory-city");
}

export interface IndexEntry {
  slug: string;
  name: string;
  dataDir: string;
  updatedAt: string;
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}

export async function writeAnalysis(
  result: AnalysisResult,
  dataDir: string,
): Promise<{ snapshotPath: string; manifestPath: string }> {
  await mkdir(dataDir, { recursive: true });
  const snapshotPath = join(dataDir, result.manifest.snapshot);
  const manifestPath = join(dataDir, "analysis.json");
  await writeAtomic(snapshotPath, JSON.stringify(result.snapshot));
  await writeAtomic(manifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`);
  await writeAtomic(join(dataDir, "report.json"), `${JSON.stringify(result.report, null, 2)}\n`);
  return { snapshotPath, manifestPath };
}

/** Records an analyzed project in `index.json`, for the viewer's project switcher. */
export async function updateIndex(entry: IndexEntry): Promise<void> {
  const root = outputRoot();
  await mkdir(root, { recursive: true });
  const path = join(root, "index.json");
  let projects: IndexEntry[] = [];
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as { projects?: IndexEntry[] };
    projects = parsed.projects ?? [];
  } catch {
    // no index yet, or unreadable: start a new one
  }
  projects = [...projects.filter((p) => p.slug !== entry.slug), entry].sort((a, b) =>
    a.slug < b.slug ? -1 : 1,
  );
  await writeAtomic(path, `${JSON.stringify({ version: 1, projects }, null, 2)}\n`);
}

export async function readIndex(): Promise<IndexEntry[]> {
  try {
    const parsed = JSON.parse(await readFile(join(outputRoot(), "index.json"), "utf8")) as {
      projects?: IndexEntry[];
    };
    return parsed.projects ?? [];
  } catch {
    return [];
  }
}
