import { join, resolve } from "node:path";
import type { Command } from "commander";
import { analyze, slugFor, summaryLine } from "../analyze.js";
import { outputRoot, updateIndex, writeAnalysis } from "../output.js";
import { defaultViewerDir, openBrowser, startServer } from "../server.js";

export function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export interface AnalyzeFlags {
  rev?: string;
  dirty?: boolean;
  path?: string;
  all?: boolean;
  include?: string[];
  exclude?: string[];
  with?: string[];
  sarif?: string[];
  offline?: boolean;
  out?: string;
  json?: boolean;
}

/** Optional collectors, asked for with `--with`. */
const FEATURES = ["duplication", "audit"];

export function features(opts: AnalyzeFlags): Set<string> {
  const asked = new Set(opts.with ?? []);
  for (const feature of asked) {
    if (!FEATURES.includes(feature))
      throw new Error(`Unknown --with value "${feature}". Available: ${FEATURES.join(", ")}.`);
  }
  return asked;
}

/** Analyzes a folder, writes the snapshot, and returns where it went. */
export async function analyzeAndWrite(path: string, opts: AnalyzeFlags, quiet = false) {
  const folder = resolve(path);
  const result = await analyze({
    folder,
    rev: opts.rev,
    dirty: opts.dirty,
    path: opts.path,
    all: opts.all,
    include: opts.include,
    exclude: opts.exclude,
    duplication: features(opts).has("duplication"),
    sarif: (opts.sarif ?? []).map((f) => resolve(f)),
    audit: features(opts).has("audit"),
    offline: opts.offline,
    log: (line) => {
      if (!opts.json) console.error(line);
    },
  });
  const slug = slugFor(folder);
  const dataDir = opts.out ? resolve(opts.out) : join(outputRoot(), slug);
  const written = await writeAnalysis(result, dataDir);
  const entry = { slug, name: result.manifest.project, dataDir, updatedAt: new Date().toISOString() };
  if (!opts.out) await updateIndex(entry);
  if (!quiet && !opts.json) {
    console.log(summaryLine(result.manifest));
    for (const warning of result.manifest.warnings) console.warn(`warning: ${warning}`);
    console.log(`Snapshot written to ${written.snapshotPath}`);
  }
  return { result, written, entry, dataDir };
}

export function withAnalyzeOptions(cmd: Command): Command {
  return cmd
    .option("--rev <rev>", "analyze a commit, tag or branch")
    .option("--dirty", "analyze the files on disk, including uncommitted changes")
    .option("--path <dir>", "restrict the analysis to a subfolder")
    .option("--all", "include every text file, with no default exclusion")
    .option("--include <glob>", "include files matching the glob (repeatable)", collect, [])
    .option("--exclude <glob>", "exclude files matching the glob (repeatable)", collect, [])
    .option(
      "--with <feature>",
      "add an optional collector: duplication, audit (repeatable); audit sends package names and versions to api.osv.dev",
      collect,
      [],
    )
    .option(
      "--sarif <file>",
      "read the results of a scanner from its SARIF file (repeatable); nothing is run",
      collect,
      [],
    )
    .option("--offline", "no network: refuses --with audit")
    .option("-o, --out <dir>", "output folder (default: ~/.factory-city/<project>)")
    .option("--json", "print machine-readable output");
}

export async function serve(
  entry: { slug: string; name: string; dataDir: string; updatedAt: string },
  opts: { port?: string; open: boolean; json?: boolean },
  query = "",
) {
  const server = await startServer({
    viewerDir: defaultViewerDir(),
    current: entry.slug,
    port: opts.port ? Number(opts.port) : undefined,
    extra: [entry],
  });
  if (opts.json) console.log(JSON.stringify({ url: server.url, slug: entry.slug }));
  else console.log(`Factory City is running at ${server.url} (Ctrl+C to stop)`);
  if (opts.open) openBrowser(`${server.url}${query}`);
}
