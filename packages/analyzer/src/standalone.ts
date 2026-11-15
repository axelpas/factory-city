import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { Bundle } from "./bundle.js";

/** Above this size the file is awkward to send by e-mail: the command warns. */
export const WARN_BYTES = 15 * 1024 * 1024;

/** Id of the element that holds the embedded data: gzip, then base64. */
export const DATA_ELEMENT = "factory-city-data";

export interface StandaloneResult {
  bytes: number;
  /** True above 15 MB. */
  large: boolean;
}

function escapeScript(code: string): string {
  // inline code must never close its own script element
  return code.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
}

/**
 * Builds one self-contained HTML file: the viewer's code and style inlined, and the data embedded,
 * compressed. It opens offline by double-click, with nothing to fetch.
 */
export async function buildStandalone(viewerDir: string, bundle: Bundle, title: string): Promise<string> {
  const html = await readFile(join(viewerDir, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"[^>]*><\/script>/g)];
  const styles = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)];
  if (scripts.length === 0)
    throw new Error(`The viewer in ${viewerDir} has no script to embed. Run \`pnpm build\` first.`);
  let out = html;
  for (const m of styles) {
    const css = await readFile(join(viewerDir, m[1] as string), "utf8");
    out = out.replace(m[0], () => `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`);
  }
  const payload = gzipSync(Buffer.from(JSON.stringify(bundle), "utf8"), { level: 9 }).toString("base64");
  const data = `<script id="${DATA_ELEMENT}" type="application/octet-stream">${payload}</script>`;
  for (const m of scripts) {
    const code = await readFile(join(viewerDir, m[1] as string), "utf8");
    out = out.replace(m[0], () => `${data}\n<script type="module">${escapeScript(code)}</script>`);
  }
  // preload hints point to files that no longer exist
  out = out.replace(/<link[^>]*rel="modulepreload"[^>]*>\s*/g, "");
  const safeTitle = title.replace(/[<>&]/g, "");
  return out.replace(/<title>[^<]*<\/title>/, () => `<title>${safeTitle} · Factory City</title>`);
}

export async function writeStandalone(path: string, html: string): Promise<StandaloneResult> {
  await writeFile(path, html);
  const bytes = Buffer.byteLength(html, "utf8");
  return { bytes, large: bytes > WARN_BYTES };
}

export function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} kB`;
}
