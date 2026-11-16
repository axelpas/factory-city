import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IndexEntry } from "./output.js";
import { readIndex } from "./output.js";
import { type Context, handle } from "./server-routes.js";

/** The built viewer. Located by path, not imported: analyzer and viewer share only data files. */
export function defaultViewerDir(): string {
  if (process.env.FACTORY_CITY_VIEWER) return resolve(process.env.FACTORY_CITY_VIEWER);
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "viewer", "dist");
}

export interface ServerOptions {
  viewerDir: string;
  /** Slug of the project the viewer opens first. */
  current?: string;
  port?: number;
  /** Extra projects to serve besides the index (for data folders given by path). */
  extra?: IndexEntry[];
}

export interface RunningServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

/** Serves the viewer and the analyzed data from a tiny HTTP server bound to localhost only. */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const root = resolve(options.viewerDir);
  if (!existsSync(join(root, "index.html"))) {
    throw new Error(`The viewer is not built (no index.html in ${root}). Run \`pnpm build\` first.`);
  }
  const projects = async (): Promise<IndexEntry[]> => {
    const index = await readIndex();
    const merged = new Map<string, IndexEntry>(index.map((p) => [p.slug, p]));
    for (const p of options.extra ?? []) merged.set(p.slug, p);
    return [...merged.values()];
  };

  const context: Context = { root, options, projects };
  const server: Server = createServer((req, res) => {
    void handle(context, req, res).catch(() => {
      res.writeHead(500).end("Server error");
    });
  });

  const tryListen = (port: number) =>
    new Promise<void>((ok, fail) => {
      server.once("error", fail);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", fail);
        ok();
      });
    });
  const wanted = options.port ?? 4747;
  try {
    await tryListen(wanted);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE" || options.port !== undefined) throw err;
    await tryListen(0);
  }
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : wanted;
  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

/** Opens a URL in the default browser. Failures are ignored: the URL is printed anyway. */
export function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" })
      .on("error", () => {})
      .unref();
  } catch {
    return;
  }
}
