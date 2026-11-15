#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type Factory, METRICS, type Report } from "@factory-city/schema";
import { Command } from "commander";
import { ANALYZER_VERSION, analyze, slugFor, summaryLine } from "../analyze.js";
import { loadBundle, writeBundle } from "../bundle.js";
import { coverageLine } from "../collectors/issues.js";
import { buildDiff, diffText } from "../diff.js";
import { doctor } from "../doctor.js";
import { factoryMarkdown } from "../factory/markdown.js";
import { reportMarkdown } from "../health/markdown.js";
import { LANGUAGES } from "../languages/index.js";
import { outputRoot, readIndex, updateIndex, writeAnalysis } from "../output.js";
import { redactBundle } from "../redact.js";
import { parseSize, renderImage, renderVideo } from "../render.js";
import { defaultViewerDir, openBrowser, startServer } from "../server.js";
import { buildStandalone, formatBytes, writeStandalone } from "../standalone.js";
import { buildTimeline } from "../timeline.js";

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
  with?: string[];
  out?: string;
  json?: boolean;
}

/** Optional collectors, asked for with `--with`. */
const FEATURES = ["duplication"];

function features(opts: AnalyzeFlags): Set<string> {
  const asked = new Set(opts.with ?? []);
  for (const feature of asked) {
    if (!FEATURES.includes(feature))
      throw new Error(`Unknown --with value "${feature}". Available: ${FEATURES.join(", ")}.`);
  }
  return asked;
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
    duplication: features(opts).has("duplication"),
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
    .option("--with <feature>", "add an optional collector: duplication (repeatable)", collect, [])
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
      const known = [
        "analysis.json",
        "timeline.commit.json",
        "timeline.day.json",
        "timeline.issue.json",
        "timeline.revs.json",
      ];
      if (!known.some((f) => existsSync(join(dir, f))))
        throw new Error(
          `No analysis.json or timeline in ${dir}. Run \`factory-city analyze\` first, or pass the folder written by it.`,
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
    for (const l of LANGUAGES) console.log(`${l.label.padEnd(14)} tier ${l.tier}  ${l.extensions.join(" ")}`);
    console.log(
      `${"Other text".padEnd(14)} tier 3  any other text file, with --all: line and git metrics only`,
    );
  });

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
  .action(async (repoPath: string, opts: Record<string, unknown>) => {
    const by = opts.by as string;
    if (by !== "commit" && by !== "day" && by !== "issue")
      throw new Error(`Unknown --by "${by}". Use commit, issue or day.`);
    const maxFrames = opts.maxFrames === undefined ? undefined : Number(opts.maxFrames);
    if (maxFrames !== undefined && (!Number.isInteger(maxFrames) || maxFrames < 2)) {
      throw new Error("--max-frames must be a whole number of at least 2.");
    }
    const folder = resolve(repoPath);
    const slug = slugFor(folder);
    const dataDir = opts.out ? resolve(opts.out as string) : join(outputRoot(), slug);
    const started = Date.now();
    const quiet = Boolean(opts.json) || !process.stderr.isTTY;
    const result = await buildTimeline(
      {
        folder,
        by,
        branch: opts.branch as string | undefined,
        allCommits: opts.allCommits as boolean | undefined,
        since: opts.since as string | undefined,
        until: opts.until as string | undefined,
        range: opts.range as string | undefined,
        revs:
          typeof opts.revs === "string"
            ? opts.revs
                .split(",")
                .map((r) => r.trim())
                .filter(Boolean)
            : undefined,
        maxFrames,
        offline: opts.offline as boolean | undefined,
        facts: opts.facts as string | undefined,
        path: opts.path as string | undefined,
        all: opts.all as boolean | undefined,
        include: opts.include as string[],
        exclude: opts.exclude as string[],
        onProgress: quiet ? undefined : (done, total) => process.stderr.write(`\rframe ${done}/${total}`),
      },
      dataDir,
    );
    if (!quiet) process.stderr.write("\n");
    if (!opts.out)
      await updateIndex({
        slug,
        name: result.manifest.project,
        dataDir,
        updatedAt: new Date().toISOString(),
      });
    const seconds = (Date.now() - started) / 1000;
    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            dataDir,
            frames: result.manifest.frames.length,
            seconds,
            cache: result.cache,
            dataLevel: result.manifest.dataLevel,
          },
          null,
          2,
        ),
      );
      return;
    }
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
  });

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
  .action(async (args: string[], opts: Record<string, unknown>) => {
    const rest = [...args];
    const first = rest[0];
    const repoPath =
      first !== undefined && existsSync(first) && statSync(first).isDirectory()
        ? (rest.shift() as string)
        : ".";
    const [base, head] = rest;
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
      await renderImage({
        entry,
        source: "diff",
        preset: "change",
        width,
        height,
        out: resolve(opts.image as string),
      });
      if (!opts.json) console.log(`Picture written to ${resolve(opts.image as string)}`);
      return;
    }
    if (opts.json || opts.open === false) return;
    await serve(entry, { port: opts.port as string | undefined, open: true }, "?source=diff");
  });

