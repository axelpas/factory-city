import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { slugFor } from "../../analyze.js";
import { readIndex } from "../../output.js";
import { type AnalyzeFlags, analyzeAndWrite, serve, withAnalyzeOptions } from "../shared.js";

const MANIFESTS = [
  "analysis.json",
  "timeline.commit.json",
  "timeline.day.json",
  "timeline.issue.json",
  "timeline.revs.json",
];

type Entry = { slug: string; name: string; dataDir: string; updatedAt: string };

/** The data to show: the folder given, or the project analyzed last. */
async function viewTarget(dataDir: string | undefined): Promise<Entry> {
  if (dataDir) {
    const dir = resolve(dataDir);
    if (!MANIFESTS.some((f) => existsSync(join(dir, f))))
      throw new Error(
        `No analysis.json or timeline in ${dir}. Run \`factory-city analyze\` first, or pass the folder written by it.`,
      );
    return {
      slug: slugFor(dir),
      name: dir.split(/[\\/]/).pop() ?? "project",
      dataDir: dir,
      updatedAt: new Date().toISOString(),
    };
  }
  const latest = [...(await readIndex())].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
  if (!latest)
    throw new Error(
      "No analyzed project yet. Run `factory-city` in a folder to analyze it and open the city.",
    );
  return latest;
}

/** Registers the commands of this module on the program. */
export function registerOpen(program: Command): void {
  withAnalyzeOptions(
    program
      .command("analyze")
      .description("Analyze a folder or repository and write a snapshot")
      .argument("[path]", "folder to analyze", "."),
  ).action(async (path: string, opts: AnalyzeFlags) => {
    const { result, written, dataDir } = await analyzeAndWrite(path, opts);
    if (opts.json) console.log(JSON.stringify({ dataDir, ...written, manifest: result.manifest }, null, 2));
  });
  program
    .command("view")
    .description("Serve the viewer on a data folder and open the browser")
    .argument("[dataDir]", "folder holding analysis.json (default: the latest analyzed project)")
    .option("--port <n>", "port to listen on (localhost only)")
    .option("--no-open", "do not open the browser")
    .option("--json", "print machine-readable output")
    .action(async (dataDir: string | undefined, opts: { port?: string; open: boolean; json?: boolean }) => {
      await serve(await viewTarget(dataDir), opts);
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
}
