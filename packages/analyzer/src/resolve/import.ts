import { posix } from "node:path";
import { languageForPath } from "../languages/index.js";
import {
  resolveCsharp,
  resolveGo,
  resolveJava,
  resolveKotlin,
  resolvePhp,
  resolvePython,
  resolveRuby,
  resolveRust,
} from "./modules.js";
import { dirOf } from "./paths.js";
import type { Pkg, ResolveContext, TsConfig } from "./types.js";

const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const JS_TO_TS: Record<string, string[]> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};

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

/** Every file a module specifier stands for: one for most languages, the files of a package for Go. */
export function resolveImportAll(spec: string, from: string, ctx: ResolveContext): string[] {
  const resolver = languageForPath(from)?.modules?.resolver;
  if (resolver === "go") return resolveGo(spec, ctx);
  if (resolver === "java") return resolveJava(spec, from, ctx.files);
  if (resolver === "csharp") return resolveCsharp(spec, ctx);
  if (resolver === "kotlin") return resolveKotlin(spec, from, ctx);
  if (resolver === "rust") return resolveRust(spec, from, ctx);
  if (resolver === "php") return resolvePhp(spec, from, ctx);
  if (resolver === "ruby") return resolveRuby(spec, from, ctx);
  const one = resolveImport(spec, from, ctx);
  return one ? [one] : [];
}

/** Resolves a module specifier to a file of the project, or undefined for external packages. */
export function resolveImport(spec: string, from: string, ctx: ResolveContext): string | undefined {
  // the language of the importing file says how its modules are named
  if (languageForPath(from)?.modules?.resolver === "python") return resolvePython(spec, from, ctx.files);
  if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") {
    return tryFile(posix.join(dirOf(from), spec), ctx.files);
  }
  const cfg = nearestConfig(from, ctx.configs);
  return (cfg && viaConfig(spec, cfg, ctx.files)) ?? viaPackages(spec, ctx);
}

/** Through the `paths` and the `baseUrl` of the nearest tsconfig. */
function viaConfig(spec: string, cfg: TsConfig, files: ReadonlySet<string>): string | undefined {
  for (const [pattern, targets] of Object.entries(cfg.paths)) {
    const hit = matchPattern(pattern, spec);
    if (hit === undefined) continue;
    for (const target of targets) {
      const found = tryFile(posix.join(cfg.base, target.replace("*", hit)), files);
      if (found) return found;
    }
  }
  return cfg.baseUrl === undefined ? undefined : tryFile(posix.join(cfg.baseUrl, spec), files);
}

/** Through the packages of the workspace, by name: the package itself or a file inside it. */
function viaPackages(spec: string, ctx: ResolveContext): string | undefined {
  for (const [name, pkg] of ctx.packages) {
    if (spec !== name && !spec.startsWith(`${name}/`)) continue;
    const sub = spec.slice(name.length + 1);
    return sub ? inPackage(pkg, sub, ctx.files) : entryOf(pkg, ctx.files);
  }
  return undefined;
}

function inPackage(pkg: Pkg, sub: string, files: ReadonlySet<string>): string | undefined {
  return tryFile(posix.join(pkg.dir, sub), files) ?? tryFile(posix.join(pkg.dir, "src", sub), files);
}

/** The entry point of a package: what it declares, then the usual places. */
function entryOf(pkg: Pkg, files: ReadonlySet<string>): string | undefined {
  const candidates = [
    pkg.main && posix.join(pkg.dir, pkg.main),
    posix.join(pkg.dir, "src/index"),
    posix.join(pkg.dir, "index"),
    posix.join(pkg.dir, "src"),
  ];
  for (const c of candidates) {
    if (!c) continue;
    const found = tryFile(c, files) ?? tryFile(c.replace(/(^|\/)dist\//, "$1src/"), files);
    if (found) return found;
  }
  return undefined;
}
