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
    try {
      return await driver.chromium.launch({ headless: true, ...options });
    } catch {
      // try the next browser
    }
  }
  throw new Error(
    "No browser found to render with. Install Google Chrome, or run `npx playwright-core install chromium`.",
  );
}

/** Renders the viewer's current picture of a project to a PNG, through the same export code as the app. */
export async function renderImage(options: RenderImageOptions): Promise<void> {
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
    const dataUrl = await page.evaluate<string | null>(
      `window.factoryCity.capture(${Math.round(options.width)}, ${Math.round(options.height)}, ${options.overlay !== false}) ?? null`,
    );
    if (!dataUrl?.startsWith("data:image/png;base64,")) {
      throw new Error("The viewer produced no picture (WebGL may be unavailable in this browser).");
    }
    await writeFile(options.out, Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64"));
  } finally {
    await browser?.close();
    await server.close();
  }
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
