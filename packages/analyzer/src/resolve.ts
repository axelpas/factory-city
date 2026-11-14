import { posix } from "node:path";
import { folderReason } from "./select.js";

const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const JS_TO_TS: Record<string, string[]> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};

/** Removes comments and trailing commas so that tsconfig files (JSON with comments) can be parsed. */
export function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

interface TsConfig {
  /** Folder that bases `paths`, relative to the analyzed folder. */
  base: string;
  paths: Record<string, string[]>;
  baseUrl?: string;
}

interface Pkg {
  dir: string;
  main?: string;
}

export interface ResolveContext {
  files: ReadonlySet<string>;
  /** Nearest-config lookup by folder. */
  configs: Map<string, TsConfig>;
  packages: Map<string, Pkg>;
}

type Reader = (path: string) => Promise<string | undefined>;

function dirOf(path: string): string {
  const d = posix.dirname(path);
  return d === "." ? "" : d;
}

function isConfigName(path: string): boolean {
  return /(^|\/)(ts|js)config[^/]*\.json$/.test(path);
}

export async function loadResolveContext(
  entryPaths: readonly string[],
  files: ReadonlySet<string>,
  read: Reader,
): Promise<ResolveContext> {
  const usable = entryPaths.filter(
    (p) =>
      !p
        .split("/")
        .slice(0, -1)
        .some((seg) => folderReason(seg) === "dependency_or_build_folder"),
  );
  const raw = new Map<string, Record<string, unknown>>();
  const load = async (path: string): Promise<Record<string, unknown> | undefined> => {
    if (raw.has(path)) return raw.get(path);
    const text = await read(path);
    if (text === undefined) return undefined;
    try {
      const parsed = parseJsonc(text) as Record<string, unknown>;
      raw.set(path, parsed);
      return parsed;
    } catch {
      return undefined;
    }
  };

  const merged = new Map<string, TsConfig>();
  const effective = async (path: string, depth = 0): Promise<TsConfig | undefined> => {
    const cached = merged.get(path);
    if (cached) return cached;
    const json = await load(path);
    if (!json || depth > 5) return undefined;
    const dir = dirOf(path);
    let result: TsConfig = { base: dir, paths: {} };
    const ext = typeof json.extends === "string" ? json.extends : undefined;
    if (ext?.startsWith(".")) {
      const target = posix.normalize(posix.join(dir, ext.endsWith(".json") ? ext : `${ext}.json`));
      const parent = await effective(target, depth + 1);
      if (parent) result = { ...parent, paths: { ...parent.paths } };
    }
    const options = (json.compilerOptions ?? {}) as { baseUrl?: string; paths?: Record<string, string[]> };
    if (typeof options.baseUrl === "string") {
      result.baseUrl = posix.normalize(posix.join(dir, options.baseUrl));
      result.base = result.baseUrl;
    }
    if (options.paths) {
      result.paths = options.paths;
      if (result.baseUrl === undefined) result.base = dir;
    }
    merged.set(path, result);
    return result;
  };

  const configs = new Map<string, TsConfig>();
  for (const path of usable.filter(isConfigName).sort()) {
    const name = posix.basename(path);
    if (name !== "tsconfig.json" && name !== "jsconfig.json") continue;
    const cfg = await effective(path);
    if (cfg) configs.set(dirOf(path), cfg);
  }

  const packages = new Map<string, Pkg>();
  for (const path of usable.filter((p) => posix.basename(p) === "package.json")) {
    const json = await load(path);
    const name = json?.name;
    if (typeof name !== "string") continue;
    const main = [json?.module, json?.main, json?.types].find((v): v is string => typeof v === "string");
    packages.set(name, { dir: dirOf(path), main });
  }
  return { files, configs, packages };
}

