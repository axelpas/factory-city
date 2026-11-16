#!/usr/bin/env node
// Builds every picture of the README and the demo files of examples/, from public repositories only:
// this repository (its own per-issue timeline) and one pinned module of an open-source project.
// Run `pnpm build` first. Options: --skip-twenty (this repository only), --twenty-only, --work <dir> (scratch folder).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cli = join(root, "packages/analyzer/dist/cli/main.js");
const renderModule = join(root, "packages/analyzer/dist/render.js");
const args = process.argv.slice(2);
const skipTwenty = args.includes("--skip-twenty");
const workArg = args.indexOf("--work");
const work = workArg >= 0 ? resolve(args[workArg + 1]) : join(tmpdir(), "factory-city-docs-assets");
const assets = join(root, "docs/assets");
const examples = join(root, "examples");

/** The public project used for the second set of pictures: pinned to a tag, one MIT-licensed module of it. */
const TWENTY = {
  url: "https://github.com/twentyhq/twenty.git",
  tag: "twenty/v2.58.0",
  module: "packages/twenty-ui",
  exclude: "src/icon/**",
  maxFrames: "150",
};

mkdirSync(assets, { recursive: true });
mkdirSync(examples, { recursive: true });
mkdirSync(work, { recursive: true });

const run = (cmd, argv, options = {}) =>
  execFileSync(cmd, argv, {
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
    maxBuffer: 1 << 28,
    ...options,
  });
const factory = (argv) => run("node", [cli, ...argv]);
const say = (text) => console.log(`• ${text}`);

/** A picture of the city: `--frame` is 1-based, as on the command line. */
function picture(
  dataDir,
  name,
  { source = "issue", preset, theme, frame, size = "1600x900", overlay = true } = {},
) {
  const argv = [
    "render",
    dataDir,
    "--image",
    join(assets, `${name}.png`),
    "--source",
    source,
    "--size",
    size,
  ];
  if (preset) argv.push("--preset", preset);
  if (theme) argv.push("--theme", theme);
  if (frame) argv.push("--frame", String(frame));
  if (!overlay) argv.push("--no-overlay");
  factory(argv);
  say(name);
}

/** A screenshot of the page itself, after a script has set it up. */
async function screenshot(
  dataDir,
  slug,
  name,
  script,
  { source = "issue", preset, width = 1400, height = 860 } = {},
) {
  const { screenshotPage } = await import(renderModule);
  const entry = { slug, name: slug, dataDir, updatedAt: "2026-01-01T00:00:00.000Z" };
  // the first-open help card would cover the picture: dismiss it, then set the page up
  const dismissHelp = `await new Promise((done) => setTimeout(done, 500)); document.querySelector(".help button")?.click();`;
  await screenshotPage(
    { entry, source, preset, width, height, out: join(assets, `${name}.png`) },
    `${dismissHelp}\n${script}`,
  );
  say(name);
}

const frameCount = (dataDir, source) =>
  JSON.parse(readFileSync(join(dataDir, `timeline.${source}.json`), "utf8")).frames.length;

/** Moves the pointer over the canvas until a building is under it, so that its card shows. */
const POINT_AT_A_BUILDING = `
  await new Promise((done) => setTimeout(done, 600));
  const canvas = document.querySelector(".stage canvas");
  const r = canvas.getBoundingClientRect();
  for (let fy = 0.35; fy < 0.7; fy += 0.04) {
    for (let fx = 0.35; fx < 0.7; fx += 0.04) {
      canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, bubbles: true, pointerId: 1 }));
      await new Promise((done) => setTimeout(done, 90));
      if (getComputedStyle(canvas).cursor === "pointer") { await new Promise((done) => setTimeout(done, 200)); return; }
    }
  }
`;
const OPEN_TAB = (tab) => `
  await new Promise((done) => setTimeout(done, 600));
  document.querySelector('.inspector [data-tab="${tab}"]').click();
  await new Promise((done) => setTimeout(done, 400));
`;

/** The film as a looping GIF (a palette per film keeps the colors); skipped, with a note, without ffmpeg. */
function filmToGif(film, gif) {
  const filter = "fps=12,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse";
  const result = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", film, "-vf", filter, "-loop", "0", gif]);
  if (result.error || result.status !== 0) say("ffmpeg not available: docs/assets/timelapse.gif was not updated");
}

