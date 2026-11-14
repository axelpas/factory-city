#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { METRICS } from "@factory-city/schema";
import { Command } from "commander";
import { ANALYZER_VERSION, analyze, slugFor, summaryLine } from "../analyze.js";
import { doctor } from "../doctor.js";
import { LANGUAGES } from "../languages/index.js";
import { outputRoot, readIndex, updateIndex, writeAnalysis } from "../output.js";
import { defaultViewerDir, openBrowser, startServer } from "../server.js";

const program = new Command();
program.name("factory-city").description("Turn a codebase into a 3D city.").version(ANALYZER_VERSION);

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

interface AnalyzeFlags {
  rev?: string;
  dirty?: boolean;
  path?: string;
  all?: boolean;
  include?: string[];
  exclude?: string[];
  out?: string;
  json?: boolean;
}

/** Analyzes a folder, writes the snapshot, and returns where it went. */
async function analyzeAndWrite(path: string, opts: AnalyzeFlags, quiet = false) {
  const folder = resolve(path);
  const result = await analyze({
    folder,
    rev: opts.rev,
    dirty: opts.dirty,
    path: opts.path,
    all: opts.all,
    include: opts.include,
    exclude: opts.exclude,
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

function withAnalyzeOptions(cmd: Command): Command {
  return cmd
    .option("--rev <rev>", "analyze a commit, tag or branch")
    .option("--dirty", "analyze the files on disk, including uncommitted changes")
    .option("--path <dir>", "restrict the analysis to a subfolder")
    .option("--all", "include every text file, with no default exclusion")
    .option("--include <glob>", "include files matching the glob (repeatable)", collect, [])
    .option("--exclude <glob>", "exclude files matching the glob (repeatable)", collect, [])
    .option("-o, --out <dir>", "output folder (default: ~/.factory-city/<project>)")
    .option("--json", "print machine-readable output");
}

withAnalyzeOptions(
  program
    .command("analyze")
    .description("Analyze a folder or repository and write a snapshot")
    .argument("[path]", "folder to analyze", "."),
).action(async (path: string, opts: AnalyzeFlags) => {
  const { result, written, dataDir } = await analyzeAndWrite(path, opts);
  if (opts.json) console.log(JSON.stringify({ dataDir, ...written, manifest: result.manifest }, null, 2));
});

async function serve(
  entry: { slug: string; name: string; dataDir: string; updatedAt: string },
  opts: { port?: string; open: boolean; json?: boolean },
) {
  const server = await startServer({
    viewerDir: defaultViewerDir(),
    current: entry.slug,
    port: opts.port ? Number(opts.port) : undefined,
    extra: [entry],
  });
  if (opts.json) console.log(JSON.stringify({ url: server.url, slug: entry.slug }));
  else console.log(`Factory City is running at ${server.url} (Ctrl+C to stop)`);
  if (opts.open) openBrowser(server.url);
}

program
  .command("view")
  .description("Serve the viewer on a data folder and open the browser")
  .argument("[dataDir]", "folder holding analysis.json (default: the latest analyzed project)")
  .option("--port <n>", "port to listen on (localhost only)")
  .option("--no-open", "do not open the browser")
  .option("--json", "print machine-readable output")
  .action(async (dataDir: string | undefined, opts: { port?: string; open: boolean; json?: boolean }) => {
    let entry: { slug: string; name: string; dataDir: string; updatedAt: string } | undefined;
    if (dataDir) {
      const dir = resolve(dataDir);
      if (!existsSync(join(dir, "analysis.json")))
        throw new Error(
          `No analysis.json in ${dir}. Run \`factory-city analyze\` first, or pass the folder written by it.`,
        );
      entry = {
        slug: slugFor(dir),
        name: dir.split(/[\\/]/).pop() ?? "project",
        dataDir: dir,
        updatedAt: new Date().toISOString(),
      };
    } else {
      const index = await readIndex();
      entry = [...index].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
      if (!entry)
        throw new Error(
          "No analyzed project yet. Run `factory-city` in a folder to analyze it and open the city.",
        );
    }
    await serve(entry, opts);
  });

withAnalyzeOptions(
  program
    .command("open", { isDefault: true })
    .description("Analyze a folder and open its city (default command)")
    .argument("[path]", "folder to analyze", "."),
)
  .option("--port <n>", "port to listen on (localhost only)")
  .option("--no-open", "do not open the browser")
  .action(async (path: string, opts: AnalyzeFlags & { port?: string; open: boolean }) => {
    const { entry } = await analyzeAndWrite(path, opts);
    await serve(entry, opts);
  });

program
  .command("metrics")
  .description("List the metrics, their definition and the data level they need")
  .option("--json", "print machine-readable output")
  .action((opts: { json?: boolean }) => {
    if (opts.json) {
      console.log(JSON.stringify(METRICS, null, 2));
      return;
    }
    for (const m of METRICS) console.log(`${m.id.padEnd(26)} level ${m.level}  ${m.definition}`);
  });

program
  .command("languages")
  .description("List the supported languages")
  .option("--json", "print machine-readable output")
  .action((opts: { json?: boolean }) => {
    if (opts.json) {
      console.log(
        JSON.stringify(
          LANGUAGES.map(({ id, label, tier, extensions }) => ({ id, label, tier, extensions })),
          null,
          2,
        ),
      );
      return;
    }
    for (const l of LANGUAGES) console.log(`${l.label.padEnd(12)} tier ${l.tier}  ${l.extensions.join(" ")}`);
  });

program
  .command("doctor")
  .description("Print the data level reached and the one action that unlocks the next")
  .argument("[path]", "folder to check", ".")
  .option("--json", "print machine-readable output")
  .action(async (path: string, opts: { json?: boolean }) => {
    const report = await doctor(path);
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`Data level ${report.level} (${report.levelName})`);
    for (const c of report.checks) console.log(`  ${c.ok ? "ok" : "--"}  ${c.name}: ${c.detail}`);
    console.log(`Next: ${report.next}`);
  });

program.parseAsync().catch((err: unknown) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