program
  .command("report")
  .description("Print the code-health report: score, risk profile and prioritized hotspots")
  .argument("[path]", "folder to analyze, or a data folder written by analyze or timeline", ".")
  .option("--format <format>", "md or json", "md")
  .option("--top <n>", "number of hotspots", "5")
  .option("--json", "same as --format json")
  .option("--period <period>", "period of the factory KPIs: 30d or all", "30d")
  .option("--by <group>", "group the factory KPIs by agent, model, kind or estimate")
  .action(
    async (
      path: string,
      opts: { format: string; top: string; json?: boolean; period: string; by?: string },
    ) => {
      const dir = resolve(path);
      const format = opts.json ? "json" : opts.format;
      if (format !== "md" && format !== "json")
        throw new Error(`Unknown --format "${format}". Use md or json.`);
      const top = Number(opts.top);
      if (!Number.isInteger(top) || top < 1) throw new Error("--top must be a whole number of at least 1.");
      // a data folder holds a report already; any other folder is analyzed first
      if (opts.period !== "30d" && opts.period !== "all") {
        throw new Error(`Unknown --period "${opts.period}". Use 30d or all.`);
      }
      const stored = ["report.issue.json", "report.commit.json", "report.day.json", "report.json"]
        .map((f) => join(dir, f))
        .find(
          (f) => existsSync(f) && !existsSync(join(dir, "package.json")) && !existsSync(join(dir, ".git")),
        );
      const report: Report = stored
        ? (JSON.parse(await readFile(stored, "utf8")) as Report)
        : (await analyzeAndWrite(path, {}, true)).result.report;
      // the factory KPIs come with a per-issue timeline
      const factoryPath = join(dir, "factory.json");
      const factory =
        stored && existsSync(factoryPath)
          ? (JSON.parse(await readFile(factoryPath, "utf8")) as Factory)
          : undefined;
      if (format === "json") {
        const body = { ...report, hotspots: report.hotspots.slice(0, top), ...(factory ? { factory } : {}) };
        console.log(JSON.stringify(body, null, 2));
        return;
      }
      process.stdout.write(reportMarkdown(report, top));
      if (factory) {
        const period = opts.period === "all" ? "all" : "last30";
        process.stdout.write(`\n${factoryMarkdown(factory, { period, by: opts.by })}`);
      } else if (opts.by) {
        console.error(
          "Factory KPIs need a per-issue timeline: run `factory-city timeline --by issue`, then `factory-city report <data folder>`.",
        );
      }
    },
  );

