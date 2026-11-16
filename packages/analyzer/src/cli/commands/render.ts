import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { Command } from "commander";
import { slugFor } from "../../analyze.js";
import { loadBundle, writeBundle } from "../../bundle.js";
import { readIndex } from "../../output.js";
import { redactBundle } from "../../redact.js";
import { parseSize, renderImage, renderVideo } from "../../render.js";
import { defaultViewerDir } from "../../server.js";
import { buildStandalone, formatBytes, writeStandalone } from "../../standalone.js";

type Options = Record<string, unknown>;
type Written = Array<{ kind: string; path: string; bytes?: number }>;
type Bundle = Awaited<ReturnType<typeof loadBundle>>;

/** Where the data is: the folder given, or the project analyzed last. */
async function dataTarget(dataDirArg: string | undefined): Promise<{ dataDir: string; name: string }> {
  if (dataDirArg) {
    const dataDir = resolve(dataDirArg);
    return { dataDir, name: dataDir.split(/[\\/]/).pop() ?? "project" };
  }
  const latest = [...(await readIndex())].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
  if (!latest)
    throw new Error("No analyzed project yet. Run `factory-city` in a folder first, or pass a data folder.");
  return { dataDir: latest.dataDir, name: latest.name };
}

/** One self-contained HTML file that opens offline. */
async function writeHtml(bundle: Bundle, name: string, file: string, written: Written, say: Say) {
  const path = resolve(file);
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
      "warning: the file is larger than 15 MB: too big for most e-mail. Use --max-frames on the timeline, or --redact.",
    );
}

type Say = (text: string) => void;
type Common = Parameters<typeof renderImage>[0] extends infer T ? Omit<T & object, "out" | "frame"> : never;

async function writePicture(common: Common, opts: Options, written: Written, say: Say) {
  const path = resolve(opts.image as string);
  const frame = opts.frame === undefined ? undefined : Number(opts.frame) - 1;
  if (frame !== undefined && !(Number.isInteger(frame) && frame >= 0))
    throw new Error("--frame must be a whole number from 1.");
  await renderImage({ ...common, ...(frame === undefined ? {} : { frame }), out: path });
  written.push({ kind: "image", path });
  say(`Picture written to ${path}`);
}

async function writeFilm(common: Common, opts: Options, written: Written, say: Say) {
  const fps = Number(opts.fps);
  if (fps !== 30 && fps !== 60) throw new Error("--fps must be 30 or 60.");
  const secondsPerFrame = Number(opts.secondsPerFrame);
  if (!(secondsPerFrame > 0)) throw new Error("--seconds-per-frame must be a positive number.");
  const asked = resolve(opts.video as string);
  const video = await renderVideo({
    ...common,
    out: asked,
    fps,
    secondsPerFrame,
    orbit: Boolean(opts.orbit),
  });
  written.push({ kind: "video", path: video.path, bytes: video.bytes });
  say(
    `Video written to ${video.path} (${formatBytes(video.bytes)}, ${video.images} images, ${video.codec}).`,
  );
  if (video.path !== asked) say("H.264 is not available in this browser: the video was written as WebM.");
}

/** The picture and the film, rendered by a browser from a data folder. */
async function writeRendered(
  bundle: Bundle,
  dataDir: string,
  name: string,
  opts: Options,
  written: Written,
  say: Say,
) {
  const source = bundle.source;
  const [width, height] = parseSize(opts.size as string);
  // a browser renders from a data folder: a redacted one is written aside, and removed afterwards
  const served = opts.redact ? await writeBundle(bundle, source) : dataDir;
  const common = {
    entry: { slug: slugFor(served), name, dataDir: served, updatedAt: new Date().toISOString() },
    source,
    preset: opts.preset as string | undefined,
    theme: opts.theme as string | undefined,
    width,
    height,
    overlay: opts.overlay !== false,
  };
  try {
    if (opts.image) await writePicture(common, opts, written, say);
    if (opts.video) await writeFilm(common, opts, written, say);
  } finally {
    if (opts.redact) await rm(served, { recursive: true, force: true });
  }
}

async function run(dataDirArg: string | undefined, opts: Options): Promise<void> {
  if (!["image", "video", "html"].some((k) => opts[k]))
    throw new Error("Say what to write: --image out.png, --video out.mp4 or --html out.html.");
  const target = await dataTarget(dataDirArg);
  let bundle = await loadBundle(target.dataDir, opts.source as string | undefined);
  const source = bundle.source;
  const name = bundle.manifest.project || target.name;
  if (opts.redact) bundle = { ...redactBundle(bundle), source };
  const written: Written = [];
  const say: Say = (text) => {
    if (!opts.json) console.log(text);
  };
  if (opts.html) await writeHtml(bundle, name, opts.html as string, written, say);
  if (opts.image || opts.video) await writeRendered(bundle, target.dataDir, name, opts, written, say);
  if (opts.json) console.log(JSON.stringify({ source, redacted: Boolean(opts.redact), written }, null, 2));
}

/** Registers the commands of this module on the program. */
export function registerRender(program: Command): void {
  program
    .command("render")
    .description("Export a picture, a video or a standalone HTML file of a project, without opening a window")
    .argument(
      "[dataDir]",
      "data folder written by analyze or timeline (default: the latest analyzed project)",
    )
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
    .option("--frame <n>", "the frame of the timeline to show in a picture, from 1 (default: the last)")
    .option(
      "--redact",
      "remove commit subjects, issue titles, author and agent labels, facts, cost and declaration names",
    )
    .option("--json", "print machine-readable output")
    .action(run);
}
