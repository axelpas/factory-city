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
            const frame = opts.frame === undefined ? undefined : Number(opts.frame) - 1;
            if (frame !== undefined && !(Number.isInteger(frame) && frame >= 0))
              throw new Error("--frame must be a whole number from 1.");
            await renderImage({ ...common, ...(frame === undefined ? {} : { frame }), out: path });
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
      if (opts.json)
        console.log(JSON.stringify({ source, redacted: Boolean(opts.redact), written }, null, 2));
    });
}
