import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { slugFor } from "../../analyze.js";
import { coverageLine } from "../../collectors/issues.js";
import { buildDiff, diffText } from "../../diff.js";
import { outputRoot, updateIndex } from "../../output.js";
import { parseSize, renderImage } from "../../render.js";
import { buildTimeline, type TimelineOptions } from "../../timeline.js";
import { collect, serve } from "../shared.js";

type Options = Record<string, unknown>;

/** The options of `timeline` as checked values. */
function timelineOptions(opts: Options, folder: string, quiet: boolean): TimelineOptions {
  const by = opts.by as string;
  if (by !== "commit" && by !== "day" && by !== "issue")
    throw new Error(`Unknown --by "${by}". Use commit, issue or day.`);
  const maxFrames = opts.maxFrames === undefined ? undefined : Number(opts.maxFrames);
  if (maxFrames !== undefined && (!Number.isInteger(maxFrames) || maxFrames < 2))
    throw new Error("--max-frames must be a whole number of at least 2.");
  const revs =
    typeof opts.revs === "string"
      ? opts.revs
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean)
      : undefined;
  return {
    folder,
    by,
    branch: opts.branch as string | undefined,
    allCommits: opts.allCommits as boolean | undefined,
    since: opts.since as string | undefined,
    until: opts.until as string | undefined,
    range: opts.range as string | undefined,
    revs,
    maxFrames,
    offline: opts.offline as boolean | undefined,
    facts: opts.facts as string | undefined,
    path: opts.path as string | undefined,
    all: opts.all as boolean | undefined,
    include: opts.include as string[],
    exclude: opts.exclude as string[],
    onProgress: quiet ? undefined : (done, total) => process.stderr.write(`\rframe ${done}/${total}`),
  };
}

type TimelineBuilt = Awaited<ReturnType<typeof buildTimeline>>;

function printTimeline(result: TimelineBuilt, dataDir: string, seconds: number): void {
  const sampled = result.manifest.source.sampledFrom
    ? ` (sampled from ${result.manifest.source.sampledFrom})`
    : "";
  console.log(
    `Timeline of ${result.manifest.frames.length} frames${sampled} written to ${dataDir} in ${seconds.toFixed(1)} s.`,
  );
  console.log(`Parsed ${result.cache.parsed} file contents, reused ${result.cache.reused} from the cache.`);
  if (result.manifest.coverage) console.log(coverageLine(result.manifest.coverage));
  for (const warning of result.manifest.warnings) console.warn(`warning: ${warning}`);
  console.log("Run `factory-city view` to play it.");
}

async function runTimeline(repoPath: string, opts: Options): Promise<void> {
  const folder = resolve(repoPath);
  const quiet = Boolean(opts.json) || !process.stderr.isTTY;
  const options = timelineOptions(opts, folder, quiet);
  const slug = slugFor(folder);
  const dataDir = opts.out ? resolve(opts.out as string) : join(outputRoot(), slug);
  const started = Date.now();
  const result = await buildTimeline(options, dataDir);
  if (!quiet) process.stderr.write("\n");
  if (!opts.out)
    await updateIndex({ slug, name: result.manifest.project, dataDir, updatedAt: new Date().toISOString() });
  const seconds = (Date.now() - started) / 1000;
  if (!opts.json) return printTimeline(result, dataDir, seconds);
  const summary = {
    dataDir,
    frames: result.manifest.frames.length,
    seconds,
    cache: result.cache,
    dataLevel: result.manifest.dataLevel,
  };
  console.log(JSON.stringify(summary, null, 2));
}

/** `[repo] [base] [head]`: the repository is the first argument when it is a folder, else the current one. */
function splitDiffArgs(args: string[]): { repoPath: string; base?: string; head?: string } {
  const rest = [...args];
  const first = rest[0];
  const isFolder = first !== undefined && existsSync(first) && statSync(first).isDirectory();
  const repoPath = isFolder ? (rest.shift() as string) : ".";
  return { repoPath, base: rest[0], head: rest[1] };
}

async function runDiff(args: string[], opts: Options): Promise<void> {
  const { repoPath, base, head } = splitDiffArgs(args);
  const folder = resolve(repoPath);
  const slug = slugFor(folder);
  const dataDir = opts.out ? resolve(opts.out as string) : join(outputRoot(), slug);
  const result = await buildDiff({ folder, base, head, top: Number(opts.top) || 10 }, dataDir);
  const entry = { slug, name: result.manifest.project, dataDir, updatedAt: new Date().toISOString() };
  if (!opts.out) await updateIndex(entry);
  if (opts.json) console.log(JSON.stringify(result.summary, null, 2));
  else console.log(diffText(result.summary));
  for (const warning of result.manifest.warnings) console.warn(`warning: ${warning}`);
  if (opts.image) {
    const [width, height] = parseSize(opts.size as string);
    const out = resolve(opts.image as string);
    await renderImage({ entry, source: "diff", preset: "change", width, height, out });
    if (!opts.json) console.log(`Picture written to ${out}`);
    return;
  }
  if (opts.json || opts.open === false) return;
  await serve(entry, { port: opts.port as string | undefined, open: true }, "?source=diff");
}

/** Registers the commands of this module on the program. */
export function registerTimeline(program: Command): void {
  program
    .command("timeline")
    .description("Build the timeline of a repository: one snapshot per commit or per day")
    .argument("[repo]", "repository to analyze", ".")
    .option("--by <mode>", "one frame per commit, per issue or per day", "commit")
    .option("--offline", "no network: do not ask GitHub for issue titles")
    .option(
      "--facts <file>",
      "facts file: agent, model, outcome, cost per issue (mapping in factory-city.config.json)",
    )
    .option("--branch <branch>", "branch to follow (default: the current one)")
    .option("--all-commits", "every commit instead of the first-parent history")
    .option("--since <date>", "only commits after this date")
    .option("--until <date>", "only commits before this date")
    .option("--range <A..B>", "only the commits of this range")
    .option("--revs <a,b,c>", "an explicit list of revisions")
    .option("--max-frames <n>", "even sampling, always keeping the first and the last frame")
    .option("--path <dir>", "restrict the analysis to a subfolder")
    .option("--all", "include every text file, with no default exclusion")
    .option("--include <glob>", "include files matching the glob (repeatable)", collect, [])
    .option("--exclude <glob>", "exclude files matching the glob (repeatable)", collect, [])
    .option("-o, --out <dir>", "output folder (default: ~/.factory-city/<project>)")
    .option("--json", "print machine-readable output")
    .action(runTimeline);

  program
    .command("diff")
    .description("Compare a branch with its base: summary, compare view, or a picture for a pull request")
    .argument(
      "[args...]",
      "[repo] [base] [head]: the base defaults to the merge-base with the default branch, the head to HEAD",
    )
    .option("--image <file>", "write a PNG of the compare view instead of opening the viewer")
    .option("--size <WxH>", "size of the picture", "1600x900")
    .option("--json", "print the summary as JSON")
    .option("--top <n>", "number of biggest changes to list", "10")
    .option("--port <n>", "port to listen on (localhost only)")
    .option("--no-open", "do not open the browser")
    .option("-o, --out <dir>", "output folder (default: ~/.factory-city/<project>)")
    .action(runDiff);
}
