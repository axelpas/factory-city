import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { probePage } from "../src/render.js";
import { defaultViewerDir } from "../src/server.js";
import { buildTimeline } from "../src/timeline.js";
import { commitAt, initRepo, makeTree } from "./helpers.js";

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/opt/google/chrome/chrome",
].some((p) => existsSync(p));

/** Interface checks need a real browser and the built viewer; they are skipped without them. */
export const canRender = CHROME && existsSync(join(defaultViewerDir(), "index.html"));

const code = (n: number) =>
  `${Array.from({ length: n }, (_, i) => `export function f${i}(x: number) { return x > ${i} ? x : ${i}; }`).join("\n")}\n`;

let sample: Promise<string> | undefined;

/** A small per-issue timeline (three frames, two folders), built once per test file. */
export function uiSample(): Promise<string> {
  sample ??= (async () => {
    const dir = initRepo({ "src/core/a.ts": code(4), "src/core/b.ts": code(2), "src/ui/view.ts": code(8) });
    commitAt(dir, "2026-01-01T10:00:00Z", "feat: start the core (#1)");
    writeFileSync(join(dir, "src/ui/panel.ts"), code(6));
    commitAt(dir, "2026-01-02T10:00:00Z", "feat: add the panel (#2)");
    writeFileSync(join(dir, "src/core/a.ts"), code(12));
    commitAt(dir, "2026-01-03T10:00:00Z", "fix: repair the core (#3)");
    const out = makeTree({});
    await buildTimeline({ folder: dir, by: "issue", offline: true }, out);
    return out;
  })();
  return sample;
}

/** Helpers every page script can use: `wait(ms)`, `key(k)`, `press(el)`, `box(el)`. */
const PRELUDE = `
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));
  const key = (k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  const press = (el) => el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; };
`;

/** Runs the body of an async function in the viewer's page, on the sample, and returns what it returns. */
export async function inPage<T>(
  body: string,
  options: { width?: number; height?: number; source?: string; theme?: string; preset?: string } = {},
): Promise<T> {
  const dataDir = await uiSample();
  return probePage<T>(
    {
      entry: { slug: "demo-ui", name: "demo", dataDir, updatedAt: "2026-01-01T00:00:00.000Z" },
      source: options.source ?? "issue",
      theme: options.theme,
      preset: options.preset,
      width: options.width ?? 1400,
      height: options.height ?? 800,
    },
    `(async () => { ${PRELUDE} ${body} })()`,
  );
}