program
  .command("render")
  .description("Export a picture, a video or a standalone HTML file of a project, without opening a window")
  .argument("[dataDir]", "data folder written by analyze or timeline (default: the latest analyzed project)")
  .option("--image <file>", "write a PNG of the city")
  .option("--video <file>", "write the timelapse as a video (MP4, or WebM when H.264 is not available)")
  .option("--html <file>", "write one self-contained HTML file that opens offline")
  .option("--source <name>", "snapshot, commit, day, issue, revs or diff (default: the latest written)")
  .option("--preset <id>", "preset to show")
  .option("--theme <id>", "theme to use")
  .option("--size <WxH>", "size of the picture or the video", "1920x1080")
  .option("--fps <n>", "images per second of the video: 30 or 60", "30")
  .option("--seconds-per-frame <n>", "seconds each frame of the timeline takes in the video", "1.4")
  .option("--orbit", "turn slowly around the city during the video")
  .option("--no-overlay", "leave out the title, the frame label and the legend")
  .option(
    "--redact",
    "remove commit subjects, issue titles, author and agent labels, facts, cost and declaration names",
  )
  .option("--json", "print machine-readable output")
  .action(async (dataDirArg: string | undefined, opts: Record<string, unknown>) => {
    const outputs = ["image", "video", "html"].filter((k) => opts[k]);
    if (outputs.length === 0)
      throw new Error("Say what to write: --image out.png, --video out.mp4 or --html out.html.");
    let dataDir: string;
    let name: string;
    if (dataDirArg) {
      dataDir = resolve(dataDirArg);
      name = dataDir.split(/[\\/]/).pop() ?? "project";
    } else {
      const latest = [...(await readIndex())].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
      if (!latest)
        throw new Error(
          "No analyzed project yet. Run `factory-city` in a folder first, or pass a data folder.",
        );
      dataDir = latest.dataDir;
      name = latest.name;
    }
    let bundle = await loadBundle(dataDir, opts.source as string | undefined);
    const source = bundle.source;
    name = bundle.manifest.project || name;
    if (opts.redact) bundle = { ...redactBundle(bundle), source };
    const written: Array<{ kind: string; path: string; bytes?: number }> = [];
    const say = (text: string) => {
      if (!opts.json) console.log(text);
    };

    if (opts.html) {
      const path = resolve(opts.html as string);
      const html = await buildStandalone(
        defaultViewerDir(),
        {
          manifest: bundle.manifest,
          snapshots: bundle.snapshots,
          report: bundle.report,
          factory: bundle.factory,
        },
        name,
      );
      const result = await writeStandalone(path, html);
      written.push({ kind: "html", path, bytes: result.bytes });
      say(`Standalone file written to ${path} (${formatBytes(result.bytes)}).`);
      if (result.large)
        console.warn(
          `warning: the file is larger than 15 MB: too big for most e-mail. Use --max-frames on the timeline, or --redact.`,
        );
    }

    if (opts.image || opts.video) {
      const [width, height] = parseSize(opts.size as string);
      // a browser renders from a data folder: a redacted one is written aside, and removed afterwards
      const served = opts.redact ? await writeBundle(bundle, source) : dataDir;
      const entry = { slug: slugFor(served), name, dataDir: served, updatedAt: new Date().toISOString() };
      const common = {
        entry,
        source,
        preset: opts.preset as string | undefined,
        theme: opts.theme as string | undefined,
        width,
        height,
        overlay: opts.overlay !== false,
      };
      try {
        if (opts.image) {
          const path = resolve(opts.image as string);
          await renderImage({ ...common, out: path });
          written.push({ kind: "image", path });
          say(`Picture written to ${path}`);
        }
        if (opts.video) {
          const fps = Number(opts.fps);
          if (fps !== 30 && fps !== 60) throw new Error("--fps must be 30 or 60.");
          const secondsPerFrame = Number(opts.secondsPerFrame);
          if (!(secondsPerFrame > 0)) throw new Error("--seconds-per-frame must be a positive number.");
          const video = await renderVideo({
            ...common,
            out: resolve(opts.video as string),
            fps,
            secondsPerFrame,
            orbit: Boolean(opts.orbit),
          });
          written.push({ kind: "video", path: video.path, bytes: video.bytes });
          say(
            `Video written to ${video.path} (${formatBytes(video.bytes)}, ${video.images} images, ${video.codec}).`,
          );
          if (video.path !== resolve(opts.video as string))
            say("H.264 is not available in this browser: the video was written as WebM.");
        }
      } finally {
        if (opts.redact) await rm(served, { recursive: true, force: true });
      }
    }
    if (opts.json) console.log(JSON.stringify({ source, redacted: Boolean(opts.redact), written }, null, 2));
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
