import { posix } from "node:path";
import { folderReason } from "../select.js";
import { parseJsonc } from "./jsonc.js";
import { dirOf } from "./paths.js";
import type { Pkg, ResolveContext, TsConfig } from "./types.js";

type Reader = (path: string) => Promise<string | undefined>;

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
