import { posix } from "node:path";
import { folderReason } from "../select.js";
import { parseJsonc } from "./jsonc.js";
import { dirOf } from "./paths.js";
import type { Pkg, ResolveContext, TsConfig } from "./types.js";

type Reader = (path: string) => Promise<string | undefined>;
type Json = Record<string, unknown>;
type Loader = (path: string) => Promise<Json | undefined>;

function isConfigName(path: string): boolean {
  return /(^|\/)(ts|js)config[^/]*\.json$/.test(path);
}

/** Reads and parses a JSON file once; a file that is missing or malformed is simply absent. */
function jsonLoader(read: Reader): Loader {
  const raw = new Map<string, Json>();
  return async (path) => {
    const known = raw.get(path);
    if (known) return known;
    const text = await read(path);
    if (text === undefined) return undefined;
    try {
      const parsed = parseJsonc(text) as Json;
      raw.set(path, parsed);
      return parsed;
    } catch {
      return undefined;
    }
  };
}

/** The `baseUrl` and `paths` a config sets, on top of what it inherited. */
function withOptions(base: TsConfig, json: Json, dir: string): TsConfig {
  const result = { ...base, paths: { ...base.paths } };
  const options = (json.compilerOptions ?? {}) as { baseUrl?: string; paths?: Record<string, string[]> };
  if (typeof options.baseUrl === "string") {
    result.baseUrl = posix.normalize(posix.join(dir, options.baseUrl));
    result.base = result.baseUrl;
  }
  if (options.paths) {
    result.paths = options.paths;
    if (result.baseUrl === undefined) result.base = dir;
  }
  return result;
}

/** The config at a path, with what it extends (a relative `extends` only) merged in. */
function configReader(load: Loader) {
  const merged = new Map<string, TsConfig>();
  const effective = async (path: string, depth = 0): Promise<TsConfig | undefined> => {
    const cached = merged.get(path);
    if (cached) return cached;
    const json = await load(path);
    if (!json || depth > 5) return undefined;
    const dir = dirOf(path);
    const ext = typeof json.extends === "string" ? json.extends : undefined;
    const target = ext?.startsWith(".")
      ? posix.normalize(posix.join(dir, ext.endsWith(".json") ? ext : `${ext}.json`))
      : undefined;
    const parent = target ? await effective(target, depth + 1) : undefined;
    const result = withOptions(parent ?? { base: dir, paths: {} }, json, dir);
    merged.set(path, result);
    return result;
  };
  return effective;
}

/** The workspace packages by name, with the entry they declare. */
async function loadPackages(paths: readonly string[], load: Loader): Promise<Map<string, Pkg>> {
  const packages = new Map<string, Pkg>();
  for (const path of paths.filter((p) => posix.basename(p) === "package.json")) {
    const json = await load(path);
    const name = json?.name;
    if (typeof name !== "string") continue;
    const main = [json?.module, json?.main, json?.types].find((v): v is string => typeof v === "string");
    packages.set(name, { dir: dirOf(path), main });
  }
  return packages;
}

/** The module path each `go.mod` declares, by the folder of the file. */
async function loadGoModules(paths: readonly string[], read: Reader): Promise<Map<string, string>> {
  const modules = new Map<string, string>();
  for (const path of paths.filter((p) => posix.basename(p) === "go.mod")) {
    const module = /^\s*module\s+(\S+)/m.exec((await read(path)) ?? "")?.[1];
    if (module) modules.set(dirOf(path), module.replace(/^"|"$/g, ""));
  }
  return modules;
}

/** The crates of the project: the folder of each `Cargo.toml` that names a package, by that name (`-` read as `_`). */
async function loadRustCrates(paths: readonly string[], read: Reader): Promise<Map<string, string>> {
  const crates = new Map<string, string>();
  for (const path of paths.filter((p) => posix.basename(p) === "Cargo.toml")) {
    const text = (await read(path)) ?? "";
    const pkg = /\[package\][^[]*?\bname\s*=\s*"([^"]+)"/s.exec(text)?.[1];
    if (pkg) crates.set(pkg.replace(/-/g, "_"), dirOf(path));
  }
  return crates;
}

/** The files that declare each name, from what each file declares. */
function namespacesOf(declares: ReadonlyMap<string, string[]>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [file, names] of declares)
    for (const name of new Set(names)) out.set(name, [...(out.get(name) ?? []), file].sort());
  return out;
}

export async function loadResolveContext(
  entryPaths: readonly string[],
  files: ReadonlySet<string>,
  read: Reader,
  declares: ReadonlyMap<string, string[]> = new Map(),
): Promise<ResolveContext> {
  const usable = entryPaths.filter(
    (p) =>
      !p
        .split("/")
        .slice(0, -1)
        .some((seg) => folderReason(seg) === "dependency_or_build_folder"),
  );
  const load = jsonLoader(read);
  const effective = configReader(load);
  const configs = new Map<string, TsConfig>();
  for (const path of usable.filter(isConfigName).sort()) {
    const name = posix.basename(path);
    if (name !== "tsconfig.json" && name !== "jsconfig.json") continue;
    const cfg = await effective(path);
    if (cfg) configs.set(dirOf(path), cfg);
  }
  return {
    files,
    configs,
    packages: await loadPackages(usable, load),
    goModules: await loadGoModules(usable, read),
    rustCrates: await loadRustCrates(usable, read),
    namespaces: namespacesOf(declares),
  };
}
