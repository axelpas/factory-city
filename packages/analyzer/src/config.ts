import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Optional `factory-city.config.json` at the root of the analyzed folder. Zero configuration works without it. */
export interface Config {
  windows: { recentDays: number; reworkDays: number };
  /** Extra regular expressions that mark a commit subject as a fix. */
  fixPatterns: string[];
  /** Extra regular expressions that find an issue number in a commit message; group 1 is the number. */
  issuePatterns: string[];
}

export const DEFAULT_CONFIG: Config = {
  windows: { recentDays: 30, reworkDays: 14 },
  fixPatterns: [],
  issuePatterns: [],
};

export async function loadConfig(folder: string): Promise<Config> {
  const path = join(folder, "factory-city.config.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return DEFAULT_CONFIG;
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(
      `${path} is not valid JSON. Fix it or delete it: Factory City works without a configuration file.`,
    );
  }
  const windows = (json.windows ?? {}) as Record<string, unknown>;
  const days = (key: string, fallback: number): number => {
    const v = windows[key];
    if (v === undefined) return fallback;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0)
      throw new Error(`${path}: windows.${key} must be a positive number of days.`);
    return v;
  };
  const patterns = (key: "fixPatterns" | "issuePatterns"): string[] => {
    const list = json[key] ?? [];
    if (!Array.isArray(list) || list.some((p) => typeof p !== "string")) {
      throw new Error(`${path}: ${key} must be a list of regular expressions written as strings.`);
    }
    for (const p of list as string[]) {
      try {
        new RegExp(p);
      } catch {
        throw new Error(`${path}: "${p}" in ${key} is not a valid regular expression.`);
      }
    }
    return list as string[];
  };
  return {
    windows: {
      recentDays: days("recentDays", DEFAULT_CONFIG.windows.recentDays),
      reworkDays: days("reworkDays", DEFAULT_CONFIG.windows.reworkDays),
    },
    fixPatterns: patterns("fixPatterns"),
    issuePatterns: patterns("issuePatterns"),
  };
}