function tryFile(base: string, files: ReadonlySet<string>): string | undefined {
  const norm = posix.normalize(base).replace(/^\.\//, "");
  if (files.has(norm)) return norm;
  for (const ext of EXTENSIONS) if (files.has(norm + ext)) return norm + ext;
  const ext = posix.extname(norm);
  for (const alt of JS_TO_TS[ext] ?? []) {
    const candidate = norm.slice(0, -ext.length) + alt;
    if (files.has(candidate)) return candidate;
  }
  for (const e of EXTENSIONS) {
    const index = posix.join(norm, `index${e}`);
    if (files.has(index)) return index;
  }
  return undefined;
}

function nearestConfig(from: string, configs: Map<string, TsConfig>): TsConfig | undefined {
  let dir = dirOf(from);
  for (;;) {
    const cfg = configs.get(dir);
    if (cfg) return cfg;
    if (dir === "") return undefined;
    dir = dirOf(dir);
  }
}

function matchPattern(pattern: string, spec: string): string | undefined {
  const star = pattern.indexOf("*");
  if (star < 0) return pattern === spec ? "" : undefined;
  const head = pattern.slice(0, star);
  const tail = pattern.slice(star + 1);
  if (spec.startsWith(head) && spec.endsWith(tail) && spec.length >= head.length + tail.length) {
    return spec.slice(head.length, spec.length - tail.length);
  }
  return undefined;
}

/** Resolves a module specifier to a file of the project, or undefined for external packages. */
export function resolveImport(spec: string, from: string, ctx: ResolveContext): string | undefined {
  if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") {
    return tryFile(posix.join(dirOf(from), spec), ctx.files);
  }
  const cfg = nearestConfig(from, ctx.configs);
  if (cfg) {
    for (const [pattern, targets] of Object.entries(cfg.paths)) {
      const hit = matchPattern(pattern, spec);
      if (hit === undefined) continue;
      for (const target of targets) {
        const found = tryFile(posix.join(cfg.base, target.replace("*", hit)), ctx.files);
        if (found) return found;
      }
    }
    if (cfg.baseUrl !== undefined) {
      const found = tryFile(posix.join(cfg.baseUrl, spec), ctx.files);
      if (found) return found;
    }
  }
  for (const [name, pkg] of ctx.packages) {
    if (spec !== name && !spec.startsWith(`${name}/`)) continue;
    const sub = spec.slice(name.length + 1);
    if (sub) {
      return (
        tryFile(posix.join(pkg.dir, sub), ctx.files) ?? tryFile(posix.join(pkg.dir, "src", sub), ctx.files)
      );
    }
    const candidates = [
      pkg.main && posix.join(pkg.dir, pkg.main),
      posix.join(pkg.dir, "src/index"),
      posix.join(pkg.dir, "index"),
      posix.join(pkg.dir, "src"),
    ];
    for (const c of candidates) {
      if (!c) continue;
      const found = tryFile(c, ctx.files) ?? tryFile(c.replace(/(^|\/)dist\//, "$1src/"), ctx.files);
      if (found) return found;
    }
  }
  return undefined;
}

/** Links between files of the project: file to the set of files it imports. */
export function buildImportGraph(
  imports: ReadonlyMap<string, string[]>,
  ctx: ResolveContext,
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const [file, specs] of imports) {
    const targets = new Set<string>();
    for (const spec of specs) {
      const target = resolveImport(spec, file, ctx);
      if (target && target !== file) targets.add(target);
    }
    graph.set(file, targets);
  }
  return graph;
}

export interface FolderCohesion {
  value: number;
}

/** Folder cohesion: internal links over internal plus outgoing links. Unavailable under 5 links. */
export function folderCohesion(
  _folder: string,
  files: readonly string[],
  graph: ReadonlyMap<string, Set<string>>,
): number | undefined {
  const inside = new Set(files);
  let internal = 0;
  let leaving = 0;
  for (const file of files) {
    for (const target of graph.get(file) ?? []) {
      if (inside.has(target)) internal++;
      else leaving++;
    }
  }
  const total = internal + leaving;
  return total < 5 ? undefined : internal / total;
}
