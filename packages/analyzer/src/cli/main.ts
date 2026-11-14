#!/usr/bin/env node
import { join, resolve } from "node:path";
import { METRICS } from "@factory-city/schema";
import { Command } from "commander";
import { ANALYZER_VERSION, analyze, slugFor, summaryLine } from "../analyze.js";
import { LANGUAGES } from "../languages/index.js";
import { outputRoot, updateIndex, writeAnalysis } from "../output.js";

const program = new Command();
program.name("factory-city").description("Turn a codebase into a 3D city.").version(ANALYZER_VERSION);

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

program
  .command("analyze")
  .description("Analyze a folder or repository and write a snapshot")
  .argument("[path]", "folder to analyze", ".")
  .option("--rev <rev>", "analyze a commit, tag or branch")
  .option("--dirty", "analyze the files on disk, including uncommitted changes")
  .option("--path <dir>", "restrict the analysis to a subfolder")
  .option("--all", "include every text file, with no default exclusion")
  .option("--include <glob>", "include files matching the glob (repeatable)", collect, [])
  .option("--exclude <glob>", "exclude files matching the glob (repeatable)", collect, [])
  .option("-o, --out <dir>", "output folder (default: ~/.factory-city/<project>)")
  .option("--json", "print machine-readable output")
  .action(async (path: string, opts: Record<string, unknown>) => {
    const folder = resolve(path);
    const result = await analyze({
      folder,
      rev: opts.rev as string | undefined,
      dirty: opts.dirty as boolean | undefined,
      path: opts.path as string | undefined,
      all: opts.all as boolean | undefined,
      include: opts.include as string[],
      exclude: opts.exclude as string[],
    });
    const slug = slugFor(folder);
    const dataDir = opts.out ? resolve(opts.out as string) : join(outputRoot(), slug);
    const written = await writeAnalysis(result, dataDir);
    if (!opts.out) {
      await updateIndex({
        slug,
        name: result.manifest.project,
        dataDir,
        updatedAt: new Date().toISOString(),
      });
    }
    if (opts.json) {
      console.log(JSON.stringify({ dataDir, ...written, manifest: result.manifest }, null, 2));
      return;
    }
    console.log(summaryLine(result.manifest));
    for (const warning of result.manifest.warnings) console.warn(`warning: ${warning}`);
    console.log(`Snapshot written to ${written.snapshotPath}`);
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

program.parseAsync().catch((err: unknown) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