const twentyOnly = args.includes("--twenty-only");
if (!twentyOnly) {
  const self = join(work, "self");
  rmSync(self, { recursive: true, force: true });
  say("analyzing this repository (per-issue timeline)");
  factory(["timeline", root, "--by", "issue", "--offline", "-o", self]);
  const frames = frameCount(self, "issue");

  picture(self, "hero", { preset: "hotspots" });
  picture(self, "preset-three-cs", { preset: "three-cs" });
  picture(self, "preset-bug-magnets", { preset: "bug-magnets" });
  picture(self, "preset-waste", { preset: "waste" });
  for (const theme of ["architect", "isometric", "blocks", "hologram"])
    picture(self, `theme-${theme}`, { preset: "hotspots", theme, size: "1000x600" });
  await screenshot(self, "factory-city", "hover-card", POINT_AT_A_BUILDING, { preset: "hotspots" });
  await screenshot(self, "factory-city", "panel-health", OPEN_TAB("health"), { preset: "hotspots" });
  await screenshot(self, "factory-city", "panel-factory", OPEN_TAB("factory"), { preset: "hotspots" });

  // a branch against its base, as in a pull request
  say("diff");
  const diffOut = join(work, "diff");
  rmSync(diffOut, { recursive: true, force: true });
  factory([
    "diff",
    root,
    "HEAD~8",
    "HEAD",
    "--image",
    join(assets, "diff.png"),
    "--size",
    "1600x900",
    "-o",
    diffOut,
  ]);

  // the demo files
  say("standalone HTML and film of this repository");
  factory(["render", self, "--source", "issue", "--html", join(examples, "factory-city.html")]);
  factory([
    "render",
    self,
    "--source",
    "issue",
    "--video",
    join(examples, "factory-city.mp4"),
    "--size",
    "960x540",
    "--seconds-per-frame",
    "0.35",
  ]);
  // a README shows a picture that moves, not a link: the film as a looping GIF, when ffmpeg is there
  filmToGif(join(examples, "factory-city.mp4"), join(assets, "timelapse.gif"));
}

// ------------------------------------------------------------------ one module of a public project
if (!skipTwenty) {
  const clone = join(work, "twenty");
  const data = join(work, "twenty-ui");
  if (!existsSync(join(clone, ".git"))) {
    say(`cloning ${TWENTY.url} at ${TWENTY.tag} (no file contents yet)`);
    run("git", [
      "clone",
      "--quiet",
      "--filter=blob:none",
      "--no-checkout",
      "--branch",
      TWENTY.tag,
      TWENTY.url,
      clone,
    ]);
  }
  // fetch every historical file of the module in one batch, instead of one request per file
  say(`fetching the files of ${TWENTY.module}`);
  const missing = run("git", ["rev-list", "--objects", "--missing=print", "HEAD", "--", TWENTY.module], {
    cwd: clone,
  })
    .split("\n")
    .filter((l) => l.startsWith("?"))
    .map((l) => l.slice(1));
  if (missing.length > 0)
    run(
      "git",
      [
        "-c",
        "fetch.negotiationAlgorithm=noop",
        "fetch",
        "origin",
        "--no-tags",
        "--no-write-fetch-head",
        "--recurse-submodules=no",
        "--filter=blob:none",
        "--stdin",
      ],
      { cwd: clone, input: `${missing.join("\n")}\n`, stdio: ["pipe", "pipe", "inherit"] },
    );
  // the module's folder, at the pinned tag, so that the analyzer can start from it
  run("git", ["sparse-checkout", "set", TWENTY.module], { cwd: clone });
  run("git", ["checkout", "--quiet"], { cwd: clone });
  rmSync(data, { recursive: true, force: true });
  say("analyzing the module (per-issue timeline)");
  factory([
    "timeline",
    join(clone, TWENTY.module),
    "--by",
    "issue",
    "--offline",
    "--exclude",
    TWENTY.exclude,
    "--max-frames",
    TWENTY.maxFrames,
    "-o",
    data,
  ]);
  const n = frameCount(data, "issue");
  picture(data, "twenty-ui-hero", { preset: "hotspots" });
  picture(data, "twenty-ui-three-cs", { preset: "three-cs" });
  picture(data, "twenty-ui-early", { preset: "hotspots", frame: Math.round(n / 4), size: "1000x600" });
  picture(data, "twenty-ui-middle", { preset: "hotspots", frame: Math.round(n / 2), size: "1000x600" });
}

const size = (p) => `${(statSync(p).size / 1024 / 1024).toFixed(1)} MB`;
writeFileSync(join(work, "done.txt"), new Date().toISOString());
console.log(
  `\nDone. examples/factory-city.html ${size(join(examples, "factory-city.html"))}, examples/factory-city.mp4 ${size(join(examples, "factory-city.mp4"))}`,
);
