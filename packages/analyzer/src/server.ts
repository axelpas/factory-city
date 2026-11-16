import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { IndexEntry } from "./output.js";
import { readIndex } from "./output.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
};

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

async function sendFile(res: import("node:http").ServerResponse, file: string): Promise<void> {
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

function inside(root: string, candidate: string): boolean {
  const r = resolve(root);
  const c = resolve(candidate);
  return c === r || c.startsWith(r + sep);
}

interface Context {
  root: string;
  options: ServerOptions;
  projects: () => Promise<IndexEntry[]>;
}

const JSON_HEADERS = { "content-type": MIME[".json"] as string, "cache-control": "no-cache" };

/** The list of projects, for the project switcher. */
async function sendProjects(c: Context, res: ServerResponse): Promise<void> {
  const list = await c.projects();
  res.writeHead(200, JSON_HEADERS);
  res.end(
    JSON.stringify({
      current: c.options.current,
      projects: list.map((p) => ({ slug: p.slug, name: p.name })),
    }),
  );
}

/** Which manifests exist for a project, so that the viewer does not have to probe for them. */
async function sendSources(c: Context, res: ServerResponse, slug: string | undefined): Promise<void> {
  const entry = (await c.projects()).find((p) => p.slug === slug);
  const names = entry
    ? (await readdir(entry.dataDir).catch(() => [])).filter((n) =>
        /^(analysis|timeline\.[a-z]+)\.json$/.test(n),
      )
    : [];
  res.writeHead(entry ? 200 : 404, JSON_HEADERS);
  res.end(JSON.stringify({ files: names.sort() }));
}

/** A data file of a project: only plain file names, never a path out of the data folder. */
async function sendData(
  c: Context,
  res: ServerResponse,
  slug: string | undefined,
  name: string,
): Promise<void> {
  const entry = (await c.projects()).find((p) => p.slug === slug);
  const leaf = name.replace(/^frames\.[a-z]+\//, "");
  if (!entry || !/^[\w.-]+$/.test(leaf) || leaf.startsWith(".")) {
    res.writeHead(404).end("Not found");
    return;
  }
  await sendFile(res, join(entry.dataDir, name));
}

/** A file of the viewer, never one outside its folder. */
async function sendStatic(c: Context, res: ServerResponse, path: string): Promise<void> {
  const file = join(c.root, path === "/" ? "index.html" : normalize(path).replace(/^[/\\]+/, ""));
  if (!inside(c.root, file)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  await sendFile(res, file);
}

async function handle(c: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  const sources = /^\/data\/([^/]+)\/sources\.json$/.exec(path);
  const data = /^\/data\/([^/]+)\/((?:frames\.[a-z]+\/)?[^/]+)$/.exec(path);
  if (path === "/projects.json") await sendProjects(c, res);
  else if (sources) await sendSources(c, res, sources[1]);
  else if (data) await sendData(c, res, data[1], data[2] as string);
  else await sendStatic(c, res, path);
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
