import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  AnalysisManifest,
  CcJson,
  DependencyAudit,
  Factory,
  Report,
  TimelineManifest,
} from "@factory-city/schema";

/** Everything the viewer shows for one source of a project: what a standalone file embeds. */
export interface Bundle {
  manifest: AnalysisManifest | TimelineManifest;
  snapshots: CcJson[];
  report?: Report;
  factory?: Factory;
  /** Known vulnerabilities of the dependencies, from `analyze --with audit`. */
  dependencies?: DependencyAudit;
}

export const SOURCES = ["snapshot", "commit", "day", "issue", "revs", "diff"] as const;
export type SourceName = (typeof SOURCES)[number];

function manifestFile(source: SourceName): string {
  return source === "snapshot" ? "analysis.json" : `timeline.${source}.json`;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

/** The sources a data folder holds, most recently written first. */
export async function listSources(
  dataDir: string,
): Promise<Array<{ source: SourceName; createdAt: string }>> {
  const out: Array<{ source: SourceName; createdAt: string }> = [];
  for (const source of SOURCES) {
    const path = join(dataDir, manifestFile(source));
    if (!existsSync(path)) continue;
    const manifest = await readJson<{ createdAt?: string }>(path);
    out.push({ source, createdAt: manifest.createdAt ?? "" });
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Loads one source of a data folder; without a name, the most recently written one. */
export async function loadBundle(dataDir: string, source?: string): Promise<Bundle & { source: SourceName }> {
  const available = await listSources(dataDir);
  if (available.length === 0) {
    throw new Error(
      `No analysis found in ${dataDir}. Run \`factory-city analyze\` or \`factory-city timeline\` first.`,
    );
  }
  const chosen = source ? available.find((s) => s.source === source) : available[0];
  if (!chosen) {
    throw new Error(
      `No "${source}" data in ${dataDir}. Available: ${available.map((s) => s.source).join(", ")}.`,
    );
  }
  const manifest = await readJson<AnalysisManifest | TimelineManifest>(
    join(dataDir, manifestFile(chosen.source)),
  );
  const files = manifest.kind === "timeline" ? manifest.frames.map((f) => f.snapshot) : [manifest.snapshot];
  const snapshots: CcJson[] = [];
  for (const file of files) snapshots.push(await readJson<CcJson>(join(dataDir, file)));
  const reportPath = join(
    dataDir,
    manifest.kind === "timeline" ? `report.${chosen.source}.json` : "report.json",
  );
  const factoryPath = join(dataDir, "factory.json");
  const dependenciesPath = join(dataDir, "dependencies.json");
  return {
    source: chosen.source,
    manifest,
    snapshots,
    ...(existsSync(reportPath) ? { report: await readJson<Report>(reportPath) } : {}),
    ...(chosen.source === "issue" && existsSync(factoryPath)
      ? { factory: await readJson<Factory>(factoryPath) }
      : {}),
    ...(existsSync(dependenciesPath)
      ? { dependencies: await readJson<DependencyAudit>(dependenciesPath) }
      : {}),
  };
}

/** Writes a bundle as a data folder in a temporary place, so that a browser can be pointed at it. */
export async function writeBundle(bundle: Bundle, source: SourceName): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "factory-city-"));
  const { manifest } = bundle;
  const files = manifest.kind === "timeline" ? manifest.frames.map((f) => f.snapshot) : [manifest.snapshot];
  await writeFile(join(dir, manifestFile(source)), JSON.stringify(manifest));
  for (const [i, file] of files.entries()) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), JSON.stringify(bundle.snapshots[i]));
  }
  if (bundle.report) {
    await writeFile(
      join(dir, manifest.kind === "timeline" ? `report.${source}.json` : "report.json"),
      JSON.stringify(bundle.report),
    );
  }
  if (bundle.factory) await writeFile(join(dir, "factory.json"), JSON.stringify(bundle.factory));
  if (bundle.dependencies)
    await writeFile(join(dir, "dependencies.json"), JSON.stringify(bundle.dependencies));
  return dir;
}
