import { writeFile } from "node:fs/promises";
import type { IndexEntry } from "./output.js";
import { defaultViewerDir, startServer } from "./server.js";

export interface RenderImageOptions {
  entry: IndexEntry;
  /** `snapshot`, `commit`, `day`, `issue`, `revs` or `diff`. */
  source?: string;
  preset?: string;
  theme?: string;
  width: number;
  height: number;
  overlay?: boolean;
  /** The frame of a timeline to show, from 0; the last one by default. */
  frame?: number;
  out: string;
}

interface BrowserLike {
  newPage(options: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
  }): Promise<PageLike>;
  close(): Promise<void>;
}
interface PageLike {
  goto(url: string): Promise<unknown>;
  waitForFunction(fn: string, arg?: unknown, options?: { timeout: number }): Promise<unknown>;
  evaluate<T>(fn: string): Promise<T>;
  screenshot(options: { path: string }): Promise<unknown>;
}

const GL_ARGS = ["--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"];

/** Starts a headless browser: the system's Google Chrome first, else a Chromium installed for Playwright. */
async function launch(): Promise<BrowserLike> {
  let driver: { chromium: { launch(options: object): Promise<BrowserLike> } };
  try {
    driver = (await import("playwright-core")) as unknown as typeof driver;
  } catch {
    throw new Error(
      "Rendering needs the optional package playwright-core, which is not installed. Reinstall with optional dependencies, or run `npm install playwright-core`.",
    );
  }
  const attempts: object[] = [{ channel: "chrome", args: GL_ARGS }, { args: GL_ARGS }];
  for (const options of attempts) {
    const browser = await driver.chromium.launch({ headless: true, ...options }).catch(() => undefined);
    if (browser) return browser;
  }
  throw new Error(
    "No browser found to render with. Install Google Chrome, or run `npx playwright-core install chromium`.",
  );
}

/** Renders the viewer's current picture of a project to a PNG, through the same export code as the app. */
export async function renderImage(options: RenderImageOptions): Promise<void> {
  const frame = options.frame === undefined ? "" : `, ${Math.round(options.frame)}`;
  const dataUrl = await withPage(options, (page) =>
    page.evaluate<string | null>(
      `window.factoryCity.capture(${Math.round(options.width)}, ${Math.round(options.height)}, ${options.overlay !== false}${frame}) ?? null`,
    ),
  );
  if (!dataUrl?.startsWith("data:image/png;base64,")) {
    throw new Error("The viewer produced no picture (WebGL may be unavailable in this browser).");
  }
  await writeFile(options.out, Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64"));
}

export interface RenderVideoOptions extends Omit<RenderImageOptions, "out"> {
  out: string;
  fps: number;
  secondsPerFrame: number;
  orbit: boolean;
}

export interface RenderedVideo {
  /** Where the film was written: the extension follows the container the browser could encode. */
  path: string;
  bytes: number;
  images: number;
  codec: string;
}

/** Opens the viewer on a project in a headless browser and hands the page to `use`. */
async function withPage<T>(
  options: Pick<RenderImageOptions, "entry" | "source" | "preset" | "theme" | "width" | "height">,
  use: (page: PageLike) => Promise<T>,
): Promise<T> {
  const server = await startServer({
    viewerDir: defaultViewerDir(),
    current: options.entry.slug,
    extra: [options.entry],
    port: 0,
  });
  let browser: BrowserLike | undefined;
  try {
    browser = await launch();
    const page = await browser.newPage({
      viewport: { width: Math.min(options.width, 1920), height: Math.min(options.height, 1080) },
      deviceScaleFactor: 1,
    });
    const query = new URLSearchParams({ project: options.entry.slug });
    if (options.source) query.set("source", options.source);
    if (options.preset) query.set("preset", options.preset);
    if (options.theme) query.set("theme", options.theme);
    await page.goto(`${server.url}?${query.toString()}`);
    await page.waitForFunction("window.factoryCity && window.factoryCity.ready === true", undefined, {
      timeout: 120_000,
    });
    return await use(page);
  } finally {
    await browser?.close();
    await server.close();
  }
}

/**
 * Renders the timelapse of a project to a video, image by image on a virtual clock, through the viewer's own
 * export code. MP4 (H.264) when the browser can encode it, otherwise WebM, written with the matching extension.
 */
export async function renderVideo(options: RenderVideoOptions): Promise<RenderedVideo> {
  const settings = JSON.stringify({
    width: Math.round(options.width),
    height: Math.round(options.height),
    fps: options.fps,
    secondsPerFrame: options.secondsPerFrame,
    overlay: options.overlay !== false,
    orbit: options.orbit,
  });
  const result = await withPage(options, (page) =>
    page.evaluate<{ base64: string; mime: string; codec: string; images: number } | null>(
      `window.factoryCity.video(${settings})`,
    ),
  );
  if (!result)
    throw new Error(
      "The viewer produced no video (WebGL or video encoding may be unavailable in this browser).",
    );
  const data = Buffer.from(result.base64, "base64");
  const webm = result.mime === "video/webm";
  const path =
    webm && !/\.webm$/i.test(options.out) ? `${options.out.replace(/\.[^./\\]+$/, "")}.webm` : options.out;
  await writeFile(path, data);
  return { path, bytes: data.length, images: result.images, codec: result.codec };
}

/** Fingerprints of the images at some playhead positions, to compare two renders image for image. */
export async function probeImages(
  options: Omit<RenderImageOptions, "out" | "overlay">,
  positions: number[],
): Promise<string[]> {
  return withPage(options, (page) =>
    page.evaluate<string[]>(
      `window.factoryCity.imageHashes(${JSON.stringify(positions)}, ${Math.round(options.width)}, ${Math.round(options.height)})`,
    ),
  );
}

/**
 * Runs a script in the viewer's page once it is ready, and returns its result: for checks of the interface
 * in a real browser.
 */
export async function probePage<T>(
  options: Omit<RenderImageOptions, "out" | "overlay">,
  script: string,
): Promise<T> {
  return withPage(options, (page) => page.evaluate<T>(script));
}

/** Parses `1920x1080`. */
export function parseSize(
  text: string | undefined,
  fallback: [number, number] = [1920, 1080],
): [number, number] {
  if (!text) return fallback;
  const m = /^(\d{2,5})x(\d{2,5})$/i.exec(text.trim());
  if (!m) throw new Error(`Invalid size "${text}". Use WIDTHxHEIGHT, for example 1920x1080.`);
  return [Number(m[1]), Number(m[2])];
}

/**
 * A screenshot of the page itself, panels and bar included, after a script has set it up (open a panel, point
 * at a building...). For the pictures of the documentation, not for exports.
 */
export async function screenshotPage(
  options: Pick<RenderImageOptions, "entry" | "source" | "preset" | "theme" | "width" | "height" | "out">,
  script: string,
): Promise<void> {
  await withPage(options, async (page) => {
    await page.evaluate(`(async () => { ${script} })()`);
    await page.screenshot({ path: options.out });
  });
}
